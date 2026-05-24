"use client";

import {
  Bell,
  BellOff,
  Check,
  Copy,
  LogOut,
  Mail,
  Radio,
  Smartphone,
  User,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  getActiveSubscription,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/services/pushService";

export default function AccountPage() {
  const router = useRouter();
  const { parentAccount, logout } = useAuth();
  const [copied, setCopied] = useState(false);
  const [pushEnabled, setPushEnabled] = useState<boolean | null>(null);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      if (!(await isPushSupported())) {
        setPushEnabled(false);
        return;
      }
      const sub = await getActiveSubscription();
      setPushEnabled(!!sub && Notification.permission === "granted");
    })();
  }, []);

  async function copyCode() {
    if (!parentAccount) return;
    try {
      await navigator.clipboard.writeText(parentAccount.pairingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  async function togglePush() {
    setPushLoading(true);
    setPushError(null);
    try {
      if (pushEnabled) {
        await unsubscribeFromPush();
        setPushEnabled(false);
      } else {
        const res = await subscribeToPush();
        if (res.ok) {
          setPushEnabled(true);
        } else {
          setPushError(res.reason ?? "Không bật được thông báo");
        }
      }
    } finally {
      setPushLoading(false);
    }
  }

  function handleLogout() {
    logout();
    router.replace("/login");
  }

  if (!parentAccount) return null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Tài khoản
        </h1>
        <p className="text-sm text-slate-600">
          Thông tin tài khoản phụ huynh & thiết lập thông báo
        </p>
      </header>

      <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <User className="h-4 w-4" />
          Thông tin tài khoản
        </div>
        <dl className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <dt className="flex items-center gap-2 text-slate-500">
              <Mail className="h-4 w-4" />
              Email
            </dt>
            <dd className="font-medium text-slate-900">
              {parentAccount.email}
            </dd>
          </div>
          {parentAccount.displayName && (
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Tên hiển thị</dt>
              <dd className="font-medium text-slate-900">
                {parentAccount.displayName}
              </dd>
            </div>
          )}
        </dl>
        <button
          type="button"
          onClick={handleLogout}
          className="mt-6 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-red-50 hover:text-red-600"
        >
          <LogOut className="h-4 w-4" />
          Đăng xuất
        </button>
      </section>

      <section className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-emerald-800">
          <Radio className="h-4 w-4" />
          Pairing code
        </div>
        <div className="rounded-xl bg-white p-6 text-center">
          <p className="text-xs font-medium uppercase tracking-wider text-emerald-700">
            Mã ghép thiết bị
          </p>
          <div className="my-3 select-all font-mono text-4xl font-black tracking-widest text-emerald-900">
            {parentAccount.pairingCode}
          </div>
          <button
            type="button"
            onClick={copyCode}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" />
                Đã copy
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy
              </>
            )}
          </button>
        </div>
        <div className="mt-4 flex items-start gap-2 text-sm text-emerald-900">
          <Smartphone className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>
            Khi cài app trên điện thoại trẻ em / người già, nhập code này để
            thiết bị tự gắn vào tài khoản. Code dùng nhiều lần — chia sẻ với
            người thân an toàn.
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
          {pushEnabled ? (
            <Bell className="h-4 w-4 text-emerald-600" />
          ) : (
            <BellOff className="h-4 w-4 text-slate-400" />
          )}
          Thông báo đẩy
        </div>
        <p className="mb-4 text-sm text-slate-600">
          Nhận cảnh báo SOS, geofence, pin yếu trên trình duyệt — kể cả khi
          đóng tab.
        </p>
        {pushError && (
          <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {pushError}
          </p>
        )}
        <button
          type="button"
          onClick={togglePush}
          disabled={pushLoading || pushEnabled === null}
          className={
            pushEnabled
              ? "rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              : "rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          }
        >
          {pushLoading
            ? "Đang xử lý…"
            : pushEnabled
              ? "Tắt thông báo"
              : "Bật thông báo"}
        </button>
      </section>
    </div>
  );
}
