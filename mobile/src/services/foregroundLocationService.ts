import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
import { Accelerometer } from 'expo-sensors';
import * as TaskManager from 'expo-task-manager';
import { Vibration } from 'react-native';
import { API_BASE_URL, API_ENDPOINTS } from '../config/api';
import type { LocationData, LocationQuality } from '../models/types';
import { getCellTowerInfo } from './cellInfoService';
import { publishHeartbeat, publishTelemetry } from './mqttService';

export const FOREGROUND_LOCATION_TASK = 'foreground-location-task';
const STORAGE_KEY_DEVICE = '@deviceTracking/device';
const STORAGE_KEY_BUFFER = '@deviceTracking/fgBuffer';
const STORAGE_KEY_LAST_SENT = '@deviceTracking/fgLastSent'; // {lat, lon, t}

const ACCURACY_GPS_GRADE_M = 20;
const ACCURACY_APPROX_M = 80;
const MAX_ACCEPTABLE_ACCURACY_M = 200;
const FLUSH_BATCH_LIMIT = 50;

// H1 — Decouple sampling vs sending:
// - Service wake mỗi `timeInterval = intervalMs` (admin chọn 5/30/60s).
// - /ingest gửi khi di chuyển ≥ MOVEMENT_THRESHOLD_M (skip nếu đứng yên).
// - /heartbeat chỉ gửi mỗi HEARTBEAT_MIN_INTERVAL_MS để giữ last_seen
//   refresh nhưng không spam khi user đứng yên + tick nhanh.
const MOVEMENT_THRESHOLD_M = 5;
const HEARTBEAT_MIN_INTERVAL_MS = 30_000;

// H2 — Cell info cache: Telephony scan ~50-200ms mỗi lần, ở interval 5s
// gọi 12 lần/phút rất tốn. Cells thay đổi rất chậm (handover ~vài phút) →
// cache 15s vẫn fresh đủ cho mọi tick.
const CELL_CACHE_TTL_MS = 15_000;

// H4 — Motion detection bằng accelerometer (1Hz):
// - Sample magnitude = sqrt(x² + y² + z²). Đứng yên: ~9.8 (gravity), variance < 0.05.
// - Walking/lái xe: oscillates 8-12, variance > 0.3.
// - Buffer 30 mẫu cuối (30s). Threshold variance đủ tách 2 trạng thái rõ.
// - Khi STILL: tăng heartbeat throttle lên 60s + tăng movement threshold lên
//   10m (lọc GPS jitter). Khi MOVING: dùng default 30s + 5m.
const ACCEL_BUFFER_SIZE = 30;
const ACCEL_SAMPLE_INTERVAL_MS = 1000;
const STILL_VARIANCE_THRESHOLD = 0.15;
const HEARTBEAT_STILL_MS = 60_000;
const MOVEMENT_STILL_THRESHOLD_M = 10;

// Buffer tồn tại trong AsyncStorage qua mọi lần restart. Drop fix quá cũ
// trước khi flush — fix offline > 30 phút không còn ý nghĩa realtime, đẩy
// về server chỉ làm rác history (vd sau khi admin reset data + user mở app
// lại từ session cũ).
const BUFFER_MAX_AGE_MS = 30 * 60 * 1000;

function classifyQuality(accuracy: number | null | undefined): LocationQuality {
  if (accuracy == null) return 'network';
  if (accuracy <= ACCURACY_GPS_GRADE_M) return 'gps';
  if (accuracy <= ACCURACY_APPROX_M) return 'approx';
  return 'network';
}

function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// In-memory cell cache cho TaskManager task. Module-level state OK vì task
// run trong cùng JS context (Hermes). Reset khi process killed (acceptable —
// lần fire kế tiếp re-sample fresh).
let cellCache: {
  towers: Awaited<ReturnType<typeof getCellTowerInfo>>;
  ts: number;
} | null = null;

// Accelerometer subscription + ring buffer cho motion detection. Subscribe
// khi service start (foreground service giữ JS engine alive → events vẫn
// fire khi app minimized). Unsubscribe khi service stop để khỏi tốn pin.
let accelSubscription: { remove: () => void } | null = null;
const accelBuffer: number[] = [];

