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
    if (!dto?.location) throw new BadRequestException('Missing location');

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

    const now = new Date();

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
      lat: dto.location.latitude,
      lon: dto.location.longitude,
      cid: servingCell?.cid ?? null,
      lac: servingCell?.lac ?? null,
      signalDbm: servingCell?.signalDbm ?? null,
      timestamp: now.toISOString(),
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

    void this.persistInBackground(deviceId, dto.location, cells, now);
    if (servingCell) void this.lookupBtsInBackground(servingCell);

    if (device.geofence) {
      void this.evaluateGeofence(
        deviceId,
        device.user?.full_name ?? device.phone_number,
        dto.location.latitude,
        dto.location.longitude,
        device.geofence,
        now,
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
    location: { latitude: number; longitude: number },
    cells: NormalizedCell[],
    now: Date,
  ): Promise<void> {
    try {
      const addressPromise = this.reverseGeocode(
        location.latitude,
        location.longitude,
      );

      await this.prisma.$transaction(async (tx) => {
        await tx.location_history.create({
          data: {
            device_id: deviceId,
            latitude: location.latitude,
            longitude: location.longitude,
            recorded_at: now,
          },
        });

        if (cells.length > 0) {
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
              recorded_at: now,
            })),
          });
        }

        await tx.devices.update({
          where: { id: deviceId },
          data: { last_seen: now },
        });
      });

      const address = await addressPromise;
      if (address) {
        await this.prisma.location_history.updateMany({
          where: { device_id: deviceId, recorded_at: now },
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
