"use client";

import { formatDistanceToNow } from "@/lib/utils";
import { API_BASE_URL } from "@/lib/api";
import {
  Battery,
  CheckCircle2,
  Loader2,
  MapPin,
  Siren,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import { sosService, type SosEvent } from "@/services/sosService";

export default function SosHistoryPage() {
  const [events, setEvents] = useState<SosEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acking, setAcking] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await sosService.list();
      setEvents(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi tải dữ liệu");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Realtime: subscribe sos_alert qua socket → refresh list. Server emit
  // toàn cục; refresh() filter qua API (đã scope theo parentAccountId).
  useEffect(() => {
    const socket = io(API_BASE_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
    });
    socket.on("sos_alert", () => {
      void refresh();
    });
    return () => {
      socket.off("sos_alert");
      socket.disconnect();
    };
  }, [refresh]);

  async function handleAck(id: string) {
    if (acking) return;
    setAcking(id);
    try {
      await sosService.acknowledge(id);
      setEvents((prev) =>
        prev.map((e) =>
          e.id === id ? { ...e, acknowledgedAt: new Date().toISOString() } : e,
        ),
      );
    } catch (err) {
      console.error(err);
    } finally {
      setAcking(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100">
          <Siren className="h-5 w-5 text-red-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Lịch sử SOS
          </h1>
          <p className="text-sm text-slate-600">
            Cảnh báo khẩn cấp từ người được giám sát
          </p>
        </div>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Đang tải…
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
          <Siren className="mx-auto h-12 w-12 text-slate-300" />
          <p className="mt-4 text-sm text-slate-600">
            Chưa có cảnh báo SOS nào.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {events.map((e) => {
            const isUnacked = !e.acknowledgedAt;
            return (
              <li
                key={e.id}
                className={`rounded-xl border p-4 shadow-sm transition-colors ${
                  isUnacked
                    ? "border-red-200 bg-red-50"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">
                        {e.personType === "CHILD" ? "👶" : "👴"}
                      </span>
                      <p className="truncate text-base font-semibold text-slate-900">
                        {e.personName}
                      </p>
                      {isUnacked && (
                        <span className="inline-flex items-center rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                          Mới
                        </span>
                      )}
                    </div>

                    <p className="mt-1 text-sm text-slate-600">
                      {formatDistanceToNow(new Date(e.triggeredAt))} ·{" "}
                      {new Date(e.triggeredAt).toLocaleString("vi-VN")}
                    </p>

                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                      <span className="inline-flex items-center gap-1 font-mono">
                        <MapPin className="h-3.5 w-3.5" />
                        {e.lat.toFixed(5)}, {e.lon.toFixed(5)}
                        {e.accuracy != null && ` (±${Math.round(e.accuracy)}m)`}
                      </span>
                      {e.batteryLevel != null && (
                        <span className="inline-flex items-center gap-1">
                          <Battery className="h-3.5 w-3.5" />
                          {e.batteryLevel}%
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <Link
                      href={`/tracking?focus=${e.deviceId}`}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                    >
                      Xem trên bản đồ
                    </Link>
                    {isUnacked ? (
                      <button
                        type="button"
                        onClick={() => handleAck(e.id)}
                        disabled={acking === e.id}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Đã xử lý
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Đã xử lý{" "}
                        {formatDistanceToNow(new Date(e.acknowledgedAt!))}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
