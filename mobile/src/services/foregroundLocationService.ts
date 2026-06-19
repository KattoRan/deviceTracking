import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { AppState, Vibration } from 'react-native';
import NativeIngest from 'native-ingest';
import { API_BASE_URL, API_ENDPOINTS } from '../config/api';
import type { LocationData, LocationQuality } from '../models/types';
import {
  type Activity,
  getCurrentActivity,
  getCurrentConfidence,
  onActivityChange,
  startActivityRecognition,
  stopActivityRecognition,
} from './activityService';
import { getCellTowerInfo, getCellTowerInfoFresh } from './cellInfoService';
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

// H1 — Event-driven sampling theo activity:
// - OS fire task khi di chuyển đủ distanceInterval (theo activity hiện tại),
//   HOẶC khi LOCATION_TIME_INTERVAL_MS trôi qua (heartbeat fallback).
// - Activity Recognition (Google ML) classify STILL/WALKING/RUNNING/BICYCLE/VEHICLE,
//   ở mỗi lần đổi state ta reschedule Location updates với distanceInterval phù hợp.
// - Movement gate app-level đã bỏ — OS đảm nhiệm filter distance.
//
// timeInterval=30s: giúp GPS chip stay "warm" khi STILL — không cold-start
// 5-10s khi user bắt đầu di chuyển. Trade-off: heartbeat dày hơn (120/h thay
// vì 60/h khi đứng yên 1h) → tăng nhẹ pin nhưng đảm bảo fix đầu sau STILL
// chính xác sớm.
const LOCATION_TIME_INTERVAL_MS = 30_000;
const HEARTBEAT_MIN_INTERVAL_MS = 30_000;

// distanceInterval (m) theo activity. STILL + UNKNOWN dùng 0 vì Android
// FusedLocationProvider throttle time-based delivery khi smallestDisplacement
// > 0 và device chưa move đủ — đặt 0 để heartbeat luôn fire mỗi timeInterval.
// MOVING tăng threshold theo tốc độ tự nhiên: walking dense, vehicle thưa hơn
// để tránh ingest spam khi đi xe nhanh. Khi user đi xe rồi dừng đèn đỏ,
// ActivityTransition sẽ detect STILL trong 1-3s và reschedule về 0.
const DISTANCE_BY_ACTIVITY: Record<Activity, number> = {
  STILL: 0,          // time-only — heartbeat reliable
  UNKNOWN: 0,        // conservative until classifier identifies
  WALKING: 5,
  RUNNING: 10,
  ON_BICYCLE: 15,
  IN_VEHICLE: 25,
};

// H2 — Cell info cache: Telephony scan ~50-200ms mỗi lần, ở interval 5s
// gọi 12 lần/phút rất tốn. Cells thay đổi rất chậm (handover ~vài phút) →
// cache 15s vẫn fresh đủ cho mọi tick.
const CELL_CACHE_TTL_MS = 15_000;

// Heartbeat throttle khác nhau theo activity — STILL chỉ cần refresh last_seen
// mỗi 60s, MOVING cần dense hơn để admin map mượt.
const HEARTBEAT_STILL_MS = 60_000;

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

// Epoch ms của fix GPS mới nhất từ OS — cập nhật mỗi tick task có fix hợp lệ.
// FE dùng làm dấu mốc "GPS thực sự hoạt động".
let lastFixTime: number | null = null;

/**
 * STILL = device đang đứng yên (Google ML model phân loại). Dùng để chọn
 * cell info path (cached vs fresh) — đứng yên không cần ép modem scan.
 */
function isStill(): boolean {
  return getCurrentActivity() === 'STILL';
}

/**
 * Trả cell info cho task hiện tại:
 *   - STILL: dùng cache 15s + `getCellTowerInfo` (đọc OS framework cache, nhanh).
 *     Đứng yên thì cell không đổi → cache hợp lý, đỡ tốn pin.
 *   - MOVING: cache xuống 5s + `getCellTowerInfoFresh` (ép modem scan qua
 *     `requestCellInfoUpdate`, Android 9+). Đảm bảo handover được phản ánh
 *     ngay trên admin map, không phải đợi đến lúc dừng đèn đỏ mới update.
 */
async function getCachedCells(): Promise<
  Awaited<ReturnType<typeof getCellTowerInfo>>
