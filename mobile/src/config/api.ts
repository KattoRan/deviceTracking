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
  PAIR_DEVICE: 'api/v1/devices/pair',
  INGEST: 'api/v1/ingest',
  SOS: 'api/v1/devices/sos',
  COMMANDS_POLL: 'api/v1/devices/commands/poll',
  // Result endpoint nhận :commandId — ghép tại call-site.
  COMMANDS_RESULT_PREFIX: 'api/v1/devices/commands/',
} as const;

export const REQUEST_TIMEOUT_MS = 15_000;

export const SOCKET_CONFIG = {
  url: API_BASE_URL,
  options: {
    // Polling-first rồi upgrade WebSocket. Trên Android dev qua `adb reverse`,
    // WS handshake thường OK nhưng frame sau đó bị adb buffer/reset →
    // `transport error` → reconnect loop. Polling là HTTP ngắn nên ổn định
    // qua adb; nếu upgrade WS được thì client tự chuyển, fail thì giữ polling.
    transports: ['polling', 'websocket'] as const,
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
