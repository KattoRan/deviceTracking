"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  History,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Radio,
  Settings,
  Shield,
  Siren,
  UserCircle,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import {
  GeofenceAlertsProvider,
  GeofenceBell,
  GeofenceReturnedToasts,
} from "@/components/GeofenceAlerts";
import { cn } from "@/lib/utils";

type NavItem = {
  name: string;
  icon: LucideIcon;
  href: string;
};

const NAV_ITEMS: NavItem[] = [
  { name: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
  { name: "Giám sát", icon: MapPin, href: "/tracking" },
  { name: "Lịch sử", icon: History, href: "/history" },
  { name: "Vùng giám sát", icon: Shield, href: "/geofences" },
  { name: "SOS", icon: Siren, href: "/sos" },
  { name: "Quản lý", icon: Settings, href: "/manage-devices" },
  { name: "Tài khoản", icon: UserCircle, href: "/account" },
];

const PUBLIC_ROUTES = new Set(["/login", "/register"]);

interface AppLayoutProps {
  children: ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { parentAccount, loading, logout } = useAuth();

  const isPublic = PUBLIC_ROUTES.has(pathname);

  useEffect(() => {
    if (loading) return;
    if (!parentAccount && !isPublic) {
      const from = encodeURIComponent(pathname);
      router.replace(`/login?from=${from}`);
    }
  }, [parentAccount, loading, isPublic, pathname, router]);

  // Login/Register pages render standalone (no nav, no guard).
  if (isPublic) {
    return <>{children}</>;
  }

  if (loading || !parentAccount) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Đang tải…
      </div>
    );
  }

  function handleLogout() {
    logout();
    router.replace("/login");
  }

  return (
    <GeofenceAlertsProvider>
      <div className="min-h-screen bg-slate-50">
      <nav className="sticky top-0 z-[1050] border-b border-slate-200 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 md:px-8">
          <div className="flex h-14 items-center justify-between">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100">
                <Radio className="h-4 w-4 text-emerald-600" />
              </div>
              <span className="text-lg font-bold tracking-tight text-slate-900">
                deviceTracking
              </span>
            </Link>

            <div className="hidden items-center gap-1 md:flex">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
                      active
                        ? "bg-emerald-50 text-emerald-700"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.name}
                  </Link>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <GeofenceBell />
              <div className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 md:flex">
                <UserCircle className="h-4 w-4 text-slate-500" />
                <span className="font-medium">{parentAccount.displayName ?? parentAccount.email}</span>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                aria-label="Đăng xuất"
                title="Đăng xuất"
                className="hidden items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-red-50 hover:text-red-600 md:flex"
              >
                <LogOut className="h-4 w-4" />
                Đăng xuất
              </button>
              <button
                type="button"
                onClick={() => setMobileMenuOpen((prev) => !prev)}
                aria-label="Toggle menu"
                aria-expanded={mobileMenuOpen}
                className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900 md:hidden"
              >
                {mobileMenuOpen ? (
                  <X className="h-5 w-5" />
                ) : (
                  <Menu className="h-5 w-5" />
                )}
              </button>
            </div>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="space-y-1 border-t border-slate-200 bg-white px-4 py-3 md:hidden">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                    active
                      ? "bg-emerald-50 text-emerald-700"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.name}
                </Link>
              );
            })}
            <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3">
              <div className="flex items-center gap-2 text-sm text-slate-700">
                <UserCircle className="h-4 w-4 text-slate-500" />
                <span className="font-medium">{parentAccount.displayName ?? parentAccount.email}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleLogout();
                }}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-red-50 hover:text-red-600"
              >
                <LogOut className="h-4 w-4" />
                Đăng xuất
              </button>
            </div>
          </div>
        )}
      </nav>

      {children}
      <GeofenceReturnedToasts />
      </div>
    </GeofenceAlertsProvider>
  );
}