function subscribeAccelerometer(): void {
  if (accelSubscription) return;
  Accelerometer.setUpdateInterval(ACCEL_SAMPLE_INTERVAL_MS);
  accelSubscription = Accelerometer.addListener(({ x, y, z }) => {
    const magnitude = Math.sqrt(x * x + y * y + z * z);
    accelBuffer.push(magnitude);
    if (accelBuffer.length > ACCEL_BUFFER_SIZE) accelBuffer.shift();
  });
}

function unsubscribeAccelerometer(): void {
  if (accelSubscription) {
    accelSubscription.remove();
    accelSubscription = null;
  }
  accelBuffer.length = 0;
}

/**
 * Trả true nếu thiết bị đang đứng yên (variance accelerometer thấp).
 * Cần tối thiểu 10 mẫu (~10s) để quyết định đáng tin — chưa đủ thì coi
 * như MOVING (cẩn trọng, không skip ingest).
 */
function isStill(): boolean {
  if (accelBuffer.length < 10) return false;
  const n = accelBuffer.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += accelBuffer[i];
  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) {
    const diff = accelBuffer[i] - mean;
    varSum += diff * diff;
  }
  const variance = varSum / n;
  return variance < STILL_VARIANCE_THRESHOLD;
}

async function getCachedCells(): Promise<
  Awaited<ReturnType<typeof getCellTowerInfo>>
> {
  if (cellCache && Date.now() - cellCache.ts < CELL_CACHE_TTL_MS) {
    return cellCache.towers;
  }
  try {
    const towers = await getCellTowerInfo();
    cellCache = { towers, ts: Date.now() };
    return towers;
  } catch {
    return [];
  }
}

interface LastSent {
  lat: number;
  lon: number;
  t: number; // epoch ms
}

async function getLastSent(): Promise<LastSent | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY_LAST_SENT);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LastSent;
  } catch {
    return null;
  }
}

async function setLastSent(lat: number, lon: number): Promise<void> {
  const payload: LastSent = { lat, lon, t: Date.now() };
  await AsyncStorage.setItem(STORAGE_KEY_LAST_SENT, JSON.stringify(payload));
}

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

async function appendBuffer(fixes: LocationData[]): Promise<void> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY_BUFFER);
  const existing: LocationData[] = raw ? (JSON.parse(raw) as LocationData[]) : [];
  // Cap 500 điểm — nếu offline lâu thì giữ những điểm gần nhất.
  const capped = existing.concat(fixes).slice(-500);
  await AsyncStorage.setItem(STORAGE_KEY_BUFFER, JSON.stringify(capped));
}

async function clearBuffer(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY_BUFFER);
}

async function readBatteryLevel(): Promise<number | undefined> {
  try {
    const lvl = await Battery.getBatteryLevelAsync();
    return Math.round(lvl * 100);
  } catch {
    return undefined;
  }
}

/**
 * Flush buffer LEN /ingest nếu di chuyển ≥ MOVEMENT_THRESHOLD_M từ lần gửi
 * trước, hoặc force=true (vd lệnh request_location_now). Đứng yên → return
 * false, caller sẽ fall back về heartbeat.
 */
