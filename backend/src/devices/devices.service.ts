import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventsGateway, type GeofenceBreachEvent } from '../events/events.gateway';
import { GeofenceStateService } from '../geofences/geofence-state.service';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePairingCode } from '../auth/pairing-code.util';
import {
  PairDeviceDto,
  PairDeviceResponseDto,
} from './dto/pair-device.dto';
import type { HistoryQualityMode } from './dto/history-query.dto';

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

function isOnline(lastSeen: Date | null | undefined): boolean {
  return !!lastSeen && Date.now() - new Date(lastSeen).getTime() < ONLINE_WINDOW_MS;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly geofenceState: GeofenceStateService,
    private readonly events: EventsGateway,
  ) {}

  /**
   * Returns the device's currently-active breach payload, or null when the
   * device is inside its zone or has no zone assigned. Public (no JWT) so
   * the mobile client can re-show its banner after an app restart without
   * waiting for the next transition event over the socket.
   */
  async getActiveBreach(deviceId: string): Promise<GeofenceBreachEvent | null> {
    return this.geofenceState.getDeviceBreach(deviceId);
  }

  /**
   * Public (device-scoped, no JWT) lookup of the parent's contact info so the
   * monitored device can show "Liên hệ phụ huynh" on its own screen. We only
   * expose the bits the device actually needs — never the parent's email
   * or pairing code.
   */
  async getParentContact(
    deviceId: string,
  ): Promise<{ displayName: string | null; phoneNumber: string | null }> {
    const device = await this.prisma.devices.findUnique({
      where: { id: deviceId },
      select: {
        parent_account: {
          select: { display_name: true, phone_number: true },
        },
      },
    });
    if (!device) throw new NotFoundException('Device not found');
    return {
      displayName: device.parent_account.display_name,
      phoneNumber: device.parent_account.phone_number,
    };
  }

  async getLockStatus(deviceId: string): Promise<{ locked: boolean }> {
    const device = await this.prisma.devices.findUnique({
      where: { id: deviceId },
      select: { is_locked: true },
    });
    if (!device) throw new NotFoundException('Device not found');
    return { locked: device.is_locked };
  }

  async setLockStatus(
    deviceId: string,
    parentAccountId: string,
    locked: boolean,
  ): Promise<{ locked: boolean }> {
    await this.assertOwnership(deviceId, parentAccountId);

    await this.prisma.devices.update({
      where: { id: deviceId },
      data: { is_locked: locked },
    });

    this.events.emitDeviceLockChanged({ deviceId, locked });
    this.logger.log(`Device ${deviceId} ${locked ? 'LOCKED' : 'UNLOCKED'}`);
    return { locked };
  }

  /**
   * Mobile-side pairing: nhập pairingCode + thông tin người được giám sát →
   * tạo Device dưới ParentAccount tương ứng. Phone optional (1 phụ huynh có
   * thể pair nhiều thiết bị cùng số máy nếu cùng family plan).
   */
  async pair(dto: PairDeviceDto): Promise<PairDeviceResponseDto> {
    const code = normalizePairingCode(dto.pairingCode);
    const parent = await this.prisma.parent_accounts.findUnique({
      where: { pairing_code: code },
      select: { id: true },
    });
    if (!parent) {
      throw new UnauthorizedException('Pairing code không hợp lệ');
    }

    const device = await this.prisma.devices.create({
      data: {
        parent_account_id: parent.id,
        person_name: dto.personName.trim(),
        phone_number: dto.phoneNumber?.trim() || null,
        model: dto.device?.model?.trim() || null,
        type: dto.device?.type?.trim() || null,
        device_os: dto.device?.os?.trim() || null,
      },
      select: { id: true, person_name: true },
    });

    this.logger.log(
      `Paired device=${device.id} (${device.person_name}) to parent=${parent.id}`,
    );
    return {
      deviceId: device.id,
      personName: device.person_name,
    };
  }

  async findAll(parentAccountId: string) {
    const devices = await this.prisma.devices.findMany({
      where: { parent_account_id: parentAccountId },
      orderBy: { registered_at: 'desc' },
    });

    const deviceIds = devices.map((d) => d.id);
    if (deviceIds.length === 0) return [];

    const latestLocations = await this.prisma.$queryRaw<
      Array<{
        device_id: string;
        latitude: string;
        longitude: string;
        district: string | null;
        recorded_at: Date;
      }>
    >`
      SELECT DISTINCT ON (device_id)
        device_id, latitude::text AS latitude, longitude::text AS longitude,
        district, recorded_at
      FROM location_history
      WHERE device_id = ANY(${deviceIds})
      ORDER BY device_id, recorded_at DESC;
    `;
    const locMap = new Map(latestLocations.map((l) => [l.device_id, l]));

    const latestBts = await this.prisma.$queryRaw<
      Array<{ device_id: string; bts_id: number }>
    >`
      SELECT DISTINCT ON (cth.device_id)
        cth.device_id, bs.id AS bts_id
      FROM cell_tower_history cth
      JOIN bts_stations bs
        ON bs.mcc = cth.mcc AND bs.mnc = cth.mnc
       AND bs.lac = cth.lac AND bs.cid = cth.cid
      WHERE cth.device_id = ANY(${deviceIds}) AND cth.is_serving = true
      ORDER BY cth.device_id, cth.recorded_at DESC;
    `;
    const btsMap = new Map(latestBts.map((b) => [b.device_id, b.bts_id]));

    return devices.map((d) => {
      const loc = locMap.get(d.id);
      return {
        id: d.id,
        name: d.person_name,
        person_name: d.person_name,
        phone_number: d.phone_number,
        model: d.model,
        device_os: d.device_os,
        type: d.type,
        latitude: loc ? Number(loc.latitude) : null,
        longitude: loc ? Number(loc.longitude) : null,
        district: loc?.district ?? null,
        bts_id: btsMap.get(d.id) ?? null,
        last_seen: d.last_seen ?? loc?.recorded_at ?? null,
        last_battery: d.last_battery,
        status: isOnline(d.last_seen) ? 'online' : 'offline',
        is_locked: d.is_locked,
      };
    });
  }

  async getLocationHistory(
    deviceId: string,
    parentAccountId: string,
    from?: string,
    to?: string,
    minDistanceMeters?: number,
    qualityMode: HistoryQualityMode = 'gps',
  ) {
    const device = await this.prisma.devices.findUnique({
      where: { id: deviceId },
    });
    if (!device) throw new NotFoundException('Device not found');
    if (device.parent_account_id !== parentAccountId) {
      throw new ForbiddenException('Không có quyền với thiết bị này');
    }

    const now = new Date();
    const fromDate = from
      ? new Date(from)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const toDate = to ? new Date(to) : now;

    // Each tier mode keeps NULL too — rows ingested before the quality
    // column existed shouldn't suddenly disappear after the migration.
    const allowedQualities: string[] =
      qualityMode === 'all'
        ? ['gps', 'approx', 'network']
        : qualityMode === 'gps_approx'
          ? ['gps', 'approx']
          : ['gps'];
    const qualityFilter = Prisma.sql`(quality IS NULL OR quality = ANY(${allowedQualities}))`;

    const rows = await this.prisma.$queryRaw<
      Array<{
        latitude: string;
        longitude: string;
        accuracy_m: number | null;
        quality: string | null;
        district: string | null;
        recorded_at: Date;
      }>
    >`
      SELECT latitude::text AS latitude,
             longitude::text AS longitude,
             accuracy_m,
             quality,
             district,
             recorded_at
      FROM location_history
      WHERE device_id = ${deviceId}
        AND recorded_at >= ${fromDate}
        AND recorded_at <= ${toDate}
        AND ${qualityFilter}
      ORDER BY recorded_at ASC;
    `;

    const minDist = minDistanceMeters ?? 0;
    const points: Array<{
      lat: number;
      lon: number;
      accuracy: number | null;
      quality: string | null;
      district: string | null;
      time: Date;
    }> = [];
    let distanceTotal = 0;
    let prevLat: number | null = null;
    let prevLon: number | null = null;

    for (const row of rows) {
      const lat = Number(row.latitude);
      const lon = Number(row.longitude);
      if (prevLat !== null && prevLon !== null) {
        const stepDist = haversineMeters(prevLat, prevLon, lat, lon);
        if (minDist > 0 && stepDist < minDist) continue;
        distanceTotal += stepDist;
      }
      points.push({
        lat,
        lon,
        accuracy: row.accuracy_m,
        quality: row.quality,
        district: row.district,
        time: row.recorded_at,
      });
      prevLat = lat;
      prevLon = lon;
    }

    const durationMs =
      points.length >= 2
        ? new Date(points[points.length - 1].time).getTime() -
          new Date(points[0].time).getTime()
        : 0;
    const avgSpeedKmh =
      durationMs > 0 ? (distanceTotal / 1000) / (durationMs / 3_600_000) : 0;

    return {
      device: {
        id: device.id,
        name: device.person_name,
        person_name: device.person_name,
        phone_number: device.phone_number,
      },
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      total: points.length,
      distance_total_m: Math.round(distanceTotal),
      duration_ms: durationMs,
      avg_speed_kmh: Math.round(avgSpeedKmh * 10) / 10,
      points,
    };
  }

  async remove(id: string, parentAccountId: string): Promise<void> {
    await this.assertOwnership(id, parentAccountId);

    // location_history, cell_tower_history, sos_events, device_geofences,
    // commands all cascade via ON DELETE CASCADE.
    await this.prisma.devices.delete({ where: { id } });

    // Notify the mobile client (so it can wipe local state and return to
    // the Pairing screen) and any dashboards listening for list refreshes.
    this.events.emitDeviceDeleted({ deviceId: id });

    this.logger.log(`Deleted device=${id} (parent=${parentAccountId})`);
  }

  async findOne(id: string, parentAccountId: string) {
    const device = await this.prisma.devices.findUnique({
      where: { id },
      include: {
        device_geofences: {
          include: { geofence: true },
        },
      },
    });
    if (!device) throw new NotFoundException('Device not found');
    if (device.parent_account_id !== parentAccountId) {
      throw new ForbiddenException('Không có quyền với thiết bị này');
    }

    const [location] = await this.prisma.$queryRaw<
      Array<{
        latitude: string;
        longitude: string;
        district: string | null;
        recorded_at: Date;
      }>
    >`
      SELECT latitude::text AS latitude, longitude::text AS longitude,
             district, recorded_at
      FROM location_history
      WHERE device_id = ${id}
      ORDER BY recorded_at DESC
      LIMIT 1;
    `;

    const [cellTower] = await this.prisma.$queryRaw<
      Array<{
        mcc: number | null;
        mnc: number | null;
        lac: number | null;
        cid: number | null;
        pci: number | null;
        type: string | null;
        rssi: number | null;
        signal_dbm: number | null;
        recorded_at: Date;
        bts_id: number | null;
        bts_lat: string | null;
        bts_lon: string | null;
        radio: string | null;
        range: number | null;
      }>
    >`
      SELECT
        cth.mcc, cth.mnc, cth.lac, cth.cid, cth.pci, cth.type,
        cth.rssi, cth.signal_dbm, cth.recorded_at,
        bs.id AS bts_id,
        bs.lat::text AS bts_lat,
        bs.lon::text AS bts_lon,
        bs.radio, bs.range
      FROM cell_tower_history cth
      LEFT JOIN bts_stations bs
        ON bs.mcc = cth.mcc AND bs.mnc = cth.mnc
       AND bs.lac = cth.lac AND bs.cid = cth.cid
      WHERE cth.device_id = ${id} AND cth.is_serving = true
      ORDER BY cth.recorded_at DESC
      LIMIT 1;
    `;

    let distanceToBts: number | null = null;
    if (location && cellTower?.bts_lat && cellTower?.bts_lon) {
      distanceToBts = haversineMeters(
        Number(location.latitude),
        Number(location.longitude),
        Number(cellTower.bts_lat),
        Number(cellTower.bts_lon),
      );
    }

    return {
      id: device.id,
      person_name: device.person_name,
      phone_number: device.phone_number,
      model: device.model,
      device_os: device.device_os,
      type: device.type,
      registered_at: device.registered_at,
      status: isOnline(device.last_seen) ? 'online' : 'offline',
      last_battery: device.last_battery,
      is_locked: device.is_locked,
      geofences: device.device_geofences.map((dg) => ({
        id: dg.geofence.id,
        name: dg.geofence.name,
        latitude: Number(dg.geofence.lat),
        longitude: Number(dg.geofence.lon),
        radius_m: dg.geofence.radius_m,
      })),
      location: location
        ? {
            latitude: Number(location.latitude),
            longitude: Number(location.longitude),
            district: location.district,
            recorded_at: location.recorded_at,
          }
        : null,
      last_seen: device.last_seen ?? location?.recorded_at ?? null,
      cell: cellTower
        ? {
            mcc: cellTower.mcc,
            mnc: cellTower.mnc,
            lac: cellTower.lac,
            cid: cellTower.cid,
            pci: cellTower.pci,
            type: cellTower.type,
            rssi: cellTower.rssi,
            signal_dbm: cellTower.signal_dbm,
            recorded_at: cellTower.recorded_at,
          }
        : null,
      bts: cellTower?.bts_id
        ? {
            id: cellTower.bts_id,
            radio: cellTower.radio,
            range: cellTower.range,
            latitude: cellTower.bts_lat ? Number(cellTower.bts_lat) : null,
            longitude: cellTower.bts_lon ? Number(cellTower.bts_lon) : null,
            distance_m: distanceToBts,
          }
        : null,
    };
  }

  private async assertOwnership(
    deviceId: string,
    parentAccountId: string,
  ): Promise<void> {
    const device = await this.prisma.devices.findUnique({
      where: { id: deviceId },
      select: { parent_account_id: true },
    });
    if (!device) throw new NotFoundException('Device not found');
    if (device.parent_account_id !== parentAccountId) {
      throw new ForbiddenException('Không có quyền với thiết bị này');
    }
  }
}
