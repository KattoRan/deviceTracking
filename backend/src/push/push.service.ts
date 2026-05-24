import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import { SubscribePushDto } from './dto/subscribe.dto';

export type PushPayloadType =
  | 'sos'
  | 'geofence_breach'
  | 'low_battery'
  | 'device_offline';

export interface PushPayload {
  type: PushPayloadType;
  title: string;
  body: string;
  /** Deep-link path on the PWA, e.g. /tracking?focus=<deviceId>. */
  url?: string;
  /** Arbitrary data the SW reads (deviceId, sosEventId, ...). */
  data?: Record<string, unknown>;
}

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private vapidConfigured = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');
    const contact =
      this.config.get<string>('VAPID_CONTACT') ?? 'mailto:noreply@example.com';
    if (!publicKey || !privateKey) {
      this.logger.warn(
        'VAPID keys không được cấu hình — Web Push sẽ bị bỏ qua. ' +
          'Chạy `npx web-push generate-vapid-keys` và set VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY.',
      );
      return;
    }
    webpush.setVapidDetails(contact, publicKey, privateKey);
    this.vapidConfigured = true;
    this.logger.log('Web Push VAPID configured');
  }

  getPublicKey(): string | null {
    return this.config.get<string>('VAPID_PUBLIC_KEY') ?? null;
  }

  async subscribe(
    parentAccountId: string,
    dto: SubscribePushDto,
  ): Promise<{ id: string }> {
    const existing = await this.prisma.push_subscriptions.findUnique({
      where: { endpoint: dto.endpoint },
    });
    if (existing) {
      // Endpoint already known — update the owner + keys (browser may have
      // rotated). UNIQUE on endpoint enforces single record per device.
      const updated = await this.prisma.push_subscriptions.update({
        where: { endpoint: dto.endpoint },
        data: {
          parent_account_id: parentAccountId,
          p256dh: dto.keys.p256dh,
          auth: dto.keys.auth,
          user_agent: dto.userAgent ?? null,
          last_used_at: new Date(),
        },
      });
      return { id: updated.id };
    }
    const created = await this.prisma.push_subscriptions.create({
      data: {
        parent_account_id: parentAccountId,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        user_agent: dto.userAgent ?? null,
      },
    });
    this.logger.log(
      `Push subscribed parent=${parentAccountId} endpoint=${dto.endpoint.slice(0, 40)}...`,
    );
    return { id: created.id };
  }

  async unsubscribe(parentAccountId: string, endpoint: string): Promise<void> {
    await this.prisma.push_subscriptions.deleteMany({
      where: { endpoint, parent_account_id: parentAccountId },
    });
  }

  /**
   * Fan-out push tới tất cả subscriptions của 1 parent. Subscriptions hết
   * hạn (HTTP 404/410) sẽ tự bị xoá khỏi DB để giữ table sạch.
   */
  async send(parentAccountId: string, payload: PushPayload): Promise<void> {
    if (!this.vapidConfigured) {
      this.logger.warn(
        `Bỏ qua push (VAPID chưa config) type=${payload.type} parent=${parentAccountId}`,
      );
      return;
    }
    const subs = await this.prisma.push_subscriptions.findMany({
      where: { parent_account_id: parentAccountId },
    });
    if (subs.length === 0) return;

    const json = JSON.stringify(payload);
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            json,
          );
          await this.prisma.push_subscriptions.update({
            where: { id: sub.id },
            data: { last_used_at: new Date() },
          });
        } catch (err: unknown) {
          const status = (err as { statusCode?: number })?.statusCode;
          if (status === 404 || status === 410) {
            await this.prisma.push_subscriptions
              .delete({ where: { id: sub.id } })
              .catch(() => undefined);
            this.logger.log(
              `Pruned expired push subscription ${sub.id} (${status})`,
            );
          } else {
            this.logger.error(
              `Push send failed sub=${sub.id}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }),
    );
  }
}