async function flushBufferIfMoved(
  deviceId: string,
  force: boolean,
): Promise<boolean> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY_BUFFER);
  if (!raw) return false;
  let buffer: LocationData[] = JSON.parse(raw);
  // Drop fix quá cũ — tránh push rác lên server khi user mở app lại từ
  // session cũ hoặc sau khi admin reset data.
  const cutoff = Date.now() - BUFFER_MAX_AGE_MS;
  const filtered = buffer.filter((f) => f.timestamp >= cutoff);
  if (filtered.length !== buffer.length) {
    if (filtered.length === 0) {
      await clearBuffer();
    } else {
      await AsyncStorage.setItem(STORAGE_KEY_BUFFER, JSON.stringify(filtered));
    }
    buffer = filtered;
  }
  if (buffer.length === 0) return false;

  const latest = buffer[buffer.length - 1];
  if (!force) {
    const last = await getLastSent();
    // Khi đang đứng yên (accelerometer variance thấp), tăng movement threshold
    // để lọc thêm GPS jitter — fix lệch 5-10m do noise sẽ bị skip thay vì
    // gửi như "movement". Khi MOVING, dùng threshold default 5m.
    const threshold = isStill()
      ? MOVEMENT_STILL_THRESHOLD_M
      : MOVEMENT_THRESHOLD_M;
    if (
      last &&
      haversineMeters(latest.latitude, latest.longitude, last.lat, last.lon) <
        threshold
    ) {
      // Chưa di chuyển đủ — KHÔNG flush, giữ buffer để lần sau gửi gộp.
      // Lưu ý: buffer có thể phình to nếu user đứng yên rất lâu, nhưng cap
      // 500 ở appendBuffer đã handle (drop điểm cũ).
      return false;
    }
  }

  const toSend = buffer.slice(0, FLUSH_BATCH_LIMIT);
  const remaining = buffer.slice(toSend.length);
  const batteryLevel = await readBatteryLevel();
  const cellTowers = await getCachedCells();
  const payload = {
    locations: toSend,
    cellTowers,
    batteryLevel,
  };

  // MQTT-first (kết nối persistent, không phải TLS handshake mỗi tick).
  // Client là module-level singleton, sống trong cùng JS context với task
  // headless này — connectMqtt được gọi ở startTracking activity-side, vẫn
  // alive vì foreground service giữ JS engine. Fail → fallback HTTP.
  const sentOverMqtt = await publishTelemetry(deviceId, payload);
  if (sentOverMqtt) {
    if (remaining.length === 0) {
      await clearBuffer();
    } else {
      await AsyncStorage.setItem(STORAGE_KEY_BUFFER, JSON.stringify(remaining));
    }
    await setLastSent(latest.latitude, latest.longitude);
    return true;
  }

  try {
    const res = await fetch(`${API_BASE_URL}${API_ENDPOINTS.INGEST}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-id': deviceId,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      if (res.status === 404) await clearBuffer();
      return false;
    }
    if (remaining.length === 0) {
      await clearBuffer();
    } else {
      await AsyncStorage.setItem(STORAGE_KEY_BUFFER, JSON.stringify(remaining));
    }
    await setLastSent(latest.latitude, latest.longitude);
    return true;
  } catch {
    // Network fail — giữ nguyên buffer, lần fire kế tiếp retry.
    return false;
  }
}

/**
 * Heartbeat throttled — chỉ gửi nếu lần send trước (ingest hoặc heartbeat)
 * cách đây >= HEARTBEAT_MIN_INTERVAL_MS. Tránh spam server khi admin set
 * tick 5s + user đứng yên.
 */
async function sendHeartbeat(deviceId: string, force: boolean): Promise<void> {
  if (!force) {
    const last = await getLastSent();
    // Khi STILL kéo dài throttle lên 60s — user không cử động nên không
    // cần spam server. MOVING giữ default 30s để cha mẹ thấy cập nhật đều.
    const throttle = isStill()
      ? HEARTBEAT_STILL_MS
      : HEARTBEAT_MIN_INTERVAL_MS;
    if (last && Date.now() - last.t < throttle) return;
  }

  const batteryLevel = await readBatteryLevel();
  const cellTowers = await getCachedCells();
  const payload = {
    batteryLevel,
    cellTowers: cellTowers.length > 0 ? cellTowers : undefined,
  };

  // MQTT-first, fallback HTTP (giống flushBufferIfMoved).
  const bumpLastSentT = async () => {
    // Heartbeat KHÔNG cập nhật lastSent position (vẫn ở vị trí cũ), chỉ bump
    // timestamp để rate-limit heartbeat kế tiếp.
    const last = await getLastSent();
    const lat = last?.lat ?? 0;
    const lon = last?.lon ?? 0;
    await setLastSent(lat, lon);
  };

  const sentOverMqtt = await publishHeartbeat(deviceId, payload);
  if (sentOverMqtt) {
    await bumpLastSentT();
    return;
  }

  try {
    const res = await fetch(`${API_BASE_URL}${API_ENDPOINTS.HEARTBEAT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-id': deviceId,
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) await bumpLastSentT();
  } catch {
    // Network fail — lần fire tiếp theo sẽ thử lại.
  }
}

