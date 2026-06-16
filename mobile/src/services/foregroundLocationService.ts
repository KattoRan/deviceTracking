import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
import { Accelerometer } from 'expo-sensors';
import * as TaskManager from 'expo-task-manager';
import { AppState, Vibration } from 'react-native';
import { API_BASE_URL, API_ENDPOINTS } from '../config/api';
import type { LocationData, LocationQuality } from '../models/types';
import { getCellTowerInfo } from './cellInfoService';
import { connectMqtt, isMqttConnected, publishTelemetry } from './mqttService';

export const FOREGROUND_LOCATION_TASK = 'foreground-location-task';

// Module-level flag — cập nhật qua AppState listener. Dùng để skip HTTP
// requests đến localhost khi app ở background (OkHttp bị Android throttle,
// setTimeout trong Promise.race cũng bị defer ~51s → task bị block).
let isAppForeground = AppState.currentState === 'active';
AppState.addEventListener('change', (state) => {
  isAppForeground = state === 'active';
});

const STORAGE_KEY_DEVICE = '@deviceTracking/device';
const STORAGE_KEY_BUFFER = '@deviceTracking/fgBuffer';
const STORAGE_KEY_LAST_SENT = '@deviceTracking/fgLastSent'; // {lat, lon, t}

const ACCURACY_GPS_GRADE_M = 20;
const ACCURACY_APPROX_M = 80;
const MAX_ACCEPTABLE_ACCURACY_M = 200;
const FLUSH_BATCH_LIMIT = 50;

// H1 — Decouple sampling vs sending:
// - OS wake task theo distanceInterval (25m) HOẶC timeInterval (30s).
// - /ingest gửi khi di chuyển đủ (movement gate accuracy-adjusted).
// - /heartbeat chỉ gửi mỗi HEARTBEAT_MIN_INTERVAL_MS (30s MOVING, 60s STILL)
//   để giữ last_seen refresh nhưng không spam khi đứng yên.
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
//   10m. Khi MOVING: dùng default 30s + 5m.
// - Movement gate dùng accuracy-adjusted distance: rawDistance - max(acc_new, acc_old)
//   > threshold. Tránh GPS jitter (±20m) trigger ingest giả khi thiết bị đứng yên.
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

// Epoch ms của fix GPS mới nhất từ OS — cập nhật mỗi tick task có fix hợp lệ,
// kể cả khi fix bị movement gate skip không gửi server. FE dùng làm dấu mốc
// "GPS thực sự hoạt động" → không bị false GPS-lost badge khi user đứng yên.
let lastFixTime: number | null = null;

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
  // Buffer rỗng = headless mode sau process kill (accelerometer chưa subscribe).
  // Không có data → không biết trạng thái → assume still (conservative).
  if (accelBuffer.length < 10) return true;
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
  acc?: number; // GPS accuracy (m) của fix đã gửi — dùng cho movement gate
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

