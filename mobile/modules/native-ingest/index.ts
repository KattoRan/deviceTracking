import { requireOptionalNativeModule } from 'expo-modules-core';

interface NativeIngestNativeModule {
  /**
   * POST `body` (JSON-stringified) to `url` with the given headers, using
   * Android's java.net.HttpURLConnection on a dedicated background thread —
   * not React Native's OkHttp pool. Required for headless background tasks
   * where RN's network bridge hangs after the activity is paused.
   *
   * Resolves with the HTTP status code on success, rejects with an Error on
   * IO failure or timeout.
   */
  postJson(
    url: string,
    headers: Record<string, string>,
    body: string,
    timeoutMs: number,
  ): Promise<number>;
}

const NativeIngest =
  requireOptionalNativeModule<NativeIngestNativeModule>('NativeIngestModule');

export default NativeIngest;
