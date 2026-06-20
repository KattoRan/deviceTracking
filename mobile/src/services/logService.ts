import AsyncStorage from '@react-native-async-storage/async-storage';
import NativeIngest from 'native-ingest';
import { API_BASE_URL } from '../config/api';

/**
 * Best-effort error/event reporting về backend. Mobile log lên server qua
 * NativeIngest (HttpURLConnection native thread — không phụ thuộc RN bridge
 * có hoạt động hay không, an toàn cả ở headless task).
 *
 * Triết lý: log fail KHÔNG bao giờ throw — log là phụ trợ, không break flow
 * chính của caller.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const STORAGE_KEY_DEVICE = '@deviceTracking/device';

async function loadDeviceId(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_DEVICE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { deviceId?: string };
    return parsed.deviceId ?? null;
  } catch {
    return null;
  }
}

async function send(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    const deviceId = await loadDeviceId();
    if (!deviceId) return; // chưa pair, không có endpoint để gửi
    if (!NativeIngest) return;

    const body = JSON.stringify({ level, message, context });
    await NativeIngest.postJson(
      `${API_BASE_URL}api/v1/devices/${deviceId}/log`,
      { 'Content-Type': 'application/json' },
      body,
      5_000,
    );
  } catch {
    // never throw — log là phụ trợ
  }
}

export const logRemote = {
  debug: (msg: string, ctx?: Record<string, unknown>) =>
    void send('debug', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) =>
    void send('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) =>
    void send('warn', msg, ctx),
  error: (msg: string, err?: unknown, ctx?: Record<string, unknown>) => {
    const errCtx =
      err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : err != null
          ? { value: String(err) }
          : {};
    void send('error', msg, { ...errCtx, ...ctx });
  },
};
