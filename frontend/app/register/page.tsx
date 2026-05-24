"use client";

import axios from "axios";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Copy,
  Loader2,
  Lock,
  Mail,
  Radio,
  Smartphone,
  User,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/components/AuthProvider";

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const account = await register({
        email: email.trim().toLowerCase(),
        password,
        displayName: displayName.trim() || undefined,
      });
      setPairingCode(account.pairingCode);
    } catch (err: unknown) {
      const msg =
        axios.isAxiosError(err) &&
        typeof err.response?.data === "object" &&
        err.response?.data &&
        "message" in err.response.data
          ? String((err.response.data as { message: unknown }).message)
          : "Đăng ký thất bại, vui lòng thử lại";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function copyCode() {
    if (!pairingCode) return;
    try {
      await navigator.clipboard.writeText(pairingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  if (pairingCode) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">
                Tạo tài khoản thành công
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Lưu mã ghép bên dưới để cài app trên thiết bị người thân
              </p>
            </div>
          </div>

          <div className="mb-4 rounded-xl bg-emerald-50 p-6 text-center">
            <p className="text-xs font-medium uppercase tracking-wider text-emerald-700">
              Pairing Code
            </p>
            <div className="my-3 select-all font-mono text-4xl font-black tracking-widest text-emerald-900">
              {pairingCode}
            </div>
            <button
              type="button"
              onClick={copyCode}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
            >
              <Copy className="h-3.5 w-3.5" />
              {copied ? "Đã copy!" : "Copy"}
            </button>
          </div>

          <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <div className="flex items-start gap-2">
              <Smartphone className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-500" />
              <p>
                <span className="font-semibold">Cài app deviceTracking</span>{" "}
                trên điện thoại của trẻ em / người già cần giám sát.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <Radio className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-500" />
              <p>
                Mở app, nhập <span className="font-mono font-semibold">{pairingCode}</span>{" "}
                vào ô <em>Pairing code</em>, chọn loại người (trẻ em / người
                già) và bấm{" "}
                <span className="font-semibold">Ghép thiết bị</span>.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-500" />
              <p>
                Quay lại đây và vào{" "}
                <span className="font-semibold">Dashboard</span> — thiết bị sẽ
                xuất hiện ngay khi gửi vị trí đầu tiên.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => router.replace("/dashboard")}
            className="mt-6 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
          >
            Vào Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100">
            <Radio className="h-6 w-6 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Đăng ký phụ huynh
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Tạo tài khoản để giám sát người thân
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">
              Email
            </span>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                disabled={submitting}
                className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 placeholder-slate-400 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50"
                placeholder="ban@example.com"
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">
              Mật khẩu
            </span>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={6}
                disabled={submitting}
                className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 placeholder-slate-400 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50"
                placeholder="ít nhất 6 ký tự"
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">
              Tên hiển thị <span className="text-slate-400">(tuỳ chọn)</span>
            </span>
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={submitting}
                className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 placeholder-slate-400 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50"
                placeholder="Gia đình họ Nguyễn"
              />
            </div>
          </label>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-400"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? "Đang tạo tài khoản…" : "Đăng ký"}
          </button>

          <p className="text-center text-sm text-slate-600">
            Đã có tài khoản?{" "}
            <Link
              href="/login"
              className="font-medium text-emerald-600 hover:text-emerald-700"
            >
              Đăng nhập
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
