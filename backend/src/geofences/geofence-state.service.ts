import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { GeofenceBreachEvent } from '../events/events.gateway';
import { REDIS_CLIENT } from '../redis/redis.module';

export type GeofenceStatus = 'inside' | 'outside';

const STATE_PREFIX = 'gf:state';
const BREACH_PREFIX = 'gf:breach';

/**
 * Device-level presence cache. A device can belong to multiple zones (n:n)
 * but we collapse them into a single status: a device is "inside" as long
 * as it is within ANY of its assigned zones, and "outside" only when it
 * leaves ALL of them. The breach payload references the zone the device
 * is closest to so the UI has a concrete reference point.
 */
@Injectable()
export class GeofenceStateService {
  private readonly logger = new Logger(GeofenceStateService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private stateKey(deviceId: string): string {
    return `${STATE_PREFIX}:${deviceId}`;
  }

  private breachKey(deviceId: string): string {
    return `${BREACH_PREFIX}:${deviceId}`;
  }

  async getDeviceStatus(deviceId: string): Promise<GeofenceStatus | null> {
    const raw = await this.redis.get(this.stateKey(deviceId));
    if (raw === 'inside' || raw === 'outside') return raw;
    return null;
  }

  async setDeviceStatus(
    deviceId: string,
    status: GeofenceStatus,
  ): Promise<void> {
    await this.redis.set(this.stateKey(deviceId), status);
  }

  /** Wipe both state + breach entries for a device. */
  async clearDevice(deviceId: string): Promise<void> {
    await this.redis.del(this.stateKey(deviceId), this.breachKey(deviceId));
  }

  /**
   * Cached breach for a device — null when inside any zone or never
   * evaluated. Mobile fetches this for the persistent banner after restart
   * so the user doesn't have to wait for the next ingest.
   */
  async getDeviceBreach(deviceId: string): Promise<GeofenceBreachEvent | null> {
    const raw = await this.redis.get(this.breachKey(deviceId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as GeofenceBreachEvent;
    } catch {
      return null;
    }
  }

  async setDeviceBreach(event: GeofenceBreachEvent): Promise<void> {
    await this.redis.set(this.breachKey(event.deviceId), JSON.stringify(event));
  }

  async clearDeviceBreach(deviceId: string): Promise<void> {
    await this.redis.del(this.breachKey(deviceId));
  }

  async listActiveBreaches(): Promise<GeofenceBreachEvent[]> {
    const keys = await this.scanKeys(`${BREACH_PREFIX}:*`);
    if (keys.length === 0) return [];
    const values = await this.redis.mget(...keys);
    const result: GeofenceBreachEvent[] = [];
    for (const raw of values) {
      if (!raw) continue;
      try {
        result.push(JSON.parse(raw) as GeofenceBreachEvent);
      } catch (err) {
        this.logger.warn(
          `Skipping malformed breach payload: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return result;
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        200,
      );
      keys.push(...batch);
      cursor = next;
    } while (cursor !== '0');
    return keys;
  }
}