> {
  const still = isStill();
  const ttl = still ? CELL_CACHE_TTL_MS : 5_000;
  if (cellCache && Date.now() - cellCache.ts < ttl) {
    return cellCache.towers;
  }
  try {
    const towers = still
      ? await getCellTowerInfo()
      : await getCellTowerInfoFresh();
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
 * Build buffer ready để gửi. KHÔNG còn movement gate — OS đã filter bằng
 * distanceInterval (adaptive theo activity). Buffer chỉ còn dùng cho:
 *  - Retry khi network fail
 *  - Drop fix quá cũ (>30 phút) sau crash/restart
 *  - Decouple sample (OS-driven) vs send (NativeIngest)
 *
 * Trả null nếu buffer rỗng (→ task chỉ gửi heartbeat).
 */
async function prepareIngest(
  _force: boolean,
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
  console.log(`[fg-location] sendTelemetry entered hasLoc=${hasLocations} force=${force} fg=${isAppForeground}`);

  // Heartbeat-only path bị throttle để không spam khi tick admin = 5s.
  if (!hasLocations && !force) {
    const last = await getLastSent();
    const throttle = isStill() ? HEARTBEAT_STILL_MS : HEARTBEAT_MIN_INTERVAL_MS;
    const elapsed = last ? Date.now() - last.t : -1;
    console.log(`[fg-location] heartbeat check elapsed=${elapsed}ms throttle=${throttle}ms lastSent=${last?.t ?? 'null'}`);
    if (last && elapsed < throttle) {
      console.log('[fg-location] heartbeat throttled — skip');
      return;
    }
  }

  const batteryLevel = await readBatteryLevel();
  const cellTowers = await getCachedCells();
  const activity = getCurrentActivity();
  const activityConfidence = getCurrentConfidence();
  const payload: {
    locations?: LocationData[];
    cellTowers?: typeof cellTowers;
    batteryLevel?: number;
    lastFixAt?: number;
    activity?: Activity;
    activityConfidence?: number;
  } = {
    cellTowers: cellTowers.length > 0 ? cellTowers : undefined,
    batteryLevel,
  };
  if (hasLocations) payload.locations = ingest!.toSend;
  if (lastFixTime != null) payload.lastFixAt = lastFixTime;
  if (activity !== 'UNKNOWN') {
    payload.activity = activity;
    payload.activityConfidence = activityConfidence;
  }

  let success: boolean;

  if (isAppForeground) {
    const mqttUp = isMqttConnected();
    if (!mqttUp) {
      console.log('[fg-location] foreground: mqtt down, connecting...');
      try { connectMqtt(deviceId); } catch { /* ignore */ }
    }
    console.log(`[fg-location] foreground: sending via ${isMqttConnected() ? 'MQTT' : 'HTTP'} hasLoc=${hasLocations}`);
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
    // Background: dùng NativeIngest (HttpURLConnection chạy native thread).
    // RN's OkHttp bridge và MQTT WebSocket đều bị treo trong headless task khi
    // activity pause — Promise không bao giờ resolve. Native module bypass bridge,
    // dùng standard Java SE network stack độc lập với RN runtime.
    console.log(`[fg-location] background: NativeIngest hasLoc=${hasLocations}`);
    if (NativeIngest) {
      try {
        const status = await NativeIngest.postJson(
          `${API_BASE_URL}${API_ENDPOINTS.INGEST}`,
          { 'Content-Type': 'application/json', 'x-device-id': deviceId },
          JSON.stringify(payload),
          8_000,
        );
        success = status >= 200 && status < 300;
        console.log(`[fg-location] background NativeIngest -> ${status} ${success ? 'OK' : 'fail'}`);
        if (status === 404 && hasLocations) await clearBuffer();
      } catch (err) {
        success = false;
        console.warn('[fg-location] background NativeIngest error:', err instanceof Error ? err.message : String(err));
      }
    } else {
      // Native module chưa link (vd quên rebuild) — fall back về MQTT
      // fire-and-forget. Không async để task không treo.
      const mqttUp = isMqttConnected();
      console.warn('[fg-location] NativeIngest not linked, falling back to MQTT');
      if (mqttUp) publishTelemetry(deviceId, payload, 0).catch(() => {});
      success = !hasLocations;
    }
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
  console.log('[fg-location] ── task fired ──', new Date().toISOString(), `fg=${isAppForeground} mqtt=${isMqttConnected()}`);
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
  console.log(`[fg-location] locations in payload: ${allLocs.length}, still=${isStill()} lastFixTime=${lastFixTime}`);

  // Buffer TẤT CẢ fix hợp lệ — Android có thể batch nhiều fix trong 1 task wake
  // (Doze recover, deferredUpdatesInterval gộp). Trước đây chỉ giữ fix cuối →
  // mất các điểm trung gian → history nhảy điểm khi di chuyển nhanh.
  const toBuffer: LocationData[] = [];
  let droppedAcc = 0;
  for (const loc of allLocs) {
    const acc = loc.coords.accuracy ?? null;
    if (acc != null && acc > MAX_ACCEPTABLE_ACCURACY_M) {
      droppedAcc++;
      continue;
    }
    const ts = loc.timestamp ?? Date.now();
    if (lastFixTime == null || ts > lastFixTime) lastFixTime = ts;
    toBuffer.push({
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      accuracy: acc ?? undefined,
      quality: classifyQuality(acc),
      timestamp: ts,
    });
  }
  if (toBuffer.length > 0) {
    await appendBuffer(toBuffer);
    const last = toBuffer[toBuffer.length - 1];
    console.log(`[fg-location] buffered ${toBuffer.length} fix(es), latest lat=${last.latitude.toFixed(5)} acc=${last.accuracy?.toFixed(0)}m, dropped(acc)=${droppedAcc}`);
  } else if (droppedAcc > 0) {
    console.log(`[fg-location] all ${droppedAcc} fix(es) dropped (accuracy > ${MAX_ACCEPTABLE_ACCURACY_M}m)`);
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

// Module-level state: distanceInterval đang dùng, để biết khi nào cần
// re-register Location updates (tránh restart liên tục khi activity vẫn cùng tier).
let currentDistanceInterval = -1;
let activityUnsubscribe: (() => void) | null = null;

/**
 * Bật foreground service tracking — event-driven theo distance.
 * - distanceInterval: adaptive theo activity (5m walking → 25m vehicle)
 * - timeInterval: 60s fallback heartbeat khi đứng yên không trigger distance event
 * - Khi activity thay đổi → re-register với params mới (qua setOptions native)
 */
export async function startForegroundLocation(): Promise<{ ok: boolean; reason?: string }> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== 'granted') {
    return { ok: false, reason: 'Chưa cấp quyền vị trí' };
  }

  // Bật Activity Recognition để adaptive distanceInterval. Có thể fail trên
  // thiết bị không có Google Play Services — fallback UNKNOWN (10m default).
  try {
    await startActivityRecognition();
  } catch {
    // ignore
  }

  if (activityUnsubscribe) {
    activityUnsubscribe();
    activityUnsubscribe = null;
  }
  activityUnsubscribe = onActivityChange((activity) => {
    const newDistance = DISTANCE_BY_ACTIVITY[activity];
    if (newDistance === currentDistanceInterval) return;
    console.log(`[fg-location] activity=${activity} → distanceInterval=${newDistance}m`);
    void applyLocationParams(newDistance);
  });

  return applyLocationParams(
    DISTANCE_BY_ACTIVITY[getCurrentActivity()],
  );
}

/**
 * Register Location updates với distanceInterval cụ thể. Idempotent —
 * gọi lại khi đã có task sẽ chỉ setOptions native, không gap tracking.
 */
async function applyLocationParams(
  distanceInterval: number,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    await Location.startLocationUpdatesAsync(FOREGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      distanceInterval,
      timeInterval: LOCATION_TIME_INTERVAL_MS,  // heartbeat fallback 60s
      deferredUpdatesInterval: 0,                // không cho OS defer
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
    currentDistanceInterval = distanceInterval;
    console.log(`[fg-location] startLocationUpdatesAsync OK distance=${distanceInterval}m`);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[fg-location] startLocationUpdatesAsync failed:', msg);
    return { ok: false, reason: msg };
  }
}

export async function stopForegroundLocation(): Promise<void> {
  const running = await Location.hasStartedLocationUpdatesAsync(
    FOREGROUND_LOCATION_TASK,
  );
  if (running) {
    await Location.stopLocationUpdatesAsync(FOREGROUND_LOCATION_TASK);
  }
  if (activityUnsubscribe) {
    activityUnsubscribe();
    activityUnsubscribe = null;
  }
  await stopActivityRecognition();
  await clearBuffer();
  await AsyncStorage.removeItem(STORAGE_KEY_LAST_SENT);
  cellCache = null;
  lastFixTime = null;
  currentDistanceInterval = -1;
}
