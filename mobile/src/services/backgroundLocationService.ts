import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Vibration } from 'react-native';
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

async function shouldFlushNow(force?: boolean): Promise<boolean> {
  if (force) return true;
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
async function flushBufferIfNeeded(
  deviceId: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY_BUFFER);
  if (!raw) return;
  const buffer: BufferedFix[] = JSON.parse(raw);
  if (buffer.length === 0) return;
  if (!(await shouldFlushNow(opts.force))) return;

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

// ──────────────────────────────────────────────────────────────────────────
// Background command polling.
//
// Khi app foreground, socket.io nhận command realtime qua App.tsx/TrackingScreen.
// Khi app background, JS runtime bị OS suspend → socket disconnect → command
// im lặng cho tới khi user mở lại. Để workaround, mỗi lần OS đánh thức app
// cho location update, ta gọi POST /commands/poll qua HTTP để rút các command
// còn pending, execute chúng trong headless context (Vibration, force flush,
// stop background…), rồi POST kết quả về.
//
// Trade-off đã chấp nhận:
//   - Trễ tối đa ~30s (timeInterval). distanceInterval=0 + pausesUpdates
//     Automatically=false buộc OS wake task đều mỗi 30s bất kể di chuyển
//     hay không, nên command poll cũng chạy đều theo nhịp đó.
//   - Server cron timeout 30s vẫn an toàn vì task luôn poll trong cửa sổ đó.
//   - request_location_now hoạt động vì location vừa nhận đã ở buffer; ta
//     chỉ cần force-flush ngay thay vì chờ FLUSH_INTERVAL_MS.
//   - toggle_tracking(enabled=true) ở background không khả thi (foreground
//     watcher chỉ chạy khi app mở) → trả về error rõ ràng cho phụ huynh.
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

async function executeCommandInBackground(
  cmd: PendingCommand,
): Promise<CommandExecutionResult> {
  try {
    switch (cmd.command) {
      case 'request_location_now':
        // Vị trí mới nhất đã được append vào buffer phía trên trong cùng
        // task fire. Force-flush để gửi ngay, không chờ throttle 30s.
        return { success: true, needFlush: true };

      case 'ring_alarm': {
        const duration = Math.max(
          1,
          Math.min(60, Number(cmd.payload?.durationSec) || 10),
        );
        // Pattern [wait, vibrate, wait] lặp — khớp với foreground handler
        // ở App.tsx để trải nghiệm rung giống nhau ở cả 2 mode.
        Vibration.vibrate([0, 500, 200], true);
        await new Promise((r) => setTimeout(r, duration * 1000));
        Vibration.cancel();
        return { success: true };
      }

      case 'lock_device':
        // Lock state đã được server persist vào field is_locked + emit
        // device_lock_changed. Khi user mở app, fetchLockStatus + socket
        // listener ở App.tsx sẽ hiện LockOverlay. Background không có
        // React tree để render overlay, chỉ cần ack thành công.
        return { success: true };

      case 'toggle_tracking': {
        const enabled = !!cmd.payload?.enabled;
        if (!enabled) {
          // Tắt background tracking — user vẫn có thể bật lại từ web khi
          // app foreground, hoặc trên thiết bị.
          await stopBackgroundLocation();
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
    // Network fail — chấp nhận. Backend đã mark command delivered ở
    // bước poll, sẽ tự timeout sau COMMAND_TIMEOUT_MS nếu không có
    // result. Không retry vì command sẽ không xuất hiện trong lần
    // poll tiếp (status không còn 'pending').
  }
}

/**
 * Trả về true nếu có command nào yêu cầu force flush buffer ngay (vd
 * request_location_now). Caller dùng cờ này để bypass throttle 30s.
 */
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
    const result = await executeCommandInBackground(cmd);
    if (result.needFlush) needFlush = true;
    await postCommandResult(
      deviceId,
      cmd.commandId,
      result.success,
      result.error,
    );
  }
  return needFlush;
}

/**
 * Headless heartbeat — gọi khi task fire nhưng buffer rỗng (user đứng yên
 * hoặc mọi fix bị filter accuracy). Dashboard cha mẹ vẫn thấy `last_seen`
 * và pin cập nhật đều thay vì "treo" 5-10 phút như flow cũ.
 *
 * Đính kèm cellTowers (nếu lấy được) để server thử cell-based positioning
 * qua Combain khi mất GPS hoàn toàn — thành công sẽ ingest fix `network`,
 * thất bại rơi về heartbeat thường ở server.
 */
async function sendHeartbeatInBackground(
  deviceId: string,
  force: boolean,
): Promise<void> {
  if (!(await shouldFlushNow(force))) return;

  let batteryLevel: number | undefined;
  try {
    const lvl = await Battery.getBatteryLevelAsync();
    batteryLevel = Math.round(lvl * 100);
  } catch {
    // ignore — battery API có thể không có ở simulator
  }

  let cellTowers: Awaited<ReturnType<typeof getCellTowerInfo>> = [];
  try {
    cellTowers = await getCellTowerInfo();
  } catch {
    // cell sample fail — gửi heartbeat không cells
  }

  try {
    const res = await fetch(`${API_BASE_URL}${API_ENDPOINTS.HEARTBEAT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-id': deviceId,
      },
      body: JSON.stringify({
        batteryLevel,
        cellTowers: cellTowers.length > 0 ? cellTowers : undefined,
      }),
    });
    if (res.ok) await markFlushed();
  } catch {
    // Network fail — lần fire tiếp theo sẽ thử lại.
  }
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

  const deviceId = await loadStoredDeviceId();
  if (!deviceId) return; // chưa pair → không gửi

  const payload = data as TaskData | undefined;
  const fixes: BufferedFix[] = [];
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
    await appendToBuffer(fixes);
  }

  // Poll command TRƯỚC khi flush — request_location_now sẽ trả needFlush
  // = true để force gửi buffer ngay, bỏ qua throttle 30s.
  const force = await pollAndExecuteCommands(deviceId);

  // Với distanceInterval=0, OS đánh thức đều mỗi 30s kể cả khi user đứng
  // yên — buffer có thể vẫn rỗng (không fix mới + mọi fix cũ đã flush, hoặc
  // batch này bị filter sạch vì accuracy). Bắn heartbeat để cha mẹ thấy
  // device còn sống, giống flow foreground (TrackingScreen.tsx:143-150).
  const bufferRaw = await AsyncStorage.getItem(STORAGE_KEY_BUFFER);
  const bufferEmpty =
    !bufferRaw || (JSON.parse(bufferRaw) as BufferedFix[]).length === 0;
  if (bufferEmpty) {
    await sendHeartbeatInBackground(deviceId, force);
  } else {
    await flushBufferIfNeeded(deviceId, { force });
  }
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
    // distanceInterval=0: OS wake task theo timeInterval bất kể di chuyển hay
    // không. Yêu cầu nghiệp vụ: cha mẹ phải thấy thiết bị "còn sống" liên tục
    // (last_seen, pin) ngay cả lúc trẻ ngồi yên một chỗ.
    distanceInterval: 0,
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
    // Đặt false trên cả iOS lẫn Android: nếu để iOS auto-pause khi user
    // ngồi xe chạy đều / đứng yên, task ngừng fire → cha mẹ thấy thiết bị
    // "treo". Đánh đổi ~3-5% pin/giờ lấy update liên tục.
    pausesUpdatesAutomatically: false,
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
