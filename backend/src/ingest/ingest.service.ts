import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BtsService } from '../bts/bts.service';
import { EventsGateway } from '../events/events.gateway';
import { GeofenceStateService } from '../geofences/geofence-state.service';
import { PrismaService } from '../prisma/prisma.service';
import { LocationDto, SubmitDataDto } from './dto/submit-data.dto';
import {
  ConcurrencyQueue,
  isValidCell,
  markServingCell,
  type NormalizedCell,
} from './ingest.utils';

// Same tier boundaries the mobile client uses (locationService.ts). We
// re-derive on the server too because (a) older clients ship `accuracy`
// without `quality`, and (b) it lets us audit/override the client's call
// from one place when boundaries change.
const ACCURACY_GPS_GRADE_M = 20;
const ACCURACY_APPROX_M = 80;
type LocationQuality = 'gps' | 'approx' | 'network';

function deriveQuality(
  loc: LocationDto,
): LocationQuality | null {
  if (loc.quality) return loc.quality;
  if (loc.accuracy == null) return null;
  if (loc.accuracy <= ACCURACY_GPS_GRADE_M) return 'gps';
  if (loc.accuracy <= ACCURACY_APPROX_M) return 'approx';
  return 'network';
}

function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// H3 — dedup emit `device_moved`. Khi mobile ở tick rate cao (5s) + user
// đứng yên + movement filter mobile-side bị bypass (vd lệnh force) → server
// vẫn nhận stream fix gần như identical. Skip emit nếu di chuyển <2m so
// emit trước AND <10s từ emit cũ. KHÔNG skip persist (history audit đầy đủ).
const EMIT_DEDUP_DISTANCE_M = 2;
const EMIT_DEDUP_TIME_MS = 10_000;

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);
  private readonly btsQueue = new ConcurrencyQueue(2);
  // In-memory cache cho dedup. Map<deviceId, {lat, lon, t}>. Reset khi
  // server restart — acceptable, lần emit kế tiếp sẽ luôn fire.
  private readonly lastEmit = new Map<
    string,
    { lat: number; lon: number; t: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly btsService: BtsService,
    private readonly eventsGateway: EventsGateway,
    private readonly geofenceState: GeofenceStateService,
  ) {}

  /** Trả true nếu emit này quá gần (cả không gian + thời gian) emit trước → skip. */
  private shouldSkipEmit(deviceId: string, lat: number, lon: number): boolean {
    const prev = this.lastEmit.get(deviceId);
    if (!prev) return false;
    if (Date.now() - prev.t > EMIT_DEDUP_TIME_MS) return false;
    return haversineMeters(lat, lon, prev.lat, prev.lon) < EMIT_DEDUP_DISTANCE_M;
  }

  private markEmitted(deviceId: string, lat: number, lon: number): void {
    this.lastEmit.set(deviceId, { lat, lon, t: Date.now() });
  }

  /**
   * Unified telemetry endpoint. Trước kia split thành /ingest (có locations)
   * và /heartbeat (không locations); giờ gộp 1 path code, branch theo
   * `dto.locations` có hay không.
   *
   *   - `locations` non-empty → flow ingest đầy đủ: persist location_history,
   *     emit `device_moved`, eval geofence, spoof check, …
   *   - `locations` empty/omit → flow heartbeat: chỉ refresh last_seen,
   *     low-battery transition, emit `device_heartbeat`.
   *
   * Bước common (resolve serving cell + connectedBts, lookup BTS) chạy ở
   * cả 2 nhánh để cha mẹ luôn thấy "đang nối trạm nào" realtime.
   */
  async saveData(
    deviceId: string,
    dto: SubmitDataDto,
  ): Promise<{ success: true; message: string }> {
    if (!deviceId) throw new BadRequestException('Missing device id');

    const device = await this.prisma.devices.findUnique({
      where: { id: deviceId },
      select: {
        id: true,
        owner_name: true,
        phone_number: true,
        manager_account_id: true,
        is_low_battery_alerted: true,
        is_offline_alerted: true,
        device_geofences: {
          include: {
            geofence: {
              select: { id: true, name: true, lat: true, lon: true, radius_m: true },
            },
          },
        },
      },
    });
    if (!device) throw new NotFoundException('Device not found');

    // ── Common: resolve serving cell + connectedBts ───────────────────────
    const validCells = (dto.cellTowers ?? []).filter(isValidCell);
    const cells = validCells.length > 0 ? markServingCell(validCells) : [];
    const servingCell = cells.find((c) => c.isServing) ?? null;

    let connectedBts: {
      id: number;
      lat: number;
      lon: number;
      radio: string | null;
      range: number | null;
    } | null = null;
    if (servingCell) {
      const row = await this.prisma.bts_stations.findUnique({
        where: {
          mcc_mnc_lac_cid: {
            mcc: servingCell.mcc,
            mnc: servingCell.mnc,
            lac: servingCell.lac,
            cid: servingCell.cid,
          },
        },
        select: { id: true, lat: true, lon: true, radio: true, range: true },
      });
      if (row) {
        connectedBts = {
          id: row.id,
          lat: Number(row.lat),
          lon: Number(row.lon),
          radio: row.radio,
          range: row.range,
        };
      }
      // Lookup Combain async nếu cell mới — lần ingest sau sẽ có row.
      void this.lookupBtsInBackground(servingCell);
    }

    const cellTowersPayload = cells.map((c) => ({
      type: c.type,
      mcc: c.mcc,
      mnc: c.mnc,
      lac: c.lac,
      cid: c.cid,
      pci: c.pci ?? null,
      rssi: c.rssi ?? null,
      signalDbm: c.signalDbm ?? null,
      isServing: c.isServing,
    }));

    const hasLocations = (dto.locations?.length ?? 0) > 0;

    // ══ Nhánh INGEST (có locations) ═══════════════════════════════════════
    if (hasLocations) {
      // Client guarantee oldest→newest, latest fix dùng cho realtime + eval.
      const locations = dto.locations!;
      const latest = locations[locations.length - 1];
      const latestAt = new Date(latest.timestamp);
      const latestQuality = deriveQuality(latest);

      // Spoofing detect (chỉ tier gps). Fake-GPS app đổi OS location nhưng
      // không đổi cell device đang attach → khoảng cách bất thường = nghi vấn.
      const SPOOF_RANGE_MULTIPLIER = 2;
      const DEFAULT_BTS_RANGE_M = 2000;
      let spoofingSuspected = false;
      let gpsBtsDistanceM: number | null = null;
      if (connectedBts && latestQuality === 'gps') {
        gpsBtsDistanceM = Math.round(
          haversineMeters(
            latest.latitude,
            latest.longitude,
            connectedBts.lat,
            connectedBts.lon,
          ),
        );
        const btsRange = connectedBts.range ?? DEFAULT_BTS_RANGE_M;
        spoofingSuspected = gpsBtsDistanceM > btsRange * SPOOF_RANGE_MULTIPLIER;
        if (spoofingSuspected) {
          this.logger.warn(
            `GPS SPOOFING suspected device=${deviceId} ` +
              `gps=(${latest.latitude},${latest.longitude}) ` +
              `bts=(${connectedBts.lat},${connectedBts.lon}) ` +
              `dist=${gpsBtsDistanceM}m range=${btsRange}m`,
          );
        }
      }

      // Dedup emit nếu near-identical trong cửa sổ ngắn — vẫn persist DB.
      if (!this.shouldSkipEmit(deviceId, latest.latitude, latest.longitude)) {
        this.eventsGateway.emitDeviceMoved({
          deviceId,
          lat: latest.latitude,
          lon: latest.longitude,
          accuracy: latest.accuracy ?? null,
          quality: latestQuality,
          cid: servingCell?.cid ?? null,
          lac: servingCell?.lac ?? null,
          signalDbm: servingCell?.signalDbm ?? null,
          timestamp: latestAt.toISOString(),
          cellTowers: cellTowersPayload,
          connectedBts,
          spoofingSuspected,
          gpsBtsDistanceM,
          lastFixAt: dto.lastFixAt ?? latest.timestamp,
          activity: dto.activity ?? null,
          activityConfidence: dto.activityConfidence ?? null,
        });
        this.markEmitted(deviceId, latest.latitude, latest.longitude);
      }

      void this.persistInBackground(
        deviceId,
        locations,
        cells,
        latestAt,
        dto.batteryLevel,
        device.owner_name,
        device.manager_account_id,
        dto.activity ?? null,
        dto.activityConfidence ?? null,
      );

      // Geofence eval chỉ với fix tier gps + không nghi spoof — fix
      // approx/network drift hàng trăm m gây phantom breach.
      if (
        device.device_geofences.length > 0 &&
        latestQuality === 'gps' &&
        !spoofingSuspected
      ) {
        void this.evaluateDeviceZones(
          deviceId,
          device.owner_name,
          device.manager_account_id,
          latest.latitude,
          latest.longitude,
          device.device_geofences.map((dg) => dg.geofence),
          latestAt,
        );
      }

      return { success: true, message: 'Data received' };
    }

    // ══ Nhánh HEARTBEAT (không locations) ═════════════════════════════════
    const batteryLevel = dto.batteryLevel;
    const now = new Date();
    const LOW_BATTERY_THRESHOLD = 20;
    const LOW_BATTERY_RESET_THRESHOLD = 25;

    let lowBatteryTransition: 'arm' | 'disarm' | null = null;
    if (batteryLevel != null) {
      if (
        batteryLevel < LOW_BATTERY_THRESHOLD &&
        !device.is_low_battery_alerted
      ) {
        lowBatteryTransition = 'arm';
      } else if (
        batteryLevel >= LOW_BATTERY_RESET_THRESHOLD &&
        device.is_low_battery_alerted
      ) {
        lowBatteryTransition = 'disarm';
      }
    }

    const updateData: {
      last_seen: Date;
      last_battery?: number;
      is_low_battery_alerted?: boolean;
      is_offline_alerted?: boolean;
    } = { last_seen: now };
    if (batteryLevel != null) updateData.last_battery = batteryLevel;
    if (lowBatteryTransition === 'arm') updateData.is_low_battery_alerted = true;
    else if (lowBatteryTransition === 'disarm')
      updateData.is_low_battery_alerted = false;
    if (device.is_offline_alerted) updateData.is_offline_alerted = false;

    await this.prisma.devices.update({
      where: { id: deviceId },
      data: updateData,
    });

    // Spoof check trên heartbeat: nếu có connectedBts + fix GPS gps-tier gần
    // đây (5 phút) trong location_history, check khoảng cách. Cần thiết vì
    // khi user đứng yên + fake GPS thì ingest path không fire, spoof không
    // được phát hiện cho đến khi user di chuyển trong fake location.
    if (connectedBts) {
      const recentGpsCutoff = new Date(Date.now() - 5 * 60 * 1000);
      const recentFix = await this.prisma.location_history.findFirst({
        where: {
          device_id: deviceId,
          quality: 'gps',
          recorded_at: { gte: recentGpsCutoff },
        },
        orderBy: { recorded_at: 'desc' },
        select: { latitude: true, longitude: true },
      });
      if (recentFix) {
        const SPOOF_RANGE_MULTIPLIER = 2;
        const DEFAULT_BTS_RANGE_M = 2000;
        const dist = Math.round(
          haversineMeters(
            Number(recentFix.latitude),
            Number(recentFix.longitude),
            connectedBts.lat,
            connectedBts.lon,
          ),
        );
        const btsRange = connectedBts.range ?? DEFAULT_BTS_RANGE_M;
        if (dist > btsRange * SPOOF_RANGE_MULTIPLIER) {
          this.logger.warn(
            `GPS SPOOFING suspected (heartbeat) device=${deviceId} ` +
              `last_gps=(${recentFix.latitude},${recentFix.longitude}) ` +
              `bts=(${connectedBts.lat},${connectedBts.lon}) ` +
              `dist=${dist}m range=${btsRange}m`,
          );
          this.eventsGateway.emitDeviceMoved({
            deviceId,
            lat: Number(recentFix.latitude),
            lon: Number(recentFix.longitude),
            accuracy: null,
            quality: 'gps',
            cid: servingCell?.cid ?? null,
            lac: servingCell?.lac ?? null,
            signalDbm: servingCell?.signalDbm ?? null,
            timestamp: now.toISOString(),
            cellTowers: cellTowersPayload,
            connectedBts,
            spoofingSuspected: true,
            gpsBtsDistanceM: dist,
            lastFixAt: dto.lastFixAt ?? null,
            activity: dto.activity ?? null,
            activityConfidence: dto.activityConfidence ?? null,
          });
        }
      }
    }

    this.eventsGateway.emitDeviceHeartbeat({
      deviceId,
      batteryLevel: batteryLevel ?? null,
      timestamp: now.toISOString(),
      cellTowers: cellTowersPayload,
      connectedBts,
      lastFixAt: dto.lastFixAt ?? null,
    });

    if (batteryLevel != null) {
      this.eventsGateway.emitBatteryUpdate({
        deviceId,
        batteryLevel,
        timestamp: now.toISOString(),
      });
    }
    if (lowBatteryTransition === 'arm' && batteryLevel != null) {
      const lowEvent = {
        deviceId,
        deviceName: device.owner_name,
        batteryLevel,
        timestamp: now.toISOString(),
      };
      this.eventsGateway.emitLowBattery(lowEvent);
      this.logger.warn(
        `Low battery (heartbeat) device=${deviceId} (${device.owner_name ?? '?'}) ${batteryLevel}%`,
      );
    }

    return { success: true, message: 'Heartbeat received' };
  }

  /**
   * Device-level breach evaluation: the device is "inside" while it sits
   * within ANY of its assigned zones, and "outside" only when it leaves
   * ALL of them. We pick the zone the device is closest to as the
   * reference point in the emitted event so the UI has a concrete name
   * and distance to show.
   */
  private async evaluateDeviceZones(
    deviceId: string,
    deviceName: string | null,
    managerAccountId: string,
    lat: number,
    lon: number,
    geofences: Array<{
      id: string;
      name: string;
      lat: { toString(): string } | number;
      lon: { toString(): string } | number;
      radius_m: number;
    }>,
    now: Date,
  ): Promise<void> {
    if (geofences.length === 0) return;
    try {
      let nearest: {
        id: string;
        name: string;
        centerLat: number;
        centerLon: number;
        radiusM: number;
        distanceM: number;
      } | null = null;
      let anyInside = false;

      for (const g of geofences) {
        const centerLat = Number(g.lat);
        const centerLon = Number(g.lon);
        const distanceM = haversineMeters(lat, lon, centerLat, centerLon);
        if (distanceM <= g.radius_m) anyInside = true;
        if (nearest === null || distanceM < nearest.distanceM) {
          nearest = {
            id: g.id,
            name: g.name,
            centerLat,
            centerLon,
            radiusM: g.radius_m,
            distanceM,
          };
        }
      }
      if (!nearest) return;

      const current = anyInside ? 'inside' : 'outside';
      const previous = await this.geofenceState.getDeviceStatus(deviceId);
      await this.geofenceState.setDeviceStatus(deviceId, current);

      const event = {
        deviceId,
        deviceName,
        geofenceId: nearest.id,
        geofenceName: nearest.name,
        status: (current === 'outside' ? 'outside' : 'returned') as
          | 'outside'
          | 'returned',
        lat,
        lon,
        centerLat: nearest.centerLat,
        centerLon: nearest.centerLon,
        radiusM: nearest.radiusM,
        distanceM: Math.round(nearest.distanceM),
        timestamp: now.toISOString(),
      };

      if (current === 'outside') {
        await this.geofenceState.setDeviceBreach(event);
      } else {
        await this.geofenceState.clearDeviceBreach(deviceId);
      }

      const isTransition =
        previous === null ? current === 'outside' : previous !== current;
      if (!isTransition) return;

      this.eventsGateway.emitGeofenceBreach(event);

      this.logger.warn(
        `Geofence ${current === 'outside' ? 'BREACH' : 'RETURN'} ` +
          `device=${deviceId} nearest=${nearest.id} ` +
          `dist=${Math.round(nearest.distanceM)}m zones=${geofences.length}`,
      );
    } catch (err) {
      this.logger.error(
        `geofence eval failed for ${deviceId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async persistInBackground(
    deviceId: string,
    locations: LocationDto[],
    cells: NormalizedCell[],
    latestAt: Date,
    batteryLevel: number | undefined,
    ownerName: string | null,
    managerAccountId: string,
    activity: string | null,
    activityConfidence: number | null,
  ): Promise<void> {
    try {
      // Pre-check battery state to know whether we need to flip alert flags
      // alongside updating last_seen. Hysteresis: arm alert at <20%, disarm
      // at ≥25% so a device hovering around 20% doesn't ping repeatedly.
      const LOW_BATTERY_THRESHOLD = 20;
      const LOW_BATTERY_RESET_THRESHOLD = 25;
      let lowBatteryTransition: 'arm' | 'disarm' | null = null;
      let clearedOfflineFlag = false;
      const prev = await this.prisma.devices.findUnique({
        where: { id: deviceId },
        select: {
          is_low_battery_alerted: true,
          is_offline_alerted: true,
        },
      });
      if (batteryLevel != null && prev) {
        if (
          batteryLevel < LOW_BATTERY_THRESHOLD &&
          !prev.is_low_battery_alerted
        ) {
          lowBatteryTransition = 'arm';
        } else if (
          batteryLevel >= LOW_BATTERY_RESET_THRESHOLD &&
          prev.is_low_battery_alerted
        ) {
          lowBatteryTransition = 'disarm';
        }
      }
      // Device just sent a heartbeat → no longer "offline".
      clearedOfflineFlag = !!prev?.is_offline_alerted;

      await this.prisma.$transaction(async (tx) => {
        await tx.location_history.createMany({
          data: locations.map((loc) => ({
            device_id: deviceId,
            latitude: loc.latitude,
            longitude: loc.longitude,
            accuracy_m: loc.accuracy ?? null,
            quality: deriveQuality(loc),
            activity,
            activity_confidence: activityConfidence,
            recorded_at: new Date(loc.timestamp),
          })),
        });

        if (cells.length > 0) {
          // Cell info is sampled once per batch on the device (cell query is
          // slow). Attribute it to the latest fix's time so it lines up with
          // the realtime broadcast and the device's current state.
          await tx.cell_tower_history.createMany({
            data: cells.map((c) => ({
              device_id: deviceId,
              type: c.type,
              mcc: c.mcc,
              mnc: c.mnc,
              lac: c.lac,
              cid: c.cid,
              rssi: c.rssi ?? null,
              signal_dbm: c.signalDbm ?? null,
              pci: c.pci ?? null,
              is_serving: c.isServing,
              recorded_at: latestAt,
            })),
          });
        }

        const updateData: {
          last_seen: Date;
          last_battery?: number;
          is_low_battery_alerted?: boolean;
          is_offline_alerted?: boolean;
        } = { last_seen: latestAt };
        if (batteryLevel != null) updateData.last_battery = batteryLevel;
        if (lowBatteryTransition === 'arm') updateData.is_low_battery_alerted = true;
        else if (lowBatteryTransition === 'disarm') updateData.is_low_battery_alerted = false;
        if (clearedOfflineFlag) updateData.is_offline_alerted = false;

        await tx.devices.update({
          where: { id: deviceId },
          data: updateData,
        });
      });

      // Emit alerts AFTER the transaction commits so consumers never see
      // a stale device row. battery_update fires every batch for the
      // dashboard meter; low_battery only on the arm transition.
      if (batteryLevel != null) {
        this.eventsGateway.emitBatteryUpdate({
          deviceId,
          batteryLevel,
          timestamp: latestAt.toISOString(),
        });
      }
      if (lowBatteryTransition === 'arm' && batteryLevel != null) {
        const lowEvent = {
          deviceId,
          deviceName: ownerName,
          batteryLevel,
          timestamp: latestAt.toISOString(),
        };
        this.eventsGateway.emitLowBattery(lowEvent);
        this.logger.warn(
          `Low battery device=${deviceId} (${ownerName ?? '?'}) ${batteryLevel}%`,
        );
      }

    } catch (err) {
      this.logger.error(
        `persistInBackground failed for ${deviceId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private lookupBtsInBackground(cell: NormalizedCell): void {
    this.btsQueue
      .add(() =>
        this.btsService.getOrFetchStation(
          cell.mcc,
          cell.mnc,
          cell.lac,
          cell.cid,
          cell.type || 'lte',
        ),
      )
      .catch((err) =>
        this.logger.error(
          `BTS lookup failed for ${cell.mcc}-${cell.mnc}-${cell.lac}-${cell.cid}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  }
}
