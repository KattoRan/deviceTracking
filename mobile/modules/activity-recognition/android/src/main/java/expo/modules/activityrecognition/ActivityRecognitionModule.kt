package expo.modules.activityrecognition

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.android.gms.location.ActivityRecognition
import com.google.android.gms.location.ActivityRecognitionResult
import com.google.android.gms.location.DetectedActivity
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Wrapper Google Play Services ActivityRecognitionClient.
 *
 * Cách hoạt động:
 *   1. JS gọi start(intervalMs) → request periodic updates qua PendingIntent
 *   2. Google Play Services kích hoạt sensors (accel/gyro/step counter)
 *      và chạy ML model, fire BroadcastReceiver mỗi intervalMs
 *   3. Receiver forward kết quả qua ActivityRecognitionModule.emit() về JS
 *   4. JS subscribe qua `addListener('activity', cb)`
 *
 * Permission ACTIVITY_RECOGNITION cần request runtime trên Android 10+.
 * Trên thiết bị không có Google Play Services (Huawei mới), module fail
 * silent — JS sẽ không nhận event nào.
 */
class ActivityRecognitionModule : Module() {
  companion object {
    // Khoá phải khớp với ActivityRecognitionReceiver — singleton instance
    // được lưu để receiver có thể gọi emit() khi Android fire BroadcastReceiver.
    @Volatile var instance: ActivityRecognitionModule? = null

    // Cache activity mới nhất để getLastActivity() trả về ngay không phải
    // chờ broadcast tiếp theo.
    @Volatile var lastActivity: Map<String, Any?>? = null
  }

  private var pendingIntent: PendingIntent? = null

  override fun definition() = ModuleDefinition {
    Name("ActivityRecognitionModule")

    Events("activity")

    OnCreate {
      instance = this@ActivityRecognitionModule
    }

    OnDestroy {
      if (instance === this@ActivityRecognitionModule) {
        instance = null
      }
    }

    AsyncFunction("start") { intervalMs: Long, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("NO_CONTEXT", "React context lost", null)
        return@AsyncFunction
      }
      if (!hasActivityPermission(context)) {
        promise.reject("PERMISSION_DENIED", "ACTIVITY_RECOGNITION permission not granted", null)
        return@AsyncFunction
      }

      try {
        val intent = Intent(context, ActivityRecognitionReceiver::class.java)
        // FLAG_MUTABLE bắt buộc từ Android 12+ để hệ thống điền extras vào intent.
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        } else {
          PendingIntent.FLAG_UPDATE_CURRENT
        }
        val pi = PendingIntent.getBroadcast(context, 0, intent, flags)
        pendingIntent = pi

        val client = ActivityRecognition.getClient(context)
        client.requestActivityUpdates(intervalMs, pi)
          .addOnSuccessListener { promise.resolve(null) }
          .addOnFailureListener { e -> promise.reject("REQUEST_FAILED", e.message ?: "unknown", e) }
      } catch (e: Exception) {
        promise.reject("START_ERROR", e.message ?: "unknown", e)
      }
    }

    AsyncFunction("stop") { promise: Promise ->
      val context = appContext.reactContext
      val pi = pendingIntent
      if (context == null || pi == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      try {
        val client = ActivityRecognition.getClient(context)
        client.removeActivityUpdates(pi)
          .addOnSuccessListener {
            pi.cancel()
            pendingIntent = null
            promise.resolve(null)
          }
          .addOnFailureListener { e -> promise.reject("STOP_FAILED", e.message ?: "unknown", e) }
      } catch (e: Exception) {
        promise.reject("STOP_ERROR", e.message ?: "unknown", e)
      }
    }

    AsyncFunction("getLastActivity") {
      lastActivity  // null nếu chưa có
    }
  }

  private fun hasActivityPermission(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
    return ContextCompat.checkSelfPermission(
      context, Manifest.permission.ACTIVITY_RECOGNITION
    ) == PackageManager.PERMISSION_GRANTED
  }
}

/**
 * Map DetectedActivity int constant sang string match với JS `ActivityType`.
 */
internal fun detectedActivityToString(type: Int): String = when (type) {
  DetectedActivity.STILL       -> "STILL"
  DetectedActivity.WALKING     -> "WALKING"
  DetectedActivity.RUNNING     -> "RUNNING"
  DetectedActivity.ON_FOOT     -> "ON_FOOT"
  DetectedActivity.ON_BICYCLE  -> "ON_BICYCLE"
  DetectedActivity.IN_VEHICLE  -> "IN_VEHICLE"
  DetectedActivity.TILTING     -> "TILTING"
  else                         -> "UNKNOWN"
}

/**
 * Convert ActivityRecognitionResult → map gửi sang JS. Chọn activity có
 * confidence cao nhất (probableActivities đã sort sẵn descending).
 */
internal fun activityResultToMap(result: ActivityRecognitionResult): Map<String, Any?> {
  val top = result.mostProbableActivity
  return mapOf(
    "activity" to detectedActivityToString(top.type),
    "confidence" to top.confidence,
    "timestamp" to result.time,
  )
}
