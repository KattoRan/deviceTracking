package expo.modules.nativeingest

import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.IOException
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * HTTP POST via java.net.HttpURLConnection trên Executor thread riêng.
 * Bypass React Native's OkHttp pool — bridge này bị treo trong headless task
 * (TaskManager background) khi activity bị pause trên Android. HttpURLConnection
 * không phụ thuộc RN runtime, chỉ dùng standard Java SE network stack.
 */
class NativeIngestModule : Module() {
  private val executor = Executors.newCachedThreadPool()

  override fun definition() = ModuleDefinition {
    Name("NativeIngestModule")

    AsyncFunction("postJson") { url: String, headers: Map<String, String>, body: String, timeoutMs: Int, promise: Promise ->
      executor.execute {
        var conn: HttpURLConnection? = null
        try {
          conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = timeoutMs
            readTimeout = timeoutMs
            doOutput = true
            useCaches = false
            // headers caller-provided (Content-Type, x-device-id, ...).
            for ((k, v) in headers) setRequestProperty(k, v)
          }

          val bytes = body.toByteArray(Charsets.UTF_8)
          conn.setFixedLengthStreamingMode(bytes.size)
          val out: OutputStream = conn.outputStream
          out.write(bytes)
          out.flush()
          out.close()

          val code = conn.responseCode
          // Consume body để connection được pool reuse (Android docs khuyến nghị).
          try {
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            stream?.use { it.readBytes() }
          } catch (_: IOException) { /* ignore */ }

          Log.d("NativeIngest", "POST $url -> $code")
          promise.resolve(code)
        } catch (e: Exception) {
          Log.w("NativeIngest", "POST $url failed: ${e.message}")
          promise.reject("NATIVE_INGEST_ERROR", e.message ?: "unknown", e)
        } finally {
          conn?.disconnect()
        }
      }
    }
  }
}
