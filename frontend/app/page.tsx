"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Battery,
  History,
  MapPin,
  Radio,
  Shield,
  Siren,
  Smartphone,
  Wifi,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

const FEATURES = [
  {
    icon: MapPin,
    title: "Định vị thời gian thực",
    desc: "Theo dõi vị trí thiết bị qua GPS độ chính xác cao, cập nhật mỗi 10 giây trên bản đồ.",
  },
  {
    icon: Wifi,
    title: "Định vị qua trạm BTS",
    desc: "Khi mất tín hiệu GPS (trong nhà, hầm), hệ thống dùng cell tower (LTE/5G) để xác định vị trí tương đối.",
  },
  {
    icon: Shield,
    title: "Vùng giám sát (Geofence)",
    desc: "Cảnh báo tự động khi thiết bị rời khỏi khu vực đã định nghĩa (nhà, trường, công ty).",
  },
  {
    icon: Siren,
    title: "Khẩn cấp SOS",
    desc: "Người dùng thiết bị nhấn 1 nút gửi cảnh báo + vị trí + pin về tài khoản quản lý.",
  },
  {
    icon: History,
    title: "Lịch sử di chuyển",
    desc: "Xem lại toàn bộ hành trình từng chặng theo thời gian, đường đi vẽ trực tiếp trên bản đồ.",
  },
  {
    icon: Battery,
    title: "Cảnh báo pin & offline",
    desc: "Báo ngay khi thiết bị sắp hết pin (<20%) hoặc mất kết nối quá 5 phút.",
  },
];

export default function Home() {
  const router = useRouter();
  const { managerAccount, loading } = useAuth();

  // Logged-in users vào thẳng tracking — landing chỉ dành cho khách / chưa
  // đăng nhập. Vẫn render landing nếu đang loading để tránh blank screen.
  useEffect(() => {
    if (loading) return;
    if (managerAccount) router.replace("/tracking");
  }, [managerAccount, loading, router]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white text-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 md:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100">
              <Radio className="h-5 w-5 text-emerald-600" />
            </div>
            <span className="text-lg font-bold tracking-tight">
              deviceTracking
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
            >
              Đăng nhập
            </Link>
            <Link
              href="/register"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700"
            >
              Đăng ký
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-12 md:px-6 md:pt-20">
        <div className="grid items-center gap-12 md:grid-cols-2">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              Đồ án tốt nghiệp
            </div>
            <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-5xl">
              Hệ thống quản lý giám sát{" "}
              <span className="text-emerald-600">thiết bị di động</span>
            </h1>
            <p className="mt-5 text-base leading-relaxed text-slate-600 md:text-lg">
              Theo dõi vị trí thiết bị Android theo thời gian thực kết hợp GPS
              và trạm BTS. Cảnh báo geofence, SOS, pin yếu, offline — quản lý
              từ web admin trên mọi nền tảng.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/register"
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
              >
                Tạo tài khoản miễn phí
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
              >
                Đã có tài khoản — Đăng nhập
              </Link>
            </div>
            <div className="mt-6 flex items-center gap-3 text-xs text-slate-500">
              <Smartphone className="h-4 w-4" />
              <span>Tải app Android trên thiết bị cần giám sát để ghép cặp</span>
            </div>
          </div>

          {/* Mock visual — phone + map preview */}
          <div className="relative">
            <div className="absolute inset-0 -z-10 rounded-3xl bg-gradient-to-tr from-emerald-100 to-emerald-50 blur-3xl" />
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  <span className="text-xs font-medium text-slate-600">
                    Online · Đang theo dõi
                  </span>
                </div>
                <span className="text-xs text-slate-400">Bản đồ realtime</span>
              </div>
              <div className="relative h-56 overflow-hidden rounded-xl bg-gradient-to-br from-slate-100 to-slate-200">
                {/* Fake roads */}
                <svg
                  className="absolute inset-0 h-full w-full"
                  viewBox="0 0 400 220"
                  fill="none"
                >
                  <path
                    d="M 0,160 Q 100,140 200,150 T 400,80"
                    stroke="#cbd5e1"
                    strokeWidth="14"
                    strokeLinecap="round"
                  />
                  <path
                    d="M 50,0 Q 80,80 120,120 T 200,200"
                    stroke="#cbd5e1"
                    strokeWidth="10"
                    strokeLinecap="round"
                  />
                  {/* Trajectory */}
                  <path
                    d="M 60,170 Q 130,150 200,150 T 340,90"
                    stroke="#16a34a"
                    strokeWidth="3"
                    fill="none"
                    strokeDasharray="0"
                  />
                  <circle cx="60" cy="170" r="6" fill="#3b82f6" stroke="white" strokeWidth="2" />
                  <circle cx="340" cy="90" r="6" fill="#ef4444" stroke="white" strokeWidth="2" />
                  <circle cx="200" cy="150" r="7" fill="#16a34a" stroke="white" strokeWidth="3" />
                </svg>
                <div className="absolute bottom-2 left-2 rounded-lg bg-white/95 px-2 py-1.5 text-[10px] shadow">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-blue-500" />
                    <span className="text-slate-600">Bắt đầu</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-red-500" />
                    <span className="text-slate-600">Kết thúc</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-slate-50 px-2 py-2">
                  <div className="text-xs text-slate-500">Pin</div>
                  <div className="text-sm font-semibold text-slate-900">87%</div>
                </div>
                <div className="rounded-lg bg-slate-50 px-2 py-2">
                  <div className="text-xs text-slate-500">Cell</div>
                  <div className="text-sm font-semibold text-slate-900">LTE</div>
                </div>
                <div className="rounded-lg bg-slate-50 px-2 py-2">
                  <div className="text-xs text-slate-500">GPS</div>
                  <div className="text-sm font-semibold text-emerald-600">±5m</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 py-12 md:px-6 md:py-16">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
            Tính năng chính
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Đầy đủ công cụ quản lý 1 hệ thống giám sát hiện đại
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.title}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-emerald-300 hover:shadow-md"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100">
                  <Icon className="h-5 w-5 text-emerald-600" />
                </div>
                <h3 className="text-base font-semibold text-slate-900">
                  {f.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                  {f.desc}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Tech stack — context cho thesis */}
      <section className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
          <div className="grid items-center gap-6 md:grid-cols-2">
            <div>
              <h3 className="text-lg font-semibold">Công nghệ sử dụng</h3>
              <p className="mt-1 text-sm text-slate-600">
                Stack hiện đại — realtime end-to-end qua MQTT + Socket.IO,
                native Android module cho background tracking ổn định.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                "Next.js 16",
                "NestJS",
                "PostgreSQL + PostGIS",
                "Redis",
                "MQTT (HiveMQ)",
                "Socket.IO",
                "React Native + Expo",
                "Native Android (Kotlin)",
                "MapLibre GL",
              ].map((t) => (
                <span
                  key={t}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA cuối */}
      <section className="mx-auto max-w-3xl px-4 py-16 text-center md:px-6">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
          Bắt đầu giám sát thiết bị đầu tiên
        </h2>
        <p className="mt-3 text-sm text-slate-600 md:text-base">
          Đăng ký tài khoản quản lý → tải APK trên thiết bị Android → nhập mã
          ghép cặp. Vài phút là xong.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            href="/register"
            className="rounded-lg bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
          >
            Tạo tài khoản
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            Đăng nhập
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-6 text-center text-xs text-slate-500 md:px-6">
          © 2026 deviceTracking — Đồ án tốt nghiệp · Xây dựng hệ thống quản lý
          giám sát thiết bị di động
        </div>
      </footer>
    </div>
  );
}
