"use client";

import {
  Check,
  Copy,
  LogOut,
  Mail,
  Phone,
  Radio,
  Smartphone,
  User,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useAuth } from "@/components/AuthProvider";

export default function AccountPage() {
  const router = useRouter();
  const { parentAccount, updateProfile, logout } = useAuth();
  const [copied, setCopied] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phoneSaved, setPhoneSaved] = useState(false);

  useEffect(() => {
    setPhoneInput(parentAccount?.phoneNumber ?? "");
  }, [parentAccount?.phoneNumber]);

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

  async function handleSavePhone(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPhoneSaving(true);
    setPhoneError(null);
    setPhoneSaved(false);
    const trimmed = phoneInput.trim();
    try {
      await updateProfile({ phoneNumber: trimmed ? trimmed : null });
      setPhoneSaved(true);
      setTimeout(() => setPhoneSaved(false), 2000);
    } catch (err: unknown) {
      const msg =
        axios.isAxiosError(err) &&
        typeof err.response?.data === "object" &&
        err.response?.data &&
        "message" in err.response.data
          ? String((err.response.data as { message: unknown }).message)
          : "Không lưu được số điện thoại";
      setPhoneError(msg);
    } finally {
      setPhoneSaving(false);
    }
  }

  function handleLogout() {
    logout();
    router.replace("/login");
  }

  const phoneDirty =
    phoneInput.trim() !== (parentAccount?.phoneNumber ?? "").trim();

  if (!parentAccount) return null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Tài khoản
        </h1>
        <p className="text-sm text-slate-600">
          Thông tin tài khoản phụ huynh & số điện thoại liên lạc
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
          <Phone className="h-4 w-4" />
          Số điện thoại liên lạc
        </div>
        <p className="mb-4 text-sm text-slate-600">
          Số này hiển thị trên app của trẻ em / người già để họ gọi về khi cần.
        </p>
        <form onSubmit={handleSavePhone} className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex-1">
            <input
              type="tel"
              inputMode="tel"
              value={phoneInput}
              onChange={(e) => {
                setPhoneInput(e.target.value);
                setPhoneError(null);
                setPhoneSaved(false);
              }}
              placeholder="0987654321"
              disabled={phoneSaving}
              maxLength={20}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50"
            />
            {phoneError && (
              <p className="mt-2 text-sm text-red-600">{phoneError}</p>
            )}
            {phoneSaved && (
              <p className="mt-2 flex items-center gap-1 text-sm text-emerald-600">
                <Check className="h-3.5 w-3.5" />
                Đã lưu
              </p>
            )}
          </div>
          <button
            type="submit"
            disabled={phoneSaving || !phoneDirty}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
          >
            {phoneSaving ? "Đang lưu…" : "Lưu"}
          </button>
        </form>
      </section>
    </div>
  );
}
