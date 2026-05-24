import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { GeofenceBreachEvent } from '../events/events.gateway';
import { REDIS_CLIENT } from '../redis/redis.module';

export type GeofenceStatus = 'inside' | 'outside';

const STATE_PREFIX = 'gf:state';
const BREACH_PREFIX = 'gf:breach';

/**
 * Per-(device, geofence) presence cache. Keys are scoped by both ids because
 * a single device can belong to multiple zones (n:n) — being outside zone A
 * doesn't tell us anything about zone B. The dashboard's "active breaches"
 * list is the union across all (deviceId, geofenceId) pairs.
 */
@Injectable()
export class GeofenceStateService {
  private readonly logger = new Logger(GeofenceStateService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private stateKey(deviceId: string, geofenceId: string): string {
    return `${STATE_PREFIX}:${deviceId}:${geofenceId}`;
  }

  private breachKey(deviceId: string, geofenceId: string): string {
    return `${BREACH_PREFIX}:${deviceId}:${geofenceId}`;
  }

  async get(
    deviceId: string,
    geofenceId: string,
  ): Promise<GeofenceStatus | null> {
    const raw = await this.redis.get(this.stateKey(deviceId, geofenceId));
    if (raw === 'inside' || raw === 'outside') return raw;
    return null;
  }

  async set(
    deviceId: string,
    geofenceId: string,
    status: GeofenceStatus,
  ): Promise<void> {
    await this.redis.set(this.stateKey(deviceId, geofenceId), status);
  }

  async clearPair(deviceId: string, geofenceId: string): Promise<void> {
    await this.redis.del(
      this.stateKey(deviceId, geofenceId),
      this.breachKey(deviceId, geofenceId),
    );
  }

  /** Wipe all state/breach entries for a device across every zone. */
  async clearDevice(deviceId: string): Promise<void> {
    const patterns = [
      `${STATE_PREFIX}:${deviceId}:*`,
      `${BREACH_PREFIX}:${deviceId}:*`,
    ];
    for (const pattern of patterns) {
      await this.scanAndDelete(pattern);
    }
  }

  /** Wipe all state/breach entries for a geofence across every device. */
  async clearGeofence(geofenceId: string): Promise<void> {
    await this.scanAndDelete(`${STATE_PREFIX}:*:${geofenceId}`);
    await this.scanAndDelete(`${BREACH_PREFIX}:*:${geofenceId}`);
  }

  /**
   * Cached breach for a single (device, geofence) — null when inside or
   * never evaluated. Mobile fetches this for the persistent banner after
   * restart so the user doesn't have to wait for the next ingest.
   */
  async getDeviceBreach(deviceId: string): Promise<GeofenceBreachEvent | null> {
    const keys = await this.scanKeys(`${BREACH_PREFIX}:${deviceId}:*`);
    if (keys.length === 0) return null;
    const values = await this.redis.mget(...keys);
    for (const raw of values) {
      if (!raw) continue;
      try {
        return JSON.parse(raw) as GeofenceBreachEvent;
      } catch {
        // ignore malformed entry
      }
    }
    return null;
  }

  async setBreach(event: GeofenceBreachEvent): Promise<void> {
    await this.redis.set(
      this.breachKey(event.deviceId, event.geofenceId),
      JSON.stringify(event),
    );
  }

  async clearBreach(deviceId: string, geofenceId: string): Promise<void> {
    await this.redis.del(this.breachKey(deviceId, geofenceId));
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

  private async scanAndDelete(pattern: string): Promise<void> {
    const keys = await this.scanKeys(pattern);
    if (keys.length === 0) return;
    await this.redis.del(...keys);
  }
}
