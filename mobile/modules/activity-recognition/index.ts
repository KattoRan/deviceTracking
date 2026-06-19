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

export type ActivityRecognitionEvents = {
  activity(event: ActivityResult): void;
};

declare class ActivityRecognitionNativeModule extends NativeModule<ActivityRecognitionEvents> {
  /** Subscribe activity updates. Interval ms (60_000 = 60s khuyến nghị). */
  start(intervalMs: number): Promise<void>;
  /** Unsubscribe + huỷ pending intents. */
  stop(): Promise<void>;
  /** Trả activity gần nhất đã cache, null nếu chưa có. */
  getLastActivity(): Promise<ActivityResult | null>;
}

const ActivityRecognition =
  requireOptionalNativeModule<ActivityRecognitionNativeModule>(
    'ActivityRecognitionModule',
  );

export default ActivityRecognition;
