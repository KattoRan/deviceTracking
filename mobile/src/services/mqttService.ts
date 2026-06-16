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
  // Trả client hiện có nếu đã connected hoặc đang connecting (mqtt.js tự reconnect).
  // Không kill client đang connecting — nhiều task handler gọi đồng thời sẽ tạo
  // rapid connect/disconnect loop.
  if (client) return client;

  client = mqtt.connect(MQTT_CONFIG.url, {
    clientId: `device-${deviceId}-${Math.random().toString(16).slice(2, 8)}`,
    clean: MQTT_CONFIG.options.clean,
    reconnectPeriod: MQTT_CONFIG.options.reconnectPeriod,
    connectTimeout: MQTT_CONFIG.options.connectTimeout,
    keepalive: MQTT_CONFIG.options.keepalive,
  });

  client.on('connect', () => { console.log('[mqtt] connected'); notify(true); });
  client.on('close', () => { console.log('[mqtt] disconnected'); notify(false); });
  client.on('error', (e) => { console.warn('[mqtt] error:', e.message); notify(false); });

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
 * Publishes telemetry on `device/{deviceId}/telemetry`.
 * - qos=1 (foreground): waits for broker PUBACK before resolving — guaranteed delivery.
 * - qos=0 (background): resolves immediately after socket write — no PUBACK round-trip,
 *   avoids hanging when Android Doze throttles network.
 * Never rejects — callers fall back to HTTP.
 */
export function publishTelemetry(
  deviceId: string,
  payload: IngestPayload,
  qos: 0 | 1 = 1,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (!client || !connected) {
      resolve(false);
      return;
    }
    client.publish(
      `device/${deviceId}/telemetry`,
      JSON.stringify(payload),
      { qos },
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

/**
 * Waits until MQTT is connected, or resolves false after `ms` milliseconds.
 * Safe to call while already connected — resolves immediately.
 */
export function waitForMqttConnect(ms: number): Promise<boolean> {
  if (connected) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const remove = onMqttConnectionChange((c) => {
      if (c && !done) {
        done = true;
        remove();
        clearTimeout(timer);
        resolve(true);
      }
    });
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        remove();
        resolve(false);
      }
    }, ms);
  });
}
