import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as mqtt from 'mqtt';
import { IngestService } from '../ingest/ingest.service';
import type { HeartbeatDto } from '../ingest/dto/heartbeat.dto';
import type { SubmitDataDto } from '../ingest/dto/submit-data.dto';

const TELEMETRY_TOPIC = 'device/+/telemetry';
const HEARTBEAT_TOPIC = 'device/+/heartbeat';

/**
 * Subscribes to `device/{deviceId}/telemetry` on the MQTT broker and hands
 * each message off to IngestService. MQTT is the primary path from mobile;
 * HTTP /api/v1/ingest is the fallback when the broker is unreachable.
 */
@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private client: mqtt.MqttClient | null = null;

  constructor(private readonly ingestService: IngestService) {}

  onModuleInit() {
    const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';

    this.client = mqtt.connect(brokerUrl, {
      clientId: `deviceTracking-backend-${process.pid}`,
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: 10_000,
    });

    this.client.on('connect', () => {
      this.logger.log(`Connected to MQTT broker ${brokerUrl}`);
      this.client?.subscribe(
        [TELEMETRY_TOPIC, HEARTBEAT_TOPIC],
        { qos: 1 },
        (err, granted) => {
          if (err) this.logger.error(`Subscribe failed: ${err.message}`);
          else
            this.logger.log(
              `Subscribed ${(granted ?? []).map((g) => g.topic).join(', ')}`,
            );
        },
      );
    });

    this.client.on('reconnect', () =>
      this.logger.warn('Reconnecting to MQTT broker...'),
    );
    this.client.on('error', (err) =>
      this.logger.error(`MQTT error: ${err.message}`),
    );
    this.client.on('message', (topic, payload) => {
      void this.handleMessage(topic, payload);
    });
  }

  onModuleDestroy() {
    if (!this.client) return;
    return new Promise<void>((resolve) => {
      this.client!.end(false, {}, () => {
        this.logger.log('MQTT client disconnected');
        resolve();
      });
    });
  }

  private async handleMessage(topic: string, payload: Buffer): Promise<void> {
    const parts = topic.split('/');
    if (parts.length !== 3 || parts[0] !== 'device') return;
    const deviceId = parts[1];
    const kind = parts[2];
    if (kind !== 'telemetry' && kind !== 'heartbeat') return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload.toString());
    } catch (err) {
      this.logger.warn(
        `Bad JSON on ${topic}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    try {
      if (kind === 'telemetry') {
        await this.ingestService.saveData(deviceId, parsed as SubmitDataDto);
      } else {
        await this.ingestService.heartbeat(deviceId, parsed as HeartbeatDto);
      }
    } catch (err) {
      this.logger.warn(
        `${kind} failed for ${deviceId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
