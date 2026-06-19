package expo.modules.activityrecognition

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionResult

/**
 * Nhận event ENTER/EXIT của các activity được monitor. Khác với
 * ActivityRecognitionReceiver (periodic), receiver này fire NGAY khi ML
 * model detect transition → dùng để adaptive distanceInterval kịp thời
 * khi user chuyển từ STILL sang MOVING.
 */
class ActivityTransitionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (!ActivityTransitionResult.hasResult(intent)) return
    val result = ActivityTransitionResult.extractResult(intent) ?: return

    val module = ActivityRecognitionModule.instance ?: return
    for (event in result.transitionEvents) {
      // Chỉ care ENTER — EXIT đến cùng lúc với ENTER của activity khác.
      if (event.transitionType != ActivityTransition.ACTIVITY_TRANSITION_ENTER) continue

      val payload = mapOf(
        "activity" to detectedActivityToString(event.activityType),
        "transition" to "ENTER",
        "elapsedRealTimeNanos" to event.elapsedRealTimeNanos,
      )
      // Cũng cập nhật lastActivity cache để getLastActivity() trả về ngay.
      ActivityRecognitionModule.lastActivity = mapOf(
        "activity" to detectedActivityToString(event.activityType),
        "confidence" to 100,  // transition là high-confidence event
        "timestamp" to System.currentTimeMillis(),
      )

      try {
        module.sendEvent("transition", payload)
      } catch (e: Exception) {
        Log.w("ActivityTransition", "sendEvent failed: ${e.message}")
      }
    }
  }
}
