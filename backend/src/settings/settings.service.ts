import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { EventsGateway } from '../events/events.gateway';
import { PrismaService } from '../prisma/prisma.service';
import {
  TRACKING_INTERVAL_CHOICES,
  type TrackingIntervalSec,
} from './dto/tracking-interval.dto';

const TRACKING_INTERVAL_KEY = 'tracking_interval_sec';
const DEFAULT_INTERVAL_SEC: TrackingIntervalSec = 30;

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => EventsGateway))
    private readonly events: EventsGateway,
  ) {}

  async getTrackingInterval(): Promise<{ intervalSec: number; updatedAt: Date }> {
    const row = await this.prisma.app_settings.findUnique({
      where: { key: TRACKING_INTERVAL_KEY },
    });
    if (!row) {
      return { intervalSec: DEFAULT_INTERVAL_SEC, updatedAt: new Date() };
    }
    const value = this.coerceInterval(row.value);
    return { intervalSec: value, updatedAt: row.updated_at };
  }

  async setTrackingInterval(
    intervalSec: TrackingIntervalSec,
  ): Promise<{ intervalSec: number; updatedAt: Date }> {
    const row = await this.prisma.app_settings.upsert({
      where: { key: TRACKING_INTERVAL_KEY },
      create: { key: TRACKING_INTERVAL_KEY, value: intervalSec as never },
      update: { value: intervalSec as never },
    });

    // Broadcast to every connected mobile client (no room — applies globally).
    // Frontends also listen so the UI can reflect the new value across tabs.
    this.events.emitTrackingIntervalChanged({
      intervalSec,
      updatedAt: row.updated_at.toISOString(),
    });

    this.logger.log(`Global tracking interval set to ${intervalSec}s`);
    return { intervalSec, updatedAt: row.updated_at };
  }

  private coerceInterval(value: unknown): TrackingIntervalSec {
    const n = typeof value === 'number' ? value : Number(value);
    return (TRACKING_INTERVAL_CHOICES as readonly number[]).includes(n)
      ? (n as TrackingIntervalSec)
      : DEFAULT_INTERVAL_SEC;
  }
}
