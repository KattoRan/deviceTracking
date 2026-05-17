import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import axios from 'axios';
import { BtsService } from '../bts/bts.service';
import { EventsGateway } from '../events/events.gateway';
import { GeofenceStateService } from '../geofences/geofence-state.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitDataDto } from './dto/submit-data.dto';
import {
  ConcurrencyQueue,
  isValidCell,
  markServingCell,
  type NormalizedCell,
} from './ingest.utils';

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
        phone_number: true,
        user: { select: { full_name: true } },
        geofence: {
          select: { id: true, name: true, lat: true, lon: true, radius_m: true },
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

    this.eventsGateway.emitDeviceMoved({
      deviceId,
      lat: latest.latitude,
      lon: latest.longitude,
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
        signalDbm: c.signalDbm,
        isServing: c.isServing,
      })),
      connectedBts,
    });

    void this.persistInBackground(deviceId, dto.locations, cells, latestAt);
    if (servingCell) void this.lookupBtsInBackground(servingCell);

    if (device.geofence) {
      void this.evaluateGeofence(
        deviceId,
        device.user?.full_name ?? device.phone_number,
        latest.latitude,
        latest.longitude,
        device.geofence,
        latestAt,
      );
    }

    return { success: true, message: 'Data received' };
  }

  private async evaluateGeofence(
    deviceId: string,
    deviceName: string | null,
    lat: number,
    lon: number,
    geofence: {
      id: string;
      name: string;
      lat: { toString(): string } | number;
      lon: { toString(): string } | number;
      radius_m: number;
    },
    now: Date,
  ): Promise<void> {
    try {
      const centerLat = Number(geofence.lat);
      const centerLon = Number(geofence.lon);
      const distanceM = haversineMeters(lat, lon, centerLat, centerLon);
      const current = distanceM > geofence.radius_m ? 'outside' : 'inside';
      const previous = await this.geofenceState.get(deviceId);
      await this.geofenceState.set(deviceId, current);

      const event = {
        deviceId,
        deviceName,
        geofenceId: geofence.id,
        geofenceName: geofence.name,
        status: (current === 'outside' ? 'outside' : 'returned') as
          | 'outside'
          | 'returned',
        lat,
        lon,
        centerLat,
        centerLon,
        radiusM: geofence.radius_m,
        distanceM: Math.round(distanceM),
        timestamp: now.toISOString(),
      };

      // Reflect current truth in the breach store on EVERY ingest, regardless
      // of whether a transition fired. This keeps the dashboard's
      // /breaches/active list accurate, refreshes the distance/timestamp shown
      // in the persistent banner, and self-heals from any earlier inconsistent
      // state (e.g. ingests that ran before the breach store existed).
      if (current === 'outside') {
        await this.geofenceState.setBreach(event);
      } else {
        await this.geofenceState.clearBreach(deviceId);
      }

      // Socket emit only on transitions — broadcasting every ingest would
      // spam the dashboard. First reading suppresses only the inside case;
      // an already-outside device on first read is worth announcing.
      const isTransition =
        previous === null ? current === 'outside' : previous !== current;
      if (!isTransition) return;

      this.eventsGateway.emitGeofenceBreach(event);

      this.logger.warn(
        `Geofence ${current === 'outside' ? 'BREACH' : 'RETURN'} ` +
          `device=${deviceId} zone=${geofence.id} dist=${Math.round(distanceM)}m`,
      );
    } catch (err) {
      this.logger.error(
        `geofence eval failed for ${deviceId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async persistInBackground(
    deviceId: string,
    locations: { latitude: number; longitude: number; timestamp: number }[],
    cells: NormalizedCell[],
    latestAt: Date,
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

      await this.prisma.$transaction(async (tx) => {
        await tx.location_history.createMany({
          data: locations.map((loc) => ({
            device_id: deviceId,
            latitude: loc.latitude,
            longitude: loc.longitude,
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
              signal_dbm: c.signalDbm,
              pci: c.pci ?? null,
              is_serving: c.isServing,
              recorded_at: latestAt,
            })),
          });
        }

        await tx.devices.update({
          where: { id: deviceId },
          data: { last_seen: latestAt },
        });
      });

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
