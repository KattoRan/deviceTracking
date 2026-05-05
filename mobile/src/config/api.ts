/**
 * Cấu hình endpoint mobile. Vì project không dùng Expo Go (chỉ build APK/IPA
 * qua `expo run:android` / `expo run:ios`), URL phải khai báo tường minh
 * trong `.env` — không tự suy luận từ Metro hostUri.
 *
 * Quy ước:
 *   - URL trong env LUÔN kết thúc bằng `/`
 *   - Endpoint paths trong code KHÔNG có `/` ở đầu
 *   → ghép `${API_BASE_URL}${path}` ra đúng URL, không bị `//`.
 */

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001/';

export const MQTT_URL =
  process.env.EXPO_PUBLIC_MQTT_URL || 'ws://localhost:9001';

export const API_ENDPOINTS = {
  REGISTER_DEVICE: 'api/v1/devices/register',
  INGEST: 'api/v1/ingest',
} as const;

export const REQUEST_TIMEOUT_MS = 15_000;

export const SOCKET_CONFIG = {
  url: API_BASE_URL,
  options: {
    // websocket-first nhưng vẫn cho phép polling fallback. Nhiều môi trường
    // (Windows Firewall, WSL2 portproxy, corporate proxy) chặn WS upgrade
    // nhưng vẫn cho HTTP long-polling đi qua — không có polling thì socket
    // im lặng fail và toàn bộ command-from-server timeout.
    transports: ['websocket', 'polling'] as const,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 3_000,
    reconnectionDelayMax: 10_000,
  },
} as const;

export const MQTT_CONFIG = {
  url: MQTT_URL,
  options: {
    reconnectPeriod: 5_000,
    connectTimeout: 10_000,
    clean: true,
  },
} as const;

/**
 * Default tracking cycle (30 s per SPEC §1.4). The actual interval is a
 * global setting — mobile fetches it at start and updates dynamically on
 * the `tracking_interval_changed` socket broadcast (chức năng 2).
 */
export const DEFAULT_TRACKING_INTERVAL_MS = 30_000;
