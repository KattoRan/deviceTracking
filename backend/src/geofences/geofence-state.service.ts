import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { GeofenceBreachEvent } from '../events/events.gateway';
import { REDIS_CLIENT } from '../redis/redis.module';

export type GeofenceStatus = 'inside' | 'outside';

const STATE_PREFIX = 'gf:state';
const BREACH_PREFIX = 'gf:breach';

/**
 * Per-device geofence presence cache. Two parallel Redis namespaces:
 *   - gf:state:<deviceId>  = 'inside' | 'outside' — drives transition detection.
 *   - gf:breach:<deviceId> = JSON of the latest outside-event — drives the
 *     "still outside" persistent banner. Set when transitioning out, cleared
 *     when transitioning back in (or when the device is detached / the zone
 *     is deleted), so the dashboard can list every device currently in
 *     violation at any moment, even on first page load.
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

  async get(deviceId: string): Promise<GeofenceStatus | null> {
    const raw = await this.redis.get(this.stateKey(deviceId));
    if (raw === 'inside' || raw === 'outside') return raw;
    return null;
  }

  async set(deviceId: string, status: GeofenceStatus): Promise<void> {
    await this.redis.set(this.stateKey(deviceId), status);
  }

  async clear(deviceId: string): Promise<void> {
    await this.redis.del(this.stateKey(deviceId), this.breachKey(deviceId));
  }

  async clearMany(deviceIds: readonly string[]): Promise<void> {
    if (deviceIds.length === 0) return;
    const keys: string[] = [];
    for (const id of deviceIds) {
      keys.push(this.stateKey(id), this.breachKey(id));
    }
    await this.redis.del(...keys);
  }

  async setBreach(event: GeofenceBreachEvent): Promise<void> {
    await this.redis.set(this.breachKey(event.deviceId), JSON.stringify(event));
  }

  async clearBreach(deviceId: string): Promise<void> {
    await this.redis.del(this.breachKey(deviceId));
  }

  async getBreach(deviceId: string): Promise<GeofenceBreachEvent | null> {
    const raw = await this.redis.get(this.breachKey(deviceId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as GeofenceBreachEvent;
    } catch {
      return null;
    }
  }

  async listActiveBreaches(): Promise<GeofenceBreachEvent[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.scan(
        cursor,
        'MATCH',
        `${BREACH_PREFIX}:*`,
        'COUNT',
        200,
      );
      keys.push(...batch);
      cursor = next;
    } while (cursor !== '0');
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
}