async function setLastSent(lat: number, lon: number, acc?: number): Promise<void> {
  const payload: LastSent = { lat, lon, t: Date.now(), acc };
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
  // Dedup theo timestamp — Android 14 (đặc biệt khi battery save) đôi khi
  // ignore `timeInterval` và deliver same fix nhiều lần với cùng `loc.timestamp`.
  // Không dedup sẽ làm buffer phình lên 50 entries identical → server insert
  // 50 row hệt nhau mỗi flush.
  const merged: LocationData[] = [...existing];
  for (const f of fixes) {
    const last = merged[merged.length - 1];
    if (last && last.timestamp === f.timestamp) continue;
    merged.push(f);
  }
  // Cap 500 điểm — nếu offline lâu thì giữ những điểm gần nhất.
  const capped = merged.slice(-500);
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
 * Build buffer ready để gửi — drop fix quá cũ, áp movement gate. Trả về
 * `{ toSend, remaining }` nếu nên gửi /ingest có locations; `null` nếu nên
 * gửi heartbeat-only (đứng yên / chưa di chuyển đủ / buffer rỗng).
 */
async function prepareIngest(
  force: boolean,
): Promise<{ toSend: LocationData[]; remaining: LocationData[] } | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY_BUFFER);
  if (!raw) return null;
  let buffer: LocationData[] = JSON.parse(raw);
  // Drop fix quá cũ — tránh push rác lên server khi user mở app lại từ
  // session cũ hoặc sau khi admin reset data.
  const cutoff = Date.now() - BUFFER_MAX_AGE_MS;
  const filtered = buffer.filter((f) => f.timestamp >= cutoff);
  if (filtered.length !== buffer.length) {
    if (filtered.length === 0) await clearBuffer();
    else await AsyncStorage.setItem(STORAGE_KEY_BUFFER, JSON.stringify(filtered));
    buffer = filtered;
  }
  if (buffer.length === 0) return null;

  const latest = buffer[buffer.length - 1];
  if (!force) {
    const last = await getLastSent();
    const threshold = isStill() ? MOVEMENT_STILL_THRESHOLD_M : MOVEMENT_THRESHOLD_M;
    if (last) {
      const rawDistance = haversineMeters(
        latest.latitude,
        latest.longitude,
        last.lat,
        last.lon,
      );
      // Trừ sai số GPS của 2 điểm trước khi so threshold. Dùng max (không sum)
      // để tránh threshold thổi phồng quá lớn — sum cho GPS-grade (20m + 20m)
      // yêu cầu di chuyển 45m mới gửi, quá chặt cho tracking thực tế.
      // Cap ở ACCURACY_GPS_GRADE_M: fix approx/network (>20m) không được inflate
      // threshold vượt quá mức cần thiết.
      const accLatest = Math.min(
        latest.accuracy ?? ACCURACY_GPS_GRADE_M,
        ACCURACY_GPS_GRADE_M,
      );
      const accLast = Math.min(
        last.acc ?? ACCURACY_GPS_GRADE_M,
        ACCURACY_GPS_GRADE_M,
      );
      const effectiveDistance = rawDistance - Math.max(accLatest, accLast);
      if (effectiveDistance < threshold) return null;
    }
  }
  return {
    toSend: buffer.slice(0, FLUSH_BATCH_LIMIT),
    remaining: buffer.slice(FLUSH_BATCH_LIMIT),
  };
}

/**
 * Send telemetry — unified path cho cả ingest (có locations) và heartbeat
 * (không locations). MQTT-first, HTTP fallback. `lastFixAt` luôn gửi nếu có
 * → FE biết "GPS có hoạt động" chính xác kể cả khi mobile gate ingest.
 *
 * Heartbeat throttle: chỉ gửi heartbeat-only nếu lần send trước cách đây
 * >= 30s (MOVING) hoặc >= 60s (STILL). Ingest (có locations) luôn gửi.
 */
