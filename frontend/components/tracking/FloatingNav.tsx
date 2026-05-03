"use client";

import Link from "next/link";
import {
  History,
  Home,
  LayoutDashboard,
  MapPin,
  Menu,
  Radio,
  Settings,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type NavItem = {
  name: string;
  icon: LucideIcon;
  href: string;
  active?: boolean;
};

const ITEMS: NavItem[] = [
  { name: "Trang chủ", icon: Home, href: "/" },
  { name: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
  { name: "Giám sát", icon: MapPin, href: "/tracking", active: true },
  { name: "Lịch sử", icon: History, href: "/history" },
  { name: "Vùng an toàn", icon: Shield, href: "/geofences" },
  { name: "Quản lý thiết bị", icon: Settings, href: "/manage-devices" },
];

/**
 * The tracking page owns the full viewport so the global AppLayout nav is
 * hidden. This floating overlay gives the user a way out — collapsed to a
 * single icon so it never competes with the map for space.
 */
export default function FloatingNav() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={ref}
      // Sit to the right of the sidebar-toggle on mobile (which is at left-4,
      // only rendered when the sidebar is collapsed at max-lg). On lg+ the
      // toggle never appears so left-4 is free.
      className="absolute left-4 top-4 z-[1001] max-lg:left-16"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Mở menu điều hướng"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-sm font-medium text-slate-700 shadow-sm backdrop-blur-sm transition-colors hover:bg-white"
      >
        <Menu className="h-4 w-4" />
        <span className="hidden sm:inline">Menu</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white/98 shadow-lg backdrop-blur-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100">
              <Radio className="h-3.5 w-3.5 text-emerald-600" />
            </div>
            <span className="text-sm font-semibold text-slate-900">
              deviceTracking
            </span>
          </div>
          <div className="p-1">
            {ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                    item.active
                      ? "bg-emerald-50 text-emerald-700"
                      : "text-slate-700 hover:bg-slate-50",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.name}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
