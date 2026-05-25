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
      await Promise.all(
        existing.device_geofences.map((dg) =>
          this.reEvaluateDevice(dg.device_id),
        ),
      );
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

    const affectedDevices = existing.device_geofences.map(
      (dg) => dg.device_id,
    );

    await this.prisma.geofences.delete({ where: { id } });

    // After deleting the zone, the device's breach state may change: maybe
    // the zone we just deleted was the only one keeping it "outside", or
    // the only one keeping it "inside". Re-evaluate against remaining zones.
    if (affectedDevices.length > 0) {
      await Promise.all(
        affectedDevices.map((deviceId) => this.reEvaluateDevice(deviceId)),
      );
    }

    this.logger.log(
      `Deleted geofence ${id} (detached ${affectedDevices.length} devices)`,
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
        select: { id: true, parent_account_id: true },
      }),
      this.prisma.devices.findUnique({
        where: { id: deviceId },
        select: { id: true, parent_account_id: true },
      }),
      this.prisma.device_geofences.findUnique({
        where: {
          device_id_geofence_id: {
            device_id: deviceId,
            geofence_id: geofenceId,
          },
        },
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

    await this.reEvaluateDevice(deviceId);

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
              data: toAdd.map((device_id) => ({
                device_id,
                geofence_id: geofenceId,
              })),
            }),
          ]
        : []),
    ]);

    await Promise.all(
      [...toAdd, ...toRemove].map((id) => this.reEvaluateDevice(id)),
    );

    return this.toDetail(geofenceId, parentAccountId);
  }

  async listActiveBreaches(
    parentAccountId: string,
  ): Promise<GeofenceBreachEvent[]> {
    const all = await this.state.listActiveBreaches();
    if (all.length === 0) return [];

    // Breach state isn't naturally scoped — intersect with devices this
    // parent owns (the device list is small per parent, so the lookup is
    // cheap and avoids leaking other parents' alerts).
    const ownedDeviceIds = new Set(
      (
        await this.prisma.devices.findMany({
          where: { parent_account_id: parentAccountId },
          select: { id: true },
        })
      ).map((d) => d.id),
    );
    return all.filter((b) => ownedDeviceIds.has(b.deviceId));
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
        where: {
          device_id_geofence_id: {
            device_id: deviceId,
            geofence_id: geofenceId,
          },
        },
      }),
    ]);
    if (!zone) throw new NotFoundException('Geofence not found');
    if (zone.parent_account_id !== parentAccountId) {
      throw new ForbiddenException('Không có quyền với vùng này');
    }
    if (!link) throw new NotFoundException('Thiết bị không thuộc vùng này');

    await this.prisma.device_geofences.delete({
      where: {
        device_id_geofence_id: {
          device_id: deviceId,
          geofence_id: geofenceId,
        },
      },
    });
    await this.reEvaluateDevice(deviceId);

    return this.toDetail(geofenceId, parentAccountId);
  }

  /**
   * Recompute the device's breach state against its current set of zones
   * and the most recent GPS fix. Emits a socket event only when the
   * status actually changes (avoid spamming inside→inside no-op events).
   */
  private async reEvaluateDevice(deviceId: string): Promise<void> {
    const device = await this.prisma.devices.findUnique({
      where: { id: deviceId },
      select: {
        person_name: true,
        device_geofences: {
          include: {
            geofence: {
              select: {
                id: true,
                name: true,
                lat: true,
                lon: true,
                radius_m: true,
              },
            },
          },
        },
      },
    });
    if (!device) return;

    const zones = device.device_geofences.map((dg) => dg.geofence);
    const previous = await this.state.getDeviceStatus(deviceId);

    // No zones left → no breach possible. Clear and notify if we were
    // previously broadcasting an "outside" status.
    if (zones.length === 0) {
      const wasOutside = previous === 'outside';
      const prevBreach = wasOutside
        ? await this.state.getDeviceBreach(deviceId)
        : null;
      await this.state.clearDevice(deviceId);
      if (prevBreach) {
        this.eventsGateway.emitGeofenceBreach({
          ...prevBreach,
          status: 'returned',
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }

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

    let nearest: {
      id: string;
      name: string;
      centerLat: number;
      centerLon: number;
      radiusM: number;
      distanceM: number;
    } | null = null;
    let anyInside = false;

    for (const z of zones) {
      const centerLat = Number(z.lat);
      const centerLon = Number(z.lon);
      const distanceM = haversineMeters(lat, lon, centerLat, centerLon);
      if (distanceM <= z.radius_m) anyInside = true;
      if (nearest === null || distanceM < nearest.distanceM) {
        nearest = {
          id: z.id,
          name: z.name,
          centerLat,
          centerLon,
          radiusM: z.radius_m,
          distanceM,
        };
      }
    }
    if (!nearest) return;

    const current: 'inside' | 'outside' = anyInside ? 'inside' : 'outside';
    await this.state.setDeviceStatus(deviceId, current);

    const event: GeofenceBreachEvent = {
      deviceId,
      deviceName: device.person_name ?? null,
      geofenceId: nearest.id,
      geofenceName: nearest.name,
      status: current === 'outside' ? 'outside' : 'returned',
      lat,
      lon,
      centerLat: nearest.centerLat,
      centerLon: nearest.centerLon,
      radiusM: nearest.radiusM,
      distanceM: Math.round(nearest.distanceM),
      timestamp: new Date().toISOString(),
    };

    if (current === 'outside') {
      await this.state.setDeviceBreach(event);
    } else {
      await this.state.clearDeviceBreach(deviceId);
    }

    if (previous !== current) {
      this.eventsGateway.emitGeofenceBreach(event);
      this.logger.log(
        `Re-eval after action: device=${deviceId} ${previous ?? 'null'}→${current} ` +
          `nearest=${nearest.id} dist=${Math.round(nearest.distanceM)}m`,
      );
    }
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
