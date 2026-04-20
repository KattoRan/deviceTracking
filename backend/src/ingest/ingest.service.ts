import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import axios from 'axios';
import { BtsService } from '../bts/bts.service';
import { EventsGateway } from '../events/events.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitDataDto } from './dto/submit-data.dto';
import {
  ConcurrencyQueue,
  isValidCell,
  markServingCell,
  type NormalizedCell,
} from './ingest.utils';

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);
  private readonly btsQueue = new ConcurrencyQueue(2);

  constructor(
    private readonly prisma: PrismaService,
    private readonly btsService: BtsService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  async saveData(
    deviceId: string,
    dto: SubmitDataDto,
  ): Promise<{ success: true; message: string }> {
    if (!deviceId) throw new BadRequestException('Missing device id');
    if (!dto?.location) throw new BadRequestException('Missing location');

    const device = await this.prisma.devices.findUnique({
      where: { id: deviceId },
      select: { id: true },
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

    return { success: true, message: 'Data received' };
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
