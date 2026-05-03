import Link from "next/link";
import {
  History,
  LayoutDashboard,
  MapPin,
  Settings,
  Shield,
} from "lucide-react";

const SHORTCUTS = [
  {
    href: "/tracking",
    icon: MapPin,
    title: "Giám sát",
    description: "Bản đồ real-time + trạm BTS",
  },
  {
    href: "/history",
    icon: History,
    title: "Lịch sử",
    description: "Playback quỹ đạo di chuyển",
  },
  {
    href: "/geofences",
    icon: Shield,
    title: "Vùng an toàn",
    description: "Quản lý vùng và cảnh báo vượt vùng",
  },
  {
    href: "/manage-devices",
    icon: Settings,
    title: "Quản lý",
    description: "Danh sách và chi tiết thiết bị",
  },
  {
    href: "/dashboard",
    icon: LayoutDashboard,
    title: "Dashboard",
    description: "Thống kê tổng quan",
  },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-16 md:px-8">
      <header className="mb-10 space-y-3">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          deviceTracking
        </h1>
        <p className="max-w-2xl text-slate-600">
          Hệ thống giám sát thiết bị thời gian thực qua GPS và trạm BTS.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {SHORTCUTS.map(({ href, icon: Icon, title, description }) => (
          <Link
            key={href}
            href={href}
            className="group rounded-xl border border-slate-200 bg-white p-5 transition-all hover:border-emerald-200 hover:shadow-sm"
          >
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 transition-colors group-hover:bg-emerald-100">
              <Icon className="h-5 w-5" />
            </div>
            <h2 className="mb-1 text-base font-semibold text-slate-900">
              {title}
            </h2>
            <p className="text-sm text-slate-600">{description}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
