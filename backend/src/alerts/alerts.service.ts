import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  EventsGateway,
  type GeofenceBreachEvent,
  type LowBatteryEvent,
} from '../events/events.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';

const OFFLINE_THRESHOLD_MS = 5 * 60 * 1000;
const OFFLINE_THRESHOLD_MIN = OFFLINE_THRESHOLD_MS / 60_000;

/**
 * Tổng hợp các alert cron-based (offline) + bắt cầu socket events sang
 * Web Push (low_battery, geofence_breach). SOS không qua module này vì
 * SosService gọi push trực tiếp để đảm bảo độ trễ thấp nhất.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly events: EventsGateway,
  ) {}

  /**
   * Mỗi phút quét devices có last_seen quá ngưỡng mà chưa được alert.
   * Set flag để không spam push trong những lần quét tiếp theo; flag sẽ
   * tự reset khi device gửi heartbeat (ingest.service.persistInBackground).
   * Cron 1 phút + ngưỡng 5 phút → trễ cảnh báo tối đa ~6 phút, phù hợp
   * app giám sát trẻ em / người già.
   */
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
      const lastSeenIso = d.last_seen ? d.last_seen.toISOString() : null;
      const nowIso = new Date().toISOString();
      this.events.emitDeviceOffline({
        deviceId: d.id,
        deviceName: d.person_name,
        lastSeen: lastSeenIso,
        timestamp: nowIso,
      });
      void this.push.send(d.parent_account_id, {
        type: 'device_offline',
        title: '⚠️ Thiết bị mất kết nối',
        body: `${d.person_name} không gửi tín hiệu hơn ${OFFLINE_THRESHOLD_MIN} phút.`,
        url: `/tracking?focus=${d.id}`,
        data: { deviceId: d.id, lastSeen: lastSeenIso },
      });
    }
  }

  /**
   * Bridge từ event socket (do ingest.service emit) sang push. Không phải
   * mọi consumer đều cần push — frontend đã có socket — nên giữ tách bạch.
   */
  async dispatchLowBatteryPush(
    parentAccountId: string,
    event: LowBatteryEvent,
  ): Promise<void> {
    await this.push.send(parentAccountId, {
      type: 'low_battery',
      title: '🔋 Pin yếu',
      body: `${event.deviceName ?? 'Thiết bị'} còn ${event.batteryLevel}% pin. Hãy nhắc người thân sạc.`,
      url: `/tracking?focus=${event.deviceId}`,
      data: { deviceId: event.deviceId, batteryLevel: event.batteryLevel },
    });
  }

  async dispatchGeofenceBreachPush(
    parentAccountId: string,
    event: GeofenceBreachEvent,
  ): Promise<void> {
    // Chỉ push khi RA khỏi vùng — sự kiện "returned" để frontend hiển thị
    // toast/dismiss, không cần wake notification.
    if (event.status !== 'outside') return;
    await this.push.send(parentAccountId, {
      type: 'geofence_breach',
      title: '📍 Ra khỏi vùng an toàn',
      body:
        `${event.deviceName ?? 'Thiết bị'} đã ra khỏi "${event.geofenceName}" ` +
        `(${event.distanceM}m).`,
      url: `/tracking?focus=${event.deviceId}`,
      data: {
        deviceId: event.deviceId,
        geofenceId: event.geofenceId,
        distanceM: event.distanceM,
      },
    });
  }
}
