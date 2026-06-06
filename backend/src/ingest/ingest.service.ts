import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import axios from 'axios';
import { AlertsService } from '../alerts/alerts.service';
import { BtsService } from '../bts/bts.service';
import { EventsGateway } from '../events/events.gateway';
import { GeofenceStateService } from '../geofences/geofence-state.service';
import { PrismaService } from '../prisma/prisma.service';
import { HeartbeatDto } from './dto/heartbeat.dto';
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

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);
  private readonly btsQueue = new ConcurrencyQueue(2);

  constructor(
    private readonly prisma: PrismaService,
    private readonly btsService: BtsService,
    private readonly eventsGateway: EventsGateway,
    private readonly geofenceState: GeofenceStateService,
    private readonly alerts: AlertsService,
  ) {}

  async saveData(
    deviceId: string,
    dto: SubmitDataDto,
  ): Promise<{ success: true; message: string }> {
    if (!deviceId) throw new BadRequestException('Missing device id');
    if (!dto?.locations?.length) throw new BadRequestException('Missing locations');

    const device = await this.prisma.devices.findUnique({
      where: { id: deviceId },
      select: {
        id: true,
        person_name: true,
        phone_number: true,
        parent_account_id: true,
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

    // The client guarantees locations are ordered oldest → newest, so the
    // latest fix is the last element. We use this for all "current state"
    // computations (realtime broadcast, geofence eval, last_seen) while
    // every fix in the batch — including this one — gets persisted.
    const latest = dto.locations[dto.locations.length - 1];
    const latestAt = new Date(latest.timestamp);
    const latestQuality = deriveQuality(latest);

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
    }

    // --- GPS spoofing detection ---
    // Fake-GPS apps change the OS location but cannot change which cell
    // tower the modem is attached to. If the reported GPS position is
    // unreasonably far from the connected BTS, the fix is likely spoofed.
    const SPOOF_RANGE_MULTIPLIER = 2;
    const DEFAULT_BTS_RANGE_M = 2000; // fallback when BTS has no range data
    let spoofingSuspected = false;
    let gpsBtsDistanceM: number | null = null;
    if (connectedBts) {
      gpsBtsDistanceM = Math.round(
        haversineMeters(latest.latitude, latest.longitude, connectedBts.lat, connectedBts.lon),
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
      cellTowers: cells.map((c) => ({
        type: c.type,
        mcc: c.mcc,
        mnc: c.mnc,
        lac: c.lac,
        cid: c.cid,
        pci: c.pci ?? null,
        rssi: c.rssi ?? null,
        signalDbm: c.signalDbm ?? null,
        isServing: c.isServing,
      })),
      connectedBts,
      spoofingSuspected,
      gpsBtsDistanceM,
    });

    void this.persistInBackground(
      deviceId,
      dto.locations,
      cells,
      latestAt,
      dto.batteryLevel,
      device.person_name,
      device.parent_account_id,
    );
    if (servingCell) void this.lookupBtsInBackground(servingCell);

    // Consumer policy: only fixes the OS confirmed as real GNSS feed the
    // geofence evaluator. WiFi/cell-based fixes drift hundreds of metres
    // around a stationary device — running the breach check on them
    // produces phantom "ra khỏi vùng" alerts. Also skip when GPS spoofing
    // is suspected.
    if (device.device_geofences.length > 0 && latestQuality === 'gps' && !spoofingSuspected) {
      void this.evaluateDeviceZones(
        deviceId,
        device.person_name,
        device.parent_account_id,
        latest.latitude,
        latest.longitude,
        device.device_geofences.map((dg) => dg.geofence),
        latestAt,
      );
    }

    return { success: true, message: 'Data received' };
  }

  /**
   * Heartbeat — device còn sống nhưng không có fix GPS mới.
   *
   * Khác với saveData:
   *   - KHÔNG insert location_history / cell_tower_history
   *   - KHÔNG chạy geofence eval (không có toạ độ mới để check)
   *   - KHÔNG broadcast device_moved (FE dùng device_heartbeat riêng để
   *     refresh last_seen mà không phải overwrite lat/lon)
   *
   * Vẫn làm:
   *   - Cập nhật devices.last_seen + last_battery
   *   - Low-battery arm/disarm transition + push như ingest
   *   - Clear is_offline_alerted (device vừa thở → online lại)
   *   - Emit battery_update cho dashboard meter
   *   - Emit device_heartbeat cho FE update UI
   */
  async heartbeat(
    deviceId: string,
    dto: HeartbeatDto,
  ): Promise<{ success: true }> {
    if (!deviceId) throw new BadRequestException('Missing device id');

    const device = await this.prisma.devices.findUnique({
      where: { id: deviceId },
      select: {
        id: true,
        person_name: true,
        parent_account_id: true,
        is_low_battery_alerted: true,
        is_offline_alerted: true,
      },
    });
    if (!device) throw new NotFoundException('Device not found');

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

    this.eventsGateway.emitDeviceHeartbeat({
      deviceId,
      batteryLevel: batteryLevel ?? null,
      timestamp: now.toISOString(),
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
        deviceName: device.person_name,
        batteryLevel,
        timestamp: now.toISOString(),
      };
      this.eventsGateway.emitLowBattery(lowEvent);
      void this.alerts.dispatchLowBatteryPush(
        device.parent_account_id,
        lowEvent,
      );
      this.logger.warn(
        `Low battery (heartbeat) device=${deviceId} (${device.person_name ?? '?'}) ${batteryLevel}%`,
      );
    }

    return { success: true };
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
    parentAccountId: string,
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
      void this.alerts.dispatchGeofenceBreachPush(parentAccountId, event);

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
    personName: string | null,
    parentAccountId: string,
  ): Promise<void> {
    try {
      const latest = locations[locations.length - 1];
      // Reverse-geocode only the latest fix — running it for every point in
      // a batch would burn the LocationIQ quota and almost never produce a
      // different district within a ≤60s window.
      const addressPromise = this.reverseGeocode(
        latest.latitude,
        latest.longitude,
      );

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
          deviceName: personName,
          batteryLevel,
          timestamp: latestAt.toISOString(),
        };
        this.eventsGateway.emitLowBattery(lowEvent);
        void this.alerts.dispatchLowBatteryPush(parentAccountId, lowEvent);
        this.logger.warn(
          `Low battery device=${deviceId} (${personName ?? '?'}) ${batteryLevel}%`,
        );
      }

      const address = await addressPromise;
      if (address) {
        await this.prisma.location_history.updateMany({
          where: { device_id: deviceId, recorded_at: latestAt },
          data: { district: address },
        });
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

  private async reverseGeocode(lat: number, lon: number): Promise<string> {
    const key = process.env.LOCATIONIQ_KEY;
    if (!key) return '';
    try {
      const res = await axios.get<{ display_name?: string }>(
        'https://us1.locationiq.com/v1/reverse',
        {
          params: { key, lat, lon, format: 'json' },
          timeout: 8000,
          headers: { 'User-Agent': 'deviceTracking/1.0' },
        },
      );
      return res.data?.display_name ?? '';
    } catch (err) {
      this.logger.warn(
        `LocationIQ error ${lat},${lon}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return '';
    }
  }
}
