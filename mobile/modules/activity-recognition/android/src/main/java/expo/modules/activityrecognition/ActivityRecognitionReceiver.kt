package expo.modules.activityrecognition

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.location.ActivityRecognitionResult

/**
 * Nhận broadcast từ Google Play Services khi có activity update mới, parse
 * kết quả và emit qua module instance sang JS. Cache lại activity mới nhất
 * để getLastActivity() có dữ liệu trả ngay không phải chờ broadcast kế tiếp.
 */
class ActivityRecognitionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (!ActivityRecognitionResult.hasResult(intent)) return
    val result = ActivityRecognitionResult.extractResult(intent) ?: return

    val payload = activityResultToMap(result)
    ActivityRecognitionModule.lastActivity = payload

    val module = ActivityRecognitionModule.instance
    if (module != null) {
      try {
        module.sendEvent("activity", payload)
      } catch (e: Exception) {
        Log.w("ActivityRecognition", "sendEvent failed: ${e.message}")
      }
    }
  }
}
