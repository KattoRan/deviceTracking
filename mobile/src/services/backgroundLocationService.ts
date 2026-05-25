import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { API_BASE_URL, API_ENDPOINTS } from '../config/api';
import type { LocationData, LocationQuality } from '../models/types';
import { getCellTowerInfo } from './cellInfoService';

export const BACKGROUND_LOCATION_TASK = 'background-location-task';
const STORAGE_KEY_DEVICE = '@deviceTracking/device';
const STORAGE_KEY_BUFFER = '@deviceTracking/bgBuffer';
const STORAGE_KEY_LAST_FLUSH = '@deviceTracking/bgLastFlush';

const ACCURACY_GPS_GRADE_M = 20;
const ACCURACY_APPROX_M = 80;
const MAX_ACCEPTABLE_ACCURACY_M = 200;
const FLUSH_INTERVAL_MS = 30_000;
const FLUSH_BATCH_LIMIT = 50;

function classifyQuality(accuracy: number | null | undefined): LocationQuality {
  if (accuracy == null) return 'network';
  if (accuracy <= ACCURACY_GPS_GRADE_M) return 'gps';
  if (accuracy <= ACCURACY_APPROX_M) return 'approx';
  return 'network';
}

interface BufferedFix extends LocationData {}

async function loadStoredDeviceId(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_DEVICE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { deviceId?: string };
    return parsed.deviceId ?? null;
  } catch {
    return null;
  }
}

async function appendToBuffer(fixes: BufferedFix[]): Promise<BufferedFix[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY_BUFFER);
  const existing: BufferedFix[] = raw ? (JSON.parse(raw) as BufferedFix[]) : [];
  const merged = existing.concat(fixes);
  // Cap buffer — nếu offline lâu thì giữ N điểm gần nhất, drop điểm cũ.
  const capped = merged.slice(-500);
  await AsyncStorage.setItem(STORAGE_KEY_BUFFER, JSON.stringify(capped));
  return capped;
}

async function clearBuffer(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY_BUFFER);
}

async function shouldFlushNow(): Promise<boolean> {
  const last = await AsyncStorage.getItem(STORAGE_KEY_LAST_FLUSH);
  if (!last) return true;
  return Date.now() - Number(last) >= FLUSH_INTERVAL_MS;
}

async function markFlushed(): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY_LAST_FLUSH, String(Date.now()));
}

/**
 * Headless flush — gọi từ trong TaskManager task (không có React tree).
 * Dùng fetch trực tiếp thay vì apiService để không phụ thuộc state/context.
 */
async function flushBufferIfNeeded(deviceId: string): Promise<void> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY_BUFFER);
  if (!raw) return;
  const buffer: BufferedFix[] = JSON.parse(raw);
  if (buffer.length === 0) return;
  if (!(await shouldFlushNow())) return;

  // Lấy slice đầu để flush, giữ phần còn lại nếu vượt limit.
  const toSend = buffer.slice(0, FLUSH_BATCH_LIMIT);
  const remaining = buffer.slice(toSend.length);

  let batteryLevel: number | undefined;
  try {
    const lvl = await Battery.getBatteryLevelAsync();
    batteryLevel = Math.round(lvl * 100);
  } catch {
    // ignore — battery API có thể không có ở simulator
  }

  // Sample BTS info at flush time. The headless task runs without a React
  // tree, but cellInfoService is a plain native bridge — it works the same
  // here as in foreground. Failure to read returns []; we still ship the
  // GPS fixes alone rather than hold them up.
  let cellTowers: Awaited<ReturnType<typeof getCellTowerInfo>> = [];
  try {
    cellTowers = await getCellTowerInfo();
  } catch {
    // keep empty array — server tolerates missing cell info
  }

  try {
    const res = await fetch(`${API_BASE_URL}${API_ENDPOINTS.INGEST}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-id': deviceId,
      },
      body: JSON.stringify({
        locations: toSend,
        cellTowers,
        batteryLevel,
      }),
    });
    if (!res.ok) {
      // Server từ chối — giữ buffer để retry. Có thể là device bị delete:
      // 404 → xoá buffer để khỏi spam.
      if (res.status === 404) {
        await clearBuffer();
      }
      return;
    }
    // Thành công — giữ phần remaining (nếu có), xoá phần đã gửi.
    if (remaining.length === 0) {
      await clearBuffer();
    } else {
      await AsyncStorage.setItem(STORAGE_KEY_BUFFER, JSON.stringify(remaining));
    }
    await markFlushed();
  } catch {
    // Network fail — giữ nguyên buffer, lần update tiếp theo sẽ thử lại.
  }
}

interface TaskData {
  locations?: Location.LocationObject[];
}

/**
 * Đăng ký TaskManager task ở module level — bắt buộc với background mode,
 * vì khi OS đánh thức app trong nền, RN sẽ load module này nhưng KHÔNG
 * render React tree. Hàm này phải tồn tại trước khi
 * `Location.startLocationUpdatesAsync` được gọi.
 */
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[bg-location] task error:', error);
    return;
  }
  const payload = data as TaskData | undefined;
  if (!payload?.locations?.length) return;

  const deviceId = await loadStoredDeviceId();
  if (!deviceId) return; // chưa pair → không gửi

  const fixes: BufferedFix[] = [];
  for (const loc of payload.locations) {
    const acc = loc.coords.accuracy ?? null;
    if (acc != null && acc > MAX_ACCEPTABLE_ACCURACY_M) continue;
    fixes.push({
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      accuracy: acc ?? undefined,
      quality: classifyQuality(acc),
      timestamp: loc.timestamp ?? Date.now(),
    });
  }
  if (fixes.length === 0) return;

  await appendToBuffer(fixes);
  await flushBufferIfNeeded(deviceId);
});

export async function startBackgroundLocation(): Promise<{
  ok: boolean;
  reason?: string;
}> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== 'granted') {
    return { ok: false, reason: 'Chưa cấp quyền vị trí (foreground)' };
  }
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted') {
    return {
      ok: false,
      reason:
        'Chưa cấp "Cho phép luôn" cho quyền vị trí. Vào Cài đặt → Ứng dụng → Quyền vị trí → Luôn cho phép.',
    };
  }

  const already = await Location.hasStartedLocationUpdatesAsync(
    BACKGROUND_LOCATION_TASK,
  );
  if (already) return { ok: true };

  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    distanceInterval: 20,
    timeInterval: 30_000,
    deferredUpdatesInterval: 30_000,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: '📍 Đang giám sát vị trí',
      notificationBody:
        'Ứng dụng đang gửi vị trí về tài khoản phụ huynh. Vuốt để tạm dừng.',
      notificationColor: '#1976D2',
      killServiceOnDestroy: false,
    },
    // iOS: pauses automatically when stationary; the heartbeat fallback in
    // TrackingScreen tiếp tục bắn realtime payload trong foreground.
    pausesUpdatesAutomatically: Platform.OS === 'ios',
    activityType: Location.ActivityType.OtherNavigation,
  });
  return { ok: true };
}

export async function stopBackgroundLocation(): Promise<void> {
  const running = await Location.hasStartedLocationUpdatesAsync(
    BACKGROUND_LOCATION_TASK,
  );
  if (running) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }
  await clearBuffer();
}

export async function isBackgroundLocationActive(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(
      BACKGROUND_LOCATION_TASK,
    );
  } catch {
    return false;
  }
}