async function sendTelemetry(deviceId: string, force: boolean): Promise<void> {
  const ingest = await prepareIngest(force);
  const hasLocations = ingest !== null;
  console.log(`[fg-location] sendTelemetry entered hasLoc=${hasLocations} force=${force}`);

  // Heartbeat-only path bị throttle để không spam khi tick admin = 5s.
  if (!hasLocations && !force) {
    const last = await getLastSent();
    const throttle = isStill() ? HEARTBEAT_STILL_MS : HEARTBEAT_MIN_INTERVAL_MS;
    const elapsed = last ? Date.now() - last.t : -1;
    console.log(`[fg-location] heartbeat check elapsed=${elapsed}ms throttle=${throttle}ms`);
    if (last && elapsed < throttle) return;
  }

  const batteryLevel = await readBatteryLevel();
  const cellTowers = await getCachedCells();
  const payload: {
    locations?: LocationData[];
    cellTowers?: typeof cellTowers;
    batteryLevel?: number;
    lastFixAt?: number;
  } = {
    cellTowers: cellTowers.length > 0 ? cellTowers : undefined,
    batteryLevel,
  };
  if (hasLocations) payload.locations = ingest!.toSend;
  if (lastFixTime != null) payload.lastFixAt = lastFixTime;

  if (!isMqttConnected()) {
    try { connectMqtt(deviceId); } catch { /* ignore */ }
  }

  let success: boolean;

  if (isAppForeground) {
    console.log(`[fg-location] sending via ${isMqttConnected() ? 'MQTT' : 'HTTP'} hasLoc=${hasLocations} force=${force}`);
    success = await publishTelemetry(deviceId, payload, 1);
    if (!success) {
      // HTTP fallback — chỉ trong foreground để tránh localhost fetch treo.
      try {
        const res = await fetchWithTimeout(
          `${API_BASE_URL}${API_ENDPOINTS.INGEST}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-device-id': deviceId,
            },
            body: JSON.stringify(payload),
          },
          10_000,
        );
        if (res.ok) {
          success = true;
          console.log('[fg-location] HTTP fallback OK', res.status);
        } else {
          console.warn('[fg-location] HTTP fallback failed', res.status);
          if (res.status === 404 && hasLocations) await clearBuffer();
        }
      } catch (err) {
        console.warn('[fg-location] HTTP fallback error:', err instanceof Error ? err.message : String(err));
      }
    } else {
      console.log('[fg-location] MQTT publish OK');
    }
  } else {
    // Background: fire-and-forget MQTT (QoS 0). Không await — client.publish()
    // callback chỉ fire sau khi socket write hoàn tất, Android Doze throttle
    // socket write → callback treo indefinitely → task bị block.
    // Với heartbeat-only (hasLoc=false), đánh dấu success để cập nhật lastSent
    // throttle. Với ingest (hasLoc=true), giữ buffer để foreground flush sau.
    if (isMqttConnected()) {
      publishTelemetry(deviceId, payload, 0).catch(() => {});
    }
    success = !hasLocations;
    console.log(`[fg-location] background ${hasLocations ? 'ingest deferred (wait foreground)' : 'heartbeat fire-and-forget'}`);
  }

  if (!success) return;

  if (hasLocations) {
    const latest = ingest!.toSend[ingest!.toSend.length - 1];
    if (ingest!.remaining.length === 0) {
      await clearBuffer();
    } else {
      await AsyncStorage.setItem(
        STORAGE_KEY_BUFFER,
        JSON.stringify(ingest!.remaining),
      );
    }
    await setLastSent(latest.latitude, latest.longitude, latest.accuracy);
  } else {
    // Heartbeat-only: bump lastSent.t để rate-limit heartbeat kế tiếp.
    // KHÔNG đổi lastSent.lat/lon/acc (vị trí thật vẫn ở fix gần nhất).
    const last = await getLastSent();
    await setLastSent(last?.lat ?? 0, last?.lon ?? 0, last?.acc);
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
// AbortController.abort() không cancel được OkHttp trên Android background →
// dùng Promise.race với timer. Fetch hung sẽ tiếp tục chạy ngầm nhưng task
// không bị block.
function fetchWithTimeout(
  url: string,
  options: RequestInit,
  ms: number,
): Promise<Response> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('fetch timeout')), ms),
  );
  return Promise.race([fetch(url, options), timeout]);
}

async function pollAndExecuteCommands(deviceId: string): Promise<boolean> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${API_BASE_URL}${API_ENDPOINTS.COMMANDS_POLL}`,
      { method: 'POST', headers: { 'x-device-id': deviceId } },
      5_000,
    );
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
  console.log('[fg-location] ── task fired ──', new Date().toISOString());
  if (error) {
    console.warn('[fg-location] task error:', error);
    return;
  }
  const deviceId = await loadStoredDeviceId();
  if (!deviceId) {
    console.warn('[fg-location] no deviceId in storage, skip');
    return;
  }

  const payload = data as TaskData | undefined;
  const allLocs = payload?.locations ?? [];
  console.log(`[fg-location] locations in payload: ${allLocs.length}, still=${isStill()}`);

  for (const loc of allLocs) {
    const acc = loc.coords.accuracy ?? null;
    if (acc != null && acc > MAX_ACCEPTABLE_ACCURACY_M) continue;
    const ts = loc.timestamp ?? Date.now();
    if (lastFixTime == null || ts > lastFixTime) lastFixTime = ts;
  }

  const latestLoc = allLocs[allLocs.length - 1];
  if (latestLoc) {
    const acc = latestLoc.coords.accuracy ?? null;
    if (acc == null || acc <= MAX_ACCEPTABLE_ACCURACY_M) {
      await appendBuffer([{
        latitude: latestLoc.coords.latitude,
        longitude: latestLoc.coords.longitude,
        accuracy: acc ?? undefined,
        quality: classifyQuality(acc),
        timestamp: latestLoc.timestamp ?? Date.now(),
      }]);
      console.log(`[fg-location] buffered fix lat=${latestLoc.coords.latitude.toFixed(5)} acc=${acc?.toFixed(0)}m`);
    } else {
      console.log(`[fg-location] fix dropped (accuracy ${acc?.toFixed(0)}m > ${MAX_ACCEPTABLE_ACCURACY_M}m)`);
    }
  }

  // Chỉ poll commands khi app đang foreground. Khi background, HTTP fetch
  // đến localhost bị Android block/throttle, setTimeout cũng defer ~51s →
  // task bị block suốt interval. Commands không quan trọng realtime khi
  // background — chờ lần mở app tiếp theo.
  console.log('[fg-location] calling pollAndExecuteCommands');
  const force = isAppForeground
    ? await pollAndExecuteCommands(deviceId)
    : false;
  console.log(`[fg-location] poll done force=${force}, calling sendTelemetry`);
  await sendTelemetry(deviceId, force);
  console.log('[fg-location] sendTelemetry done');
});

/**
 * Bật foreground service tracking.
 * - distanceInterval=0: bắt buộc để OS fire theo timeInterval kể cả khi đứng yên.
 * - timeInterval=30s: heartbeat + flush đều đặn. Filter 25m áp ở movement gate.
 * Foreground service với foregroundServiceType=location chỉ cần ACCESS_FINE_LOCATION —
 * expo-location bỏ qua check background permission khi dùng foreground service.
 */
export async function startForegroundLocation(): Promise<{ ok: boolean; reason?: string }> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== 'granted') {
    return { ok: false, reason: 'Chưa cấp quyền vị trí' };
  }

  // Bật accelerometer subscription để task có dữ liệu motion detection.
  // Sub ở module level — TaskManager headless task đọc accelBuffer cùng JS context.
  try {
    subscribeAccelerometer();
  } catch {
    // Sensor không available trên thiết bị này — movement gate fallback về "moving".
  }

  // Gọi startLocationUpdatesAsync trực tiếp — không check hasStartedLocationUpdatesAsync
  // trước vì native xử lý gracefully:
  //   • Chưa có task → start mới, hiện notification
  //   • Đã có task → gọi setOptions() (re-register FusedLocationProvider), notification giữ nguyên
  // Stop trước rồi start lại tạo gap tracking + notification nhấp nháy mỗi lần mở app.
  try {
    await Location.startLocationUpdatesAsync(FOREGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      // distanceInterval=0: bắt buộc để task fire theo timeInterval kể cả khi
      // đứng yên — iOS distanceFilter và Android smallestDisplacement đều chặn
      // callback nếu >0 và device chưa di chuyển đủ. Heartbeat sẽ bị mất.
      // Coarse filter 25m được áp ở movement gate (app level) thay vì OS level.
      distanceInterval: 0,
      // timeInterval=30s: wake task đều đặn → heartbeat khi still, flush khi moving.
      timeInterval: HEARTBEAT_MIN_INTERVAL_MS,
      deferredUpdatesInterval: HEARTBEAT_MIN_INTERVAL_MS,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: '📍 Đang giám sát vị trí',
        notificationBody: 'Ứng dụng đang gửi vị trí về tài khoản quản lý.',
        notificationColor: '#1976D2',
        killServiceOnDestroy: false,
      },
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.OtherNavigation,
    });
    console.log('[fg-location] startLocationUpdatesAsync OK');
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[fg-location] startLocationUpdatesAsync failed:', msg);
    return { ok: false, reason: msg };
  }
}

/** Restart service — dùng khi cần reset task (vd sau khi app resume). */
export async function restartForegroundLocation(): Promise<{ ok: boolean; reason?: string }> {
  const running = await Location.hasStartedLocationUpdatesAsync(
    FOREGROUND_LOCATION_TASK,
  );
  if (running) {
    await Location.stopLocationUpdatesAsync(FOREGROUND_LOCATION_TASK);
  }
  return startForegroundLocation();
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
  lastFixTime = null;
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
