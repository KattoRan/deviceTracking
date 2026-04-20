import { SERVER_HOST } from './env';

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL || `http://${SERVER_HOST}:3001`;

export const API_ENDPOINTS = {
  REGISTER_DEVICE: '/api/v1/devices/register',
  INGEST: '/api/v1/ingest',
} as const;

export const REQUEST_TIMEOUT_MS = 15_000;

/** Socket.IO — same URL as HTTP; NestJS platform-socket.io mounts on it. */
export const SOCKET_CONFIG = {
  url: API_BASE_URL,
  options: {
    transports: ['websocket'] as const,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 3_000,
    reconnectionDelayMax: 10_000,
  },
} as const;

/** Mosquitto MQTT over WebSocket (port 9001). */
export const MQTT_CONFIG = {
  url: process.env.EXPO_PUBLIC_MQTT_URL || `ws://${SERVER_HOST}:9001`,
  options: {
    reconnectPeriod: 5_000,
    connectTimeout: 10_000,
    clean: true,
  },
} as const;

/** 30 s per SPEC §1.4. */
export const TRACKING_INTERVAL_MS = 30_000;
