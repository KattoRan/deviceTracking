import { apiClient } from "@/lib/api";

export interface PushPublicKey {
  key: string | null;
}

export const pushService = {
  getPublicKey: async (): Promise<string | null> => {
    const { data } = await apiClient.get<PushPublicKey>(
      "api/v1/push/public-key",
    );
    return data.key;
  },

  subscribe: async (subscription: PushSubscription): Promise<void> => {
    const json = subscription.toJSON();
    await apiClient.post("api/v1/push/subscribe", {
      endpoint: subscription.endpoint,
      keys: json.keys,
      userAgent:
        typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    });
  },

  unsubscribe: async (endpoint: string): Promise<void> => {
    await apiClient.delete("api/v1/push/subscribe", { data: { endpoint } });
  },
};

/** Convert base64-url (VAPID public key format) → Uint8Array cho applicationServerKey. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = typeof window !== "undefined" ? window.atob(base64) : "";
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function isPushSupported(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function getActiveSubscription(): Promise<PushSubscription | null> {
  if (!(await isPushSupported())) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function subscribeToPush(): Promise<{
  ok: boolean;
  reason?: string;
}> {
  if (!(await isPushSupported())) {
    return { ok: false, reason: "Trình duyệt không hỗ trợ push notification" };
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, reason: "Bạn chưa cho phép gửi thông báo" };
  }

  const key = await pushService.getPublicKey();
  if (!key) {
    return {
      ok: false,
      reason: "Server chưa cấu hình VAPID public key",
    };
  }

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    // PushManager.subscribe expects BufferSource. TypeScript 5.7's stricter
    // ArrayBuffer typing rejects Uint8Array<ArrayBufferLike> directly; copy
    // into a fresh ArrayBuffer-backed Uint8Array to satisfy it.
    const keyBytes = urlBase64ToUint8Array(key);
    const buffer = new ArrayBuffer(keyBytes.byteLength);
    new Uint8Array(buffer).set(keyBytes);
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: buffer,
    });
  }
  await pushService.subscribe(sub);
  return { ok: true };
}

export async function unsubscribeFromPush(): Promise<void> {
  const sub = await getActiveSubscription();
  if (!sub) return;
  try {
    await pushService.unsubscribe(sub.endpoint);
  } catch {
    // ignore — server-side cleanup best-effort
  }
  await sub.unsubscribe();
}
