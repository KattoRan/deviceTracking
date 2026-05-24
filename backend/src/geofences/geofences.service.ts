import {
  ConflictException,
  ForbiddenException,
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
    person_name: string;
    person_type: string;
    phone_number: string | null;
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

  async create(
    parentAccountId: string,
    dto: CreateGeofenceDto,
  ): Promise<GeofenceDetail> {
    const created = await this.prisma.geofences.create({
      data: {
        parent_account_id: parentAccountId,
        name: dto.name.trim(),
        lat: dto.lat,
        lon: dto.lon,
        radius_m: dto.radiusM,
      },
    });
    this.logger.log(
      `Created geofence ${created.id} (${created.name}) parent=${parentAccountId}`,
    );
    return this.toDetail(created.id, parentAccountId);
  }

  async findAll(parentAccountId: string): Promise<GeofenceListItem[]> {
    const rows = await this.prisma.geofences.findMany({
      where: { parent_account_id: parentAccountId },
      orderBy: { created_at: 'desc' },
      include: { _count: { select: { device_geofences: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      lat: Number(r.lat),
      lon: Number(r.lon),
      radiusM: r.radius_m,
      deviceCount: r._count.device_geofences,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
  }

  async findOne(id: string, parentAccountId: string): Promise<GeofenceDetail> {
    return this.toDetail(id, parentAccountId);
  }

  async update(
    id: string,
    parentAccountId: string,
    dto: UpdateGeofenceDto,
  ): Promise<GeofenceDetail> {
    const existing = await this.prisma.geofences.findUnique({
      where: { id },
      include: { device_geofences: { select: { device_id: true } } },
    });
    if (!existing) throw new NotFoundException('Geofence not found');
    if (existing.parent_account_id !== parentAccountId) {
      throw new ForbiddenException('Không có quyền với vùng này');
    }

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

    if (geometryChanged && existing.device_geofences.length > 0) {
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
          existing.device_geofences.map((dg) =>
            this.reEvaluateDevice(dg.device_id, zone),
          ),
        );
      }
    }

    return this.toDetail(id, parentAccountId);
  }

  async remove(id: string, parentAccountId: string): Promise<void> {
    const existing = await this.prisma.geofences.findUnique({
      where: { id },
      include: { device_geofences: { select: { device_id: true } } },
    });
    if (!existing) throw new NotFoundException('Geofence not found');
    if (existing.parent_account_id !== parentAccountId) {
      throw new ForbiddenException('Không có quyền với vùng này');
    }

    if (existing.device_geofences.length > 0) {
      await Promise.all(
        existing.device_geofences.map((dg) =>
          this.emitReturnedAndClear(dg.device_id, id),
        ),
      );
    }

    await this.prisma.geofences.delete({ where: { id } });
    await this.state.clearGeofence(id);
    this.logger.log(
      `Deleted geofence ${id} (detached ${existing.device_geofences.length} devices)`,
    );
  }

  async assignDevice(
    geofenceId: string,
    parentAccountId: string,
    deviceId: string,
  ): Promise<GeofenceDetail> {
    const [zone, device, existing] = await Promise.all([
      this.prisma.geofences.findUnique({
        where: { id: geofenceId },
        select: {
          id: true,
          name: true,
          lat: true,
          lon: true,
          radius_m: true,
          parent_account_id: true,
        },
      }),
      this.prisma.devices.findUnique({
        where: { id: deviceId },
        select: { id: true, parent_account_id: true },
      }),
      this.prisma.device_geofences.findUnique({
        where: { device_id_geofence_id: { device_id: deviceId, geofence_id: geofenceId } },
      }),
    ]);
    if (!zone) throw new NotFoundException('Geofence not found');
    if (zone.parent_account_id !== parentAccountId) {
      throw new ForbiddenException('Không có quyền với vùng này');
    }
    if (!device) throw new NotFoundException('Device not found');
    if (device.parent_account_id !== parentAccountId) {
      throw new ForbiddenException('Không có quyền với thiết bị này');
    }
    if (existing) {
      throw new ConflictException('Thiết bị đã thuộc vùng này');
    }

    await this.prisma.device_geofences.create({
      data: { device_id: deviceId, geofence_id: geofenceId },
    });

    await this.state.clearPair(deviceId, geofenceId);
    await this.reEvaluateDevice(deviceId, {
      id: zone.id,
      name: zone.name,
      lat: Number(zone.lat),
      lon: Number(zone.lon),
      radius_m: zone.radius_m,
    });

    return this.toDetail(geofenceId, parentAccountId);
  }

  async setDevices(
    geofenceId: string,
    parentAccountId: string,
    deviceIds: string[],
  ): Promise<GeofenceDetail> {
    const zone = await this.prisma.geofences.findUnique({
      where: { id: geofenceId },
      include: { device_geofences: { select: { device_id: true } } },
    });
    if (!zone) throw new NotFoundException('Geofence not found');
    if (zone.parent_account_id !== parentAccountId) {
      throw new ForbiddenException('Không có quyền với vùng này');
    }

    if (deviceIds.length > 0) {
      const devices = await this.prisma.devices.findMany({
        where: { id: { in: deviceIds } },
        select: { id: true, parent_account_id: true },
      });
      for (const id of deviceIds) {
        const d = devices.find((x) => x.id === id);
        if (!d) throw new NotFoundException(`Device ${id} not found`);
        if (d.parent_account_id !== parentAccountId) {
          throw new ForbiddenException(`Không có quyền với thiết bị ${id}`);
        }
      }
    }

    const previous = new Set(zone.device_geofences.map((dg) => dg.device_id));
    const next = new Set(deviceIds);
    const toAdd = [...next].filter((id) => !previous.has(id));
    const toRemove = [...previous].filter((id) => !next.has(id));

    await this.prisma.$transaction([
      ...(toRemove.length > 0
        ? [
            this.prisma.device_geofences.deleteMany({
              where: { geofence_id: geofenceId, device_id: { in: toRemove } },
            }),
          ]
        : []),
      ...(toAdd.length > 0
        ? [
            this.prisma.device_geofences.createMany({
              data: toAdd.map((device_id) => ({ device_id, geofence_id: geofenceId })),
            }),
          ]
        : []),
    ]);

    await Promise.all(
      toRemove.map((id) => this.emitReturnedAndClear(id, geofenceId)),
    );

    const zoneGeo: ZoneGeometry = {
      id: zone.id,
      name: zone.name,
      lat: Number(zone.lat),
      lon: Number(zone.lon),
      radius_m: zone.radius_m,
    };
    await Promise.all(toAdd.map((id) => this.reEvaluateDevice(id, zoneGeo)));

    return this.toDetail(geofenceId, parentAccountId);
  }

  async listActiveBreaches(parentAccountId: string): Promise<GeofenceBreachEvent[]> {
    const all = await this.state.listActiveBreaches();
    if (all.length === 0) return [];

    // Filter by parent ownership — Redis breach state isn't naturally scoped,
    // so we lookup which geofences belong to this parent and intersect.
    const ownedGeofenceIds = new Set(
      (
        await this.prisma.geofences.findMany({
          where: { parent_account_id: parentAccountId },
          select: { id: true },
        })
      ).map((g) => g.id),
    );
    return all.filter((b) => ownedGeofenceIds.has(b.geofenceId));
  }

  async detachDevice(
    geofenceId: string,
    parentAccountId: string,
    deviceId: string,
  ): Promise<GeofenceDetail> {
    const [zone, link] = await Promise.all([
      this.prisma.geofences.findUnique({
        where: { id: geofenceId },
        select: { parent_account_id: true },
      }),
      this.prisma.device_geofences.findUnique({
        where: { device_id_geofence_id: { device_id: deviceId, geofence_id: geofenceId } },
      }),
    ]);
    if (!zone) throw new NotFoundException('Geofence not found');
    if (zone.parent_account_id !== parentAccountId) {
      throw new ForbiddenException('Không có quyền với vùng này');
    }
    if (!link) throw new NotFoundException('Thiết bị không thuộc vùng này');

    await this.prisma.device_geofences.delete({
      where: { device_id_geofence_id: { device_id: deviceId, geofence_id: geofenceId } },
    });
    await this.emitReturnedAndClear(deviceId, geofenceId);

    return this.toDetail(geofenceId, parentAccountId);
  }

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
    const previous = await this.state.get(deviceId, zone.id);

    await this.state.set(deviceId, zone.id, current);

    const device = await this.prisma.devices.findUnique({
      where: { id: deviceId },
      select: { person_name: true },
    });
    const deviceName = device?.person_name ?? null;

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
      await this.state.clearBreach(deviceId, zone.id);
    }

    if (previous !== current) {
      this.eventsGateway.emitGeofenceBreach(event);
      this.logger.log(
        `Re-eval after action: device=${deviceId} zone=${zone.id} ${previous ?? 'null'}→${current} ` +
          `(dist=${Math.round(distanceM)}m, radius=${zone.radius_m}m)`,
      );
    }
  }

  private async emitReturnedAndClear(
    deviceId: string,
    geofenceId: string,
  ): Promise<void> {
    const breaches = await this.state.listActiveBreaches();
    const match = breaches.find(
      (b) => b.deviceId === deviceId && b.geofenceId === geofenceId,
    );
    if (match) {
      this.eventsGateway.emitGeofenceBreach({
        ...match,
        status: 'returned',
        timestamp: new Date().toISOString(),
      });
    }
    await this.state.clearPair(deviceId, geofenceId);
  }

  private async toDetail(
    id: string,
    parentAccountId: string,
  ): Promise<GeofenceDetail> {
    const row = await this.prisma.geofences.findUnique({
      where: { id },
      include: {
        device_geofences: {
          include: {
            device: {
              select: {
                id: true,
                person_name: true,
                person_type: true,
                phone_number: true,
              },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Geofence not found');
    if (row.parent_account_id !== parentAccountId) {
      throw new ForbiddenException('Không có quyền với vùng này');
    }
    return {
      id: row.id,
      name: row.name,
      lat: Number(row.lat),
      lon: Number(row.lon),
      radiusM: row.radius_m,
      deviceCount: row.device_geofences.length,
      created_at: row.created_at,
      updated_at: row.updated_at,
      devices: row.device_geofences.map((dg) => ({
        id: dg.device.id,
        name: dg.device.person_name,
        person_name: dg.device.person_name,
        person_type: dg.device.person_type,
        phone_number: dg.device.phone_number,
      })),
    };
  }
}
