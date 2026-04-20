import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as mqtt from 'mqtt';
import { IngestService } from '../ingest/ingest.service';
import type { SubmitDataDto } from '../ingest/dto/submit-data.dto';

const TELEMETRY_TOPIC = 'device/+/telemetry';

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
      this.client?.subscribe(TELEMETRY_TOPIC, { qos: 1 }, (err) => {
        if (err) this.logger.error(`Subscribe failed: ${err.message}`);
        else this.logger.log(`Subscribed ${TELEMETRY_TOPIC}`);
      });
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
    if (parts.length !== 3 || parts[0] !== 'device' || parts[2] !== 'telemetry') {
      return;
    }
    const deviceId = parts[1];

    let parsed: SubmitDataDto;
    try {
      parsed = JSON.parse(payload.toString()) as SubmitDataDto;
    } catch (err) {
      this.logger.warn(
        `Bad JSON on ${topic}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    try {
      await this.ingestService.saveData(deviceId, parsed);
    } catch (err) {
      this.logger.warn(
        `saveData failed for ${deviceId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