interface TaskData {
  locations?: Location.LocationObject[];
}

// ──────────────────────────────────────────────────────────────────────────
// Command polling (cho khi app minimized / khoá màn hình)
//
// Khi activity foreground, socket.io nhận command realtime qua App.tsx /
// TrackingScreen. Khi app background, JS engine bị OS pause → socket
// disconnect → command im lặng cho tới khi user mở lại. Để workaround,
// mỗi lần OS đánh thức task ta gọi POST /commands/poll qua HTTP để rút
// các command pending, execute chúng headless, rồi POST kết quả về.
// ──────────────────────────────────────────────────────────────────────────

interface PendingCommand {
  commandId: string;
  command: string;
  payload: Record<string, unknown>;
}

interface CommandExecutionResult {
  success: boolean;
  error?: string;
  needFlush?: boolean;
}

async function executeCommandHeadless(
  cmd: PendingCommand,
): Promise<CommandExecutionResult> {
  try {
    switch (cmd.command) {
      case 'request_location_now':
        // Fix mới nhất đã append vào buffer trong cùng task fire. Force-flush
        // để gửi ngay, không chờ throttle 30s.
        return { success: true, needFlush: true };

      case 'ring_alarm': {
        const duration = Math.max(
          1,
          Math.min(60, Number(cmd.payload?.durationSec) || 10),
        );
        Vibration.vibrate([0, 500, 200], true);
        await new Promise((r) => setTimeout(r, duration * 1000));
        Vibration.cancel();
        return { success: true };
      }

      case 'lock_device':
        // Lock state đã được server persist + emit device_lock_changed.
        // Khi user mở app, LockOverlay hiện qua socket listener. Headless
        // không render được overlay, chỉ ack.
        return { success: true };

      case 'toggle_tracking': {
        const enabled = !!cmd.payload?.enabled;
        if (!enabled) {
          await stopForegroundLocation();
          return { success: true };
        }
        return {
          success: false,
          error:
            'Không thể bật tracking từ background. Cần mở app trên thiết bị.',
        };
      }

      default:
        return { success: false, error: `Unknown command: ${cmd.command}` };
    }
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function postCommandResult(
  deviceId: string,
  commandId: string,
  success: boolean,
  error?: string,
): Promise<void> {
  try {
    await fetch(
      `${API_BASE_URL}${API_ENDPOINTS.COMMANDS_RESULT_PREFIX}${commandId}/result`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-device-id': deviceId,
        },
        body: JSON.stringify({ success, error: error ?? undefined }),
      },
    );
  } catch {
    // Network fail OK — backend đã mark command delivered ở poll. Sẽ
    // timeout sau COMMAND_TIMEOUT_MS nếu không có result.
  }
}

