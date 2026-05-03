import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EventsGateway,
  type GeofenceBreachEvent,
} from '../events/events.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGeofenceDto } from './dto/create-geofence.dto';
import { UpdateGeofenceDto } from './dto/update-geofence.dto';
import { GeofenceStateService } from './geofence-state.service';

export interface GeofenceListItem {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
  deviceCount: number;
  created_at: Date;
  updated_at: Date;
}

export interface GeofenceDetail extends GeofenceListItem {
  devices: Array<{
    id: string;
    name: string;
    phone_number: string;
  }>;
}

interface ZoneGeometry {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radius_m: number;
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
export class GeofencesService {
  private readonly logger = new Logger(GeofencesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: GeofenceStateService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  async create(dto: CreateGeofenceDto): Promise<GeofenceDetail> {
    const created = await this.prisma.geofences.create({
      data: {
        name: dto.name.trim(),
        lat: dto.lat,
        lon: dto.lon,
        radius_m: dto.radiusM,
      },
    });
    this.logger.log(`Created geofence ${created.id} (${created.name})`);
    return this.toDetail(created.id);
  }

  async findAll(): Promise<GeofenceListItem[]> {
    const rows = await this.prisma.geofences.findMany({
      orderBy: { created_at: 'desc' },
      include: { _count: { select: { devices: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      lat: Number(r.lat),
      lon: Number(r.lon),
      radiusM: r.radius_m,
      deviceCount: r._count.devices,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
  }

  async findOne(id: string): Promise<GeofenceDetail> {
    return this.toDetail(id);
  }

  async update(id: string, dto: UpdateGeofenceDto): Promise<GeofenceDetail> {
    const existing = await this.prisma.geofences.findUnique({
      where: { id },
      include: { devices: { select: { id: true } } },
    });
    if (!existing) throw new NotFoundException('Geofence not found');

    const data: {
      name?: string;
      lat?: number;
      lon?: number;
      radius_m?: number;
    } = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.lat !== undefined) data.lat = dto.lat;
    if (dto.lon !== undefined) data.lon = dto.lon;
    if (dto.radiusM !== undefined) data.radius_m = dto.radiusM;

    const geometryChanged =
      dto.lat !== undefined ||
      dto.lon !== undefined ||
      dto.radiusM !== undefined;

    await this.prisma.geofences.update({ where: { id }, data });

    // Geometry changed → re-evaluate every assigned device against the new
    // shape using its last known location, and emit transition events so the
    // mobile bell + web banners reflect reality immediately instead of
    // waiting up to one ingest interval (~30s).
    if (geometryChanged && existing.devices.length > 0) {
      const updated = await this.prisma.geofences.findUnique({
        where: { id },
        select: { id: true, name: true, lat: true, lon: true, radius_m: true },
      });
      if (updated) {
        const zone: ZoneGeometry = {
          id: updated.id,
          name: updated.name,
          lat: Number(updated.lat),
          lon: Number(updated.lon),
          radius_m: updated.radius_m,
        };
        await Promise.all(
          existing.devices.map((d) => this.reEvaluateDevice(d.id, zone)),
        );
      }
    }

    return this.toDetail(id);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.geofences.findUnique({
      where: { id },
      include: { devices: { select: { id: true } } },
    });
    if (!existing) throw new NotFoundException('Geofence not found');

    // Mobile/web clients are listening for socket events to know when the
    // alert resolved. ON DELETE SET NULL detaches devices but the cache
    // wouldn't tell anyone — emit a synthetic 'returned' first.
    if (existing.devices.length > 0) {
      await Promise.all(
        existing.devices.map((d) => this.clearDeviceWithReturnedEvent(d.id)),
      );
    }

    await this.prisma.geofences.delete({ where: { id } });
    this.logger.log(
      `Deleted geofence ${id} (detached ${existing.devices.length} devices)`,
    );
  }

  async assignDevice(
    geofenceId: string,
    deviceId: string,
  ): Promise<GeofenceDetail> {
    const [zone, device] = await Promise.all([
      this.prisma.geofences.findUnique({
        where: { id: geofenceId },
        select: { id: true, name: true, lat: true, lon: true, radius_m: true },
      }),
      this.prisma.devices.findUnique({
        where: { id: deviceId },
        select: { id: true, geofence_id: true },
      }),
    ]);
    if (!zone) throw new NotFoundException('Geofence not found');
    if (!device) throw new NotFoundException('Device not found');
    if (device.geofence_id === geofenceId) {
      throw new ConflictException('Thiết bị đã thuộc vùng này');
    }

    await this.prisma.devices.update({
      where: { id: deviceId },
      data: { geofence_id: geofenceId },
    });

    // Wipe whatever state was cached against the old zone (if any), then
    // immediately re-evaluate against the new zone using last known location.
    await this.state.clear(deviceId);
    await this.reEvaluateDevice(deviceId, {
      id: zone.id,
      name: zone.name,
      lat: Number(zone.lat),
      lon: Number(zone.lon),
      radius_m: zone.radius_m,
    });

    return this.toDetail(geofenceId);
  }

  async listActiveBreaches(): Promise<GeofenceBreachEvent[]> {
    return this.state.listActiveBreaches();
  }

  async detachDevice(
    geofenceId: string,
    deviceId: string,
  ): Promise<GeofenceDetail> {
    const device = await this.prisma.devices.findUnique({
      where: { id: deviceId },
      select: { id: true, geofence_id: true },
    });
    if (!device) throw new NotFoundException('Device not found');
    if (device.geofence_id !== geofenceId) {
      throw new NotFoundException('Thiết bị không thuộc vùng này');
    }

    await this.prisma.devices.update({
      where: { id: deviceId },
      data: { geofence_id: null },
    });
    await this.clearDeviceWithReturnedEvent(deviceId);

    return this.toDetail(geofenceId);
  }

  /**
   * Compares a device's last known location against `zone`, updates the cache
   * with the resulting state, and emits a transition event whenever the cache
   * actually changed. Used after admin actions that mutate which devices
   * belong to a zone or change the zone's shape.
   *
   * Skips silently when there's no location yet — the next ingest will
   * baseline naturally.
   */
  private async reEvaluateDevice(
    deviceId: string,
    zone: ZoneGeometry,
  ): Promise<void> {
    const rows = await this.prisma.$queryRaw<
      Array<{ latitude: string; longitude: string }>
    >`
      SELECT latitude::text AS latitude, longitude::text AS longitude
      FROM location_history
      WHERE device_id = ${deviceId}
      ORDER BY recorded_at DESC
      LIMIT 1;
    `;
    if (rows.length === 0) return;

    const lat = Number(rows[0].latitude);
    const lon = Number(rows[0].longitude);
    const distanceM = haversineMeters(lat, lon, zone.lat, zone.lon);
    const current = distanceM > zone.radius_m ? 'outside' : 'inside';
    const previous = await this.state.get(deviceId);

    await this.state.set(deviceId, current);

    const device = await this.prisma.devices.findUnique({
      where: { id: deviceId },
      select: {
        phone_number: true,
        user: { select: { full_name: true } },
      },
    });
    const deviceName = device?.user?.full_name ?? device?.phone_number ?? null;

    const event: GeofenceBreachEvent = {
      deviceId,
      deviceName,
      geofenceId: zone.id,
      geofenceName: zone.name,
      status: current === 'outside' ? 'outside' : 'returned',
      lat,
      lon,
      centerLat: zone.lat,
      centerLon: zone.lon,
      radiusM: zone.radius_m,
      distanceM: Math.round(distanceM),
      timestamp: new Date().toISOString(),
    };

    if (current === 'outside') {
      await this.state.setBreach(event);
    } else {
      await this.state.clearBreach(deviceId);
    }

    if (previous !== current) {
      this.eventsGateway.emitGeofenceBreach(event);
      this.logger.log(
        `Re-eval after admin action: device=${deviceId} ${previous ?? 'null'}→${current} ` +
          `(dist=${Math.round(distanceM)}m, radius=${zone.radius_m}m)`,
      );
    }
  }

  /**
   * Detach / zone removal path: device no longer has a zone, so any cached
   * breach must be announced as 'returned' (so the mobile bell goes back to
   * neutral and the web admin sees the entry drop) before we wipe the cache.
   */
  private async clearDeviceWithReturnedEvent(deviceId: string): Promise<void> {
    const active = await this.state.getBreach(deviceId);
    if (active) {
      this.eventsGateway.emitGeofenceBreach({
        ...active,
        status: 'returned',
        timestamp: new Date().toISOString(),
      });
    }
    await this.state.clear(deviceId);
  }

  private async toDetail(id: string): Promise<GeofenceDetail> {
    const row = await this.prisma.geofences.findUnique({
      where: { id },
      include: {
        devices: {
          select: {
            id: true,
            phone_number: true,
            user: { select: { full_name: true } },
          },
          orderBy: { registered_at: 'desc' },
        },
      },
    });
    if (!row) throw new NotFoundException('Geofence not found');
    return {
      id: row.id,
      name: row.name,
      lat: Number(row.lat),
      lon: Number(row.lon),
      radiusM: row.radius_m,
      deviceCount: row.devices.length,
      created_at: row.created_at,
      updated_at: row.updated_at,
      devices: row.devices.map((d) => ({
        id: d.id,
        name: d.user?.full_name ?? d.phone_number,
        phone_number: d.phone_number,
      })),
    };
  }
}
