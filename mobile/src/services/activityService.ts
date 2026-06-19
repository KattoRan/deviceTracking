import { PermissionsAndroid, Platform } from 'react-native';
import ActivityRecognition, {
  type ActivityResult,
  type ActivityTransitionEvent,
  type ActivityType,
} from 'activity-recognition';

/**
 * Wrapper hợp nhất logic permission + state caching cho activity recognition.
 *
 * Bộ phân loại Google ML trả về 7 trạng thái — chúng ta normalize ON_FOOT về
 * WALKING (cùng ý nghĩa) để giảm số nhánh adaptive ở foregroundLocationService.
 * TILTING (cầm điện thoại nghiêng) coi như UNKNOWN — không reschedule GPS theo
 * trạng thái này vì nó là noise, không phản ánh activity thực.
 */

export type Activity =
  | 'STILL'
  | 'WALKING'
  | 'RUNNING'
  | 'ON_BICYCLE'
  | 'IN_VEHICLE'
  | 'UNKNOWN';

function normalize(raw: ActivityType): Activity {
  switch (raw) {
    case 'WALKING':
    case 'ON_FOOT':
      return 'WALKING';
    case 'RUNNING':
      return 'RUNNING';
    case 'ON_BICYCLE':
      return 'ON_BICYCLE';
    case 'IN_VEHICLE':
      return 'IN_VEHICLE';
    case 'STILL':
      return 'STILL';
    default:
      return 'UNKNOWN';
  }
}

const UPDATE_INTERVAL_MS = 60_000;
const MIN_CONFIDENCE = 60; // chỉ tin activity nếu ML model confident ≥ 60%

let currentActivity: Activity = 'UNKNOWN';
let currentConfidence = 0;
let periodicSub: { remove(): void } | null = null;
let transitionSub: { remove(): void } | null = null;
type Listener = (activity: Activity, confidence: number) => void;
const listeners = new Set<Listener>();

function applyActivity(next: Activity, confidence: number): void {
  if (next === currentActivity && confidence === currentConfidence) return;
  currentActivity = next;
  currentConfidence = confidence;
  for (const cb of listeners) {
    try {
      cb(next, confidence);
    } catch {
      // listeners must not throw
    }
  }
}

async function ensurePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (Platform.Version < 29) return true;
  const perm = 'android.permission.ACTIVITY_RECOGNITION' as Parameters<
    typeof PermissionsAndroid.check
  >[0];
  const already = await PermissionsAndroid.check(perm);
  if (already) return true;
  const res = await PermissionsAndroid.request(perm, {
    title: 'Quyền nhận dạng hoạt động',
    message:
      'Ứng dụng cần quyền này để phân loại đứng yên / đi bộ / lái xe ' +
      'để tối ưu tần suất cập nhật vị trí và tiết kiệm pin.',
    buttonPositive: 'Đồng ý',
    buttonNegative: 'Từ chối',
  });
  return res === PermissionsAndroid.RESULTS.GRANTED;
}

export async function startActivityRecognition(): Promise<boolean> {
  if (!ActivityRecognition) return false;
  const ok = await ensurePermission();
  if (!ok) return false;

  if (periodicSub || transitionSub) return true; // idempotent

  // Periodic — confidence-based, có dữ liệu cho UI hiển thị + fallback.
  periodicSub = ActivityRecognition.addListener('activity', (e: ActivityResult) => {
    if (e.confidence < MIN_CONFIDENCE) return;
    applyActivity(normalize(e.activity), e.confidence);
  });

  // Transitions — event-driven, fire NGAY khi user chuyển state. Critical
  // để bắt STILL→MOVING kịp thời (vài giây thay vì 30-60s periodic lag).
  transitionSub = ActivityRecognition.addListener(
    'transition',
    (e: ActivityTransitionEvent) => {
      // Transition luôn là high-confidence event từ ML model.
      applyActivity(normalize(e.activity), 100);
    },
  );

  try {
    await ActivityRecognition.start(UPDATE_INTERVAL_MS);
    await ActivityRecognition.startTransitions();
    return true;
  } catch {
    return false;
  }
}

export async function stopActivityRecognition(): Promise<void> {
  if (periodicSub) {
    periodicSub.remove();
    periodicSub = null;
  }
  if (transitionSub) {
    transitionSub.remove();
    transitionSub = null;
  }
  if (ActivityRecognition) {
    try {
      await ActivityRecognition.stop();
    } catch {
      // ignore
    }
  }
  currentActivity = 'UNKNOWN';
  currentConfidence = 0;
}

export function getCurrentActivity(): Activity {
  return currentActivity;
}

export function getCurrentConfidence(): number {
  return currentConfidence;
}

/** Subscribe activity changes. Trả unsubscribe function. */
export function onActivityChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