/** Trả true nếu có command yêu cầu force flush buffer (vd request_location_now). */
async function pollAndExecuteCommands(deviceId: string): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${API_ENDPOINTS.COMMANDS_POLL}`, {
      method: 'POST',
      headers: { 'x-device-id': deviceId },
    });
  } catch {
    return false;
  }
  if (!res.ok) return false;

  let body: { commands?: PendingCommand[] };
  try {
    body = (await res.json()) as { commands?: PendingCommand[] };
  } catch {
    return false;
  }

  const commands = body.commands ?? [];
  if (commands.length === 0) return false;

  let needFlush = false;
  for (const cmd of commands) {
    const result = await executeCommandHeadless(cmd);
    if (result.needFlush) needFlush = true;
    await postCommandResult(deviceId, cmd.commandId, result.success, result.error);
  }
  return needFlush;
}

/**
 * Đăng ký TaskManager task ở module level — bắt buộc vì khi OS pause activity
 * nhưng foreground service vẫn chạy, RN có thể load module này headless mà
 * không qua React tree. Hàm phải tồn tại trước `startLocationUpdatesAsync`.
 */
TaskManager.defineTask(FOREGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[fg-location] task error:', error);
    return;
  }
  const deviceId = await loadStoredDeviceId();
  if (!deviceId) return;

  const payload = data as TaskData | undefined;
  const fixes: LocationData[] = [];
  for (const loc of payload?.locations ?? []) {
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

  if (fixes.length > 0) {
    await appendBuffer(fixes);
  }

  // Poll command trước khi flush/heartbeat — request_location_now sẽ
  // needFlush=true để force gửi ngay, bỏ qua throttle movement/heartbeat.
  const force = await pollAndExecuteCommands(deviceId);

  // Thử flush ingest (nếu di chuyển hoặc force). Nếu không gửi → heartbeat
  // (cũng throttled riêng để không spam ở tick 5s).
  const sent = await flushBufferIfMoved(deviceId, force);
  if (!sent) {
    await sendHeartbeat(deviceId, force);
  }
});

const DEFAULT_INTERVAL_MS = 30_000;

/**
 * Bật foreground service tracking. `intervalMs` = admin-set tick rate (5/30/60s)
 * — driver cho `timeInterval` của OS task. Throttle ingest/heartbeat ở task
 * level gating riêng (movement-based, time-based). Cần permission
 * `ACCESS_FINE_LOCATION` đã grant. KHÔNG cần `ACCESS_BACKGROUND_LOCATION`
 * vì khởi tạo từ activity foreground + có foregroundService config (Android 12+).
 */
export async function startForegroundLocation(
  intervalMs: number = DEFAULT_INTERVAL_MS,
): Promise<{ ok: boolean; reason?: string }> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== 'granted') {
    return { ok: false, reason: 'Chưa cấp quyền vị trí' };
  }

  const already = await Location.hasStartedLocationUpdatesAsync(
    FOREGROUND_LOCATION_TASK,
  );
  if (already) return { ok: true };

  // Bật accelerometer subscription để task có dữ liệu motion detection.
  // Sub ở module level — TaskManager headless task đọc accelBuffer cùng JS context.
  subscribeAccelerometer();

  const safeInterval = Math.max(1000, intervalMs);
  await Location.startLocationUpdatesAsync(FOREGROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    // distanceInterval=0: OS wake task đều theo timeInterval bất kể di chuyển
    // hay không → cha mẹ luôn thấy "device còn sống" qua last_seen.
    distanceInterval: 0,
    timeInterval: safeInterval,
    deferredUpdatesInterval: safeInterval,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: '📍 Đang giám sát vị trí',
      notificationBody: 'Ứng dụng đang gửi vị trí về tài khoản phụ huynh.',
      notificationColor: '#1976D2',
      killServiceOnDestroy: false,
    },
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.OtherNavigation,
  });
  return { ok: true };
}

/**
 * Đổi tần suất tick — stop service rồi start lại với intervalMs mới. Chỉ
 * hoạt động khi activity đang foreground (yêu cầu của OS để start FG
 * service); nếu app minimized lúc admin đổi interval → giá trị cũ giữ
 * nguyên đến khi user mở app.
 */
export async function restartForegroundLocation(
  intervalMs: number,
): Promise<{ ok: boolean; reason?: string }> {
  const running = await Location.hasStartedLocationUpdatesAsync(
    FOREGROUND_LOCATION_TASK,
  );
  if (running) {
    await Location.stopLocationUpdatesAsync(FOREGROUND_LOCATION_TASK);
  }
  return startForegroundLocation(intervalMs);
}

export async function stopForegroundLocation(): Promise<void> {
  const running = await Location.hasStartedLocationUpdatesAsync(
    FOREGROUND_LOCATION_TASK,
  );
  if (running) {
    await Location.stopLocationUpdatesAsync(FOREGROUND_LOCATION_TASK);
  }
  await clearBuffer();
  await AsyncStorage.removeItem(STORAGE_KEY_LAST_SENT);
  cellCache = null;
  unsubscribeAccelerometer();
}

export async function isForegroundLocationActive(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(
      FOREGROUND_LOCATION_TASK,
    );
  } catch {
    return false;
  }
}
