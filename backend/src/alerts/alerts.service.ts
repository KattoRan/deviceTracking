import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  EventsGateway,
  type GeofenceBreachEvent,
  type LowBatteryEvent,
} from '../events/events.gateway';
import { PrismaService } from '../prisma/prisma.service';

const OFFLINE_THRESHOLD_MS = 5 * 60 * 1000;
const OFFLINE_THRESHOLD_MIN = OFFLINE_THRESHOLD_MS / 60_000;

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async detectOfflineDevices(): Promise<void> {
    const cutoff = new Date(Date.now() - OFFLINE_THRESHOLD_MS);
    const stale = await this.prisma.devices.findMany({
      where: {
        is_offline_alerted: false,
        last_seen: { not: null, lt: cutoff },
      },
      select: {
        id: true,
        parent_account_id: true,
        person_name: true,
        last_seen: true,
      },
    });
    if (stale.length === 0) return;

    this.logger.warn(`Found ${stale.length} newly-offline device(s)`);
    for (const d of stale) {
      await this.prisma.devices.update({
        where: { id: d.id },
        data: { is_offline_alerted: true },
      });
      this.events.emitDeviceOffline({
        deviceId: d.id,
        deviceName: d.person_name,
        lastSeen: d.last_seen ? d.last_seen.toISOString() : null,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async dispatchLowBatteryPush(
    _parentAccountId: string,
    _event: LowBatteryEvent,
  ): Promise<void> {
    // Web Push removed — low battery alert đã có qua Socket.IO
  }

  async dispatchGeofenceBreachPush(
    _parentAccountId: string,
    event: GeofenceBreachEvent,
  ): Promise<void> {
    // Web Push removed — geofence breach alert đã có qua Socket.IO
    if (event.status !== 'outside') return;
  }
}
