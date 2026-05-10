"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  Loader2,
  MapPin,
  Signal,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useGeofenceAlerts } from "@/components/GeofenceAlerts";
import { useSocket } from "@/hooks/useSocket";
import deviceService from "@/services/deviceService";
import type { Device, DeviceMovedEvent } from "@/types/device";
import { cn } from "@/lib/utils";

const DashboardMiniMap = dynamic(
  () => import("@/components/dashboard/DashboardMiniMap"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-slate-100">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    ),
  },
);

function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DashboardPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { active: activeBreaches } = useGeofenceAlerts();

  // Stay in sync with realtime device movement so KPIs and the mini-map
  // reflect the current state without a manual reload.
  const handleDeviceMoved = useCallback((event: DeviceMovedEvent) => {
    setDevices((prev) =>
      prev.map((d) =>
        d.id === event.deviceId
          ? {
              ...d,
              latitude: event.lat,
              longitude: event.lon,
              last_seen: event.timestamp,
              status: "online",
            }
          : d,
      ),
    );
  }, []);
  useSocket(handleDeviceMoved);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    deviceService
      .getAll()
      .then((data) => {
        if (!cancelled) setDevices(data);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Không tải được danh sách thiết bị");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    const total = devices.length;
    const online = devices.filter((d) => d.status === "online").length;
    return {
      total,
      online,
      offline: total - online,
      breaches: activeBreaches.length,
    };
  }, [devices, activeBreaches]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Tổng quan
        </h1>
        <p className="text-sm text-slate-600">
          Trạng thái thiết bị và vi phạm vùng giám sát theo thời gian thực.
        </p>
      </header>

      <section className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <Kpi
          label="Tổng thiết bị"
          value={stats.total}
          icon={Users}
          accent="bg-slate-100 text-slate-700"
        />
        <Kpi
          label="Trực tuyến"
          value={stats.online}
          icon={Signal}
          accent="bg-emerald-50 text-emerald-700"
        />
        <Kpi
          label="Ngoại tuyến"
          value={stats.offline}
          icon={Clock}
          accent="bg-slate-100 text-slate-500"
        />
        <Kpi
          label="Đang vi phạm"
          value={stats.breaches}
          icon={AlertTriangle}
          accent={
            stats.breaches > 0
              ? "bg-red-50 text-red-700"
              : "bg-slate-100 text-slate-500"
          }
        />
      </section>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-900">
                Vị trí thiết bị
              </h2>
            </div>
            <Link
              href="/tracking"
              className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"
            >
              Mở bản đồ đầy đủ
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="h-[420px]">
            {loading ? (
              <div className="flex h-full w-full items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : (
              <DashboardMiniMap devices={devices} />
            )}
          </div>
        </div>

        <ActiveBreachesPanel />
      </section>
    </main>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: typeof Users;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg",
            accent,
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs text-slate-500">{label}</p>
          <p className="text-xl font-semibold text-slate-900">{value}</p>
        </div>
      </div>
    </div>
  );
}

function ActiveBreachesPanel() {
  const { active } = useGeofenceAlerts();

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <AlertTriangle
            className={cn(
              "h-4 w-4",
              active.length > 0 ? "text-red-600" : "text-slate-400",
            )}
          />
          <h2 className="text-sm font-semibold text-slate-900">
            Cảnh báo đang hoạt động
          </h2>
          {active.length > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
              {active.length}
            </span>
          )}
        </div>
        <Link
          href="/geofences"
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
        >
          Vùng
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {active.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50">
            <Signal className="h-5 w-5 text-emerald-600" />
          </div>
          <p className="text-sm font-medium text-slate-700">
            Tất cả đang trong vùng
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Không có thiết bị nào ngoài vùng giám sát.
          </p>
        </div>
      ) : (
        <ul className="max-h-[360px] divide-y divide-slate-100 overflow-y-auto">
          {active.map((b) => (
            <li key={b.deviceId}>
              <Link
                href={`/tracking?focus=${b.deviceId}`}
                className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-slate-50"
              >
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
                  <AlertTriangle className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {b.deviceName ?? b.deviceId.slice(0, 8)}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    Ngoài vùng{" "}
                    <span className="font-medium text-slate-700">
                      {b.geofenceName}
                    </span>
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Cách {formatDistance(b.distanceM)} · {formatTime(b.timestamp)}
                  </p>
                </div>
                <ArrowRight className="mt-2 h-3.5 w-3.5 shrink-0 text-slate-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
