import mqtt, { type MqttClient } from 'mqtt';
import { MQTT_CONFIG } from '../config/api';
import type { IngestPayload } from '../models/types';

type ConnectionListener = (connected: boolean) => void;

let client: MqttClient | null = null;
let connected = false;
const connectionListeners = new Set<ConnectionListener>();

function notify(value: boolean): void {
  connected = value;
  for (const cb of connectionListeners) {
    try {
      cb(value);
    } catch {
      // listeners must not throw
    }
  }
}

/**
 * Connects to the Mosquitto broker over WebSocket (default port 9001).
 * Idempotent — calling while already connected returns the existing client.
 * The clientId embeds `deviceId` so the broker can tell devices apart.
 */
export function connectMqtt(deviceId: string): MqttClient {
  if (client && connected) return client;
  if (client) {
    client.end(true);
    client = null;
  }

  client = mqtt.connect(MQTT_CONFIG.url, {
    clientId: `device-${deviceId}-${Math.random().toString(16).slice(2, 8)}`,
    clean: MQTT_CONFIG.options.clean,
    reconnectPeriod: MQTT_CONFIG.options.reconnectPeriod,
    connectTimeout: MQTT_CONFIG.options.connectTimeout,
  });

  client.on('connect', () => notify(true));
  client.on('close', () => notify(false));
  client.on('error', () => notify(false));

  return client;
}

export function disconnectMqtt(): void {
  if (!client) return;
  client.end(true);
  client = null;
  notify(false);
}

export function isMqttConnected(): boolean {
  return connected;
}

/**
 * Publishes telemetry on `device/{deviceId}/telemetry` with QoS 1.
 * Resolves `true` when the broker ACKs, `false` when publish failed or
 * MQTT is not connected. Never rejects — callers fall back to HTTP.
 */
export function publishTelemetry(
  deviceId: string,
  payload: IngestPayload,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (!client || !connected) {
      resolve(false);
      return;
    }
    client.publish(
      `device/${deviceId}/telemetry`,
      JSON.stringify(payload),
      { qos: 1 },
      (err) => resolve(!err),
    );
  });
}

export function onMqttConnectionChange(cb: ConnectionListener): () => void {
  connectionListeners.add(cb);
  cb(connected);
  return () => {
    connectionListeners.delete(cb);
  };
}
