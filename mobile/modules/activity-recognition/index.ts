import { NativeModule, requireOptionalNativeModule } from 'expo-modules-core';

/**
 * 7 trạng thái Google Activity Recognition trả về. Tham khảo:
 * https://developers.google.com/android/reference/com/google/android/gms/location/DetectedActivity
 */
export type ActivityType =
  | 'STILL'
  | 'WALKING'
  | 'RUNNING'
  | 'ON_FOOT'      // tổng quát WALKING + RUNNING khi không tách được
  | 'ON_BICYCLE'
  | 'IN_VEHICLE'
  | 'TILTING'      // phone đang được cầm/nghiêng
  | 'UNKNOWN';

export interface ActivityResult {
  activity: ActivityType;
  /** Confidence 0-100 từ ML model */
  confidence: number;
  /** Epoch ms khi detect */
  timestamp: number;
}

export interface ActivityTransitionEvent {
  activity: ActivityType;
  transition: 'ENTER';
  elapsedRealTimeNanos: number;
}

export type ActivityRecognitionEvents = {
  activity(event: ActivityResult): void;
  transition(event: ActivityTransitionEvent): void;
};

declare class ActivityRecognitionNativeModule extends NativeModule<ActivityRecognitionEvents> {
  /** Subscribe activity updates periodic (60s). Confidence-based, có TILTING etc. */
  start(intervalMs: number): Promise<void>;
  /**
   * Subscribe transitions — fire NGAY khi user ENTER 1 activity mới
   * (STILL/WALKING/RUNNING/ON_BICYCLE/IN_VEHICLE). Event-driven thuần, không
   * có lag periodic. Dùng để adaptive distanceInterval kịp thời.
   */
  startTransitions(): Promise<void>;
  /** Unsubscribe cả periodic + transitions, huỷ pending intents. */
  stop(): Promise<void>;
  /** Trả activity gần nhất đã cache, null nếu chưa có. */
  getLastActivity(): Promise<ActivityResult | null>;
}

const ActivityRecognition =
  requireOptionalNativeModule<ActivityRecognitionNativeModule>(
    'ActivityRecognitionModule',
  );

export default ActivityRecognition;
