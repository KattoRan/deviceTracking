"use client";

import { Bell, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  getActiveSubscription,
  isPushSupported,
  subscribeToPush,
} from "@/services/pushService";

const DISMISS_KEY = "deviceTracking.pushPromptDismissed";

/**
 * Registers the service worker on mount, then nhắc user bật push notification
 * sau khi đăng nhập (chỉ nhắc 1 lần, dismiss được). Render banner vì các
 * trình duyệt yêu cầu Notification.requestPermission() trong user gesture.
 */
export default function PwaRegister() {
  const { parentAccount } = useAuth();
  const [showPrompt, setShowPrompt] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("[pwa] SW register failed:", err);
    });
  }, []);

  useEffect(() => {
    if (!parentAccount) {
      setShowPrompt(false);
      return;
    }
    void (async () => {
      if (!(await isPushSupported())) return;
      if (Notification.permission !== "default") return;
      const sub = await getActiveSubscription();
      if (sub) return;
      const dismissed = localStorage.getItem(DISMISS_KEY);
      if (dismissed) return;
      setShowPrompt(true);
    })();
  }, [parentAccount]);

  async function handleSubscribe() {
    setSubscribing(true);
    setError(null);
    const res = await subscribeToPush();
    setSubscribing(false);
    if (res.ok) {
      setShowPrompt(false);
    } else {
      setError(res.reason ?? "Không bật được thông báo");
    }
  }

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setShowPrompt(false);
  }

  if (!showPrompt) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-[2000] md:left-auto md:right-4 md:w-96">
      <div className="rounded-xl border border-emerald-200 bg-white p-4 shadow-lg">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-100">
            <Bell className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-900">
              Bật thông báo
            </p>
            <p className="mt-1 text-xs text-slate-600">
              Nhận cảnh báo SOS, geofence, pin yếu kể cả khi đóng tab.
            </p>
            {error && (
              <p className="mt-2 text-xs text-red-600">{error}</p>
            )}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={handleSubscribe}
                disabled={subscribing}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:bg-emerald-400"
              >
                {subscribing ? "Đang bật…" : "Bật ngay"}
              </button>
              <button
                type="button"
                onClick={handleDismiss}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Để sau
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Đóng"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
