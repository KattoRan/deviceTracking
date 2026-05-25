"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  MapPin,
  Siren,
  X,
} from "lucide-react";
import { API_BASE_URL } from "@/lib/api";
import geofenceService from "@/services/geofenceService";
import { sosService, type SosEvent } from "@/services/sosService";
import { cn } from "@/lib/utils";
import type { GeofenceBreachEvent } from "@/types/geofence";

const RETURNED_DISMISS_MS = 6_000;
let returnedCounter = 0;

interface ReturnedToast extends GeofenceBreachEvent {
  uid: string;
}

interface SosAlertSocketEvent {
  sosEventId: string;
  deviceId: string;
  deviceName: string | null;
  lat: number;
  lon: number;
  accuracy: number | null;
  batteryLevel: number | null;
  triggeredAt: string;
}

interface SosAlertItem {
  sosEventId: string;
  deviceId: string;
  deviceName: string | null;
  lat: number;
  lon: number;
  batteryLevel: number | null;
  triggeredAt: string;
}

type MonitoringAlert =
  | {
      kind: "outside";
      key: string;
      timestamp: string;
      event: GeofenceBreachEvent;
    }
  | {
      kind: "sos";
      key: string;
      timestamp: string;
      sos: SosAlertItem;
    };

interface MonitoringAlertsContextValue {
  outside: GeofenceBreachEvent[];
  sos: SosAlertItem[];
  alerts: MonitoringAlert[];
  returned: ReturnedToast[];
  dismissReturned: (uid: string) => void;
  ackSos: (sosEventId: string) => Promise<void>;
}

const MonitoringAlertsContext =
  createContext<MonitoringAlertsContextValue | null>(null);

/**
 * Bundles every "needs attention" event for the bell:
 *
 *   - `outside` — devices currently outside their safe area. Bootstrapped
 *     from /breaches/active so any page load reflects the current truth,
 *     kept up to date by `geofence_breach` socket events. One row per
 *     device (the backend already collapses multi-zone state into a single
 *     device-level breach).
 *
 *   - `sos` — unacknowledged SOS events. Bootstrapped from /api/v1/sos
 *     (filtered to unacked), kept up to date by `sos_alert` socket events
 *     and the local `ackSos()` action.
 *
 *   - `returned` — short-lived confirmations that a device came back to a
 *     zone. Auto-dismisses after ~6s.
 *
 * Rendering is split: <GeofenceBell> shows the combined live list as a
 * dropdown; <GeofenceReturnedToasts> shows the ephemeral confirmations.
 */
export function GeofenceAlertsProvider({ children }: { children: ReactNode }) {
  const [activeMap, setActiveMap] = useState<
    Map<string, GeofenceBreachEvent>
  >(() => new Map());
  const [sosMap, setSosMap] = useState<Map<string, SosAlertItem>>(
    () => new Map(),
  );
  const [returned, setReturned] = useState<ReturnedToast[]>([]);

  const dismissReturned = useCallback((uid: string) => {
    setReturned((prev) => prev.filter((t) => t.uid !== uid));
  }, []);

  const ackSos = useCallback(async (sosEventId: string) => {
    setSosMap((prev) => {
      if (!prev.has(sosEventId)) return prev;
      const next = new Map(prev);
      next.delete(sosEventId);
      return next;
    });
    try {
      await sosService.acknowledge(sosEventId);
    } catch {
      // Non-fatal — server-side ack is for receipt tracking; the local list
      // is already updated optimistically.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    geofenceService
      .listActiveBreaches()
      .then((list) => {
        if (cancelled) return;
        const next = new Map<string, GeofenceBreachEvent>();
        for (const ev of list) next.set(ev.deviceId, ev);
        setActiveMap(next);
      })
      .catch(() => {
        // Non-fatal — socket events will still populate the list as they fire.
      });
    sosService
      .list(50)
      .then((list) => {
        if (cancelled) return;
        const next = new Map<string, SosAlertItem>();
        for (const e of list) {
          if (e.acknowledgedAt) continue;
          next.set(e.id, sosEventToItem(e));
        }
        setSosMap(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const socket: Socket = io(API_BASE_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
    });

    socket.on("geofence_breach", (event: GeofenceBreachEvent) => {
      if (event.status === "outside") {
        setActiveMap((prev) => {
          const next = new Map(prev);
          next.set(event.deviceId, event);
          return next;
        });
      } else {
        setActiveMap((prev) => {
          if (!prev.has(event.deviceId)) return prev;
          const next = new Map(prev);
          next.delete(event.deviceId);
          return next;
        });
        const uid = `${Date.now()}-${++returnedCounter}`;
        setReturned((prev) => [...prev, { ...event, uid }]);
        window.setTimeout(() => dismissReturned(uid), RETURNED_DISMISS_MS);
      }
    });

    socket.on("sos_alert", (event: SosAlertSocketEvent) => {
      setSosMap((prev) => {
        const next = new Map(prev);
        next.set(event.sosEventId, {
          sosEventId: event.sosEventId,
          deviceId: event.deviceId,
          deviceName: event.deviceName,
          lat: event.lat,
          lon: event.lon,
          batteryLevel: event.batteryLevel,
          triggeredAt: event.triggeredAt,
        });
        return next;
      });
    });

    return () => {
      socket.off("geofence_breach");
      socket.off("sos_alert");
      socket.disconnect();
    };
  }, [dismissReturned]);

  const outside = useMemo(
    () =>
      Array.from(activeMap.values()).sort(
        (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
      ),
    [activeMap],
  );

  const sos = useMemo(
    () =>
      Array.from(sosMap.values()).sort(
        (a, b) => Date.parse(b.triggeredAt) - Date.parse(a.triggeredAt),
      ),
    [sosMap],
  );

  const alerts = useMemo<MonitoringAlert[]>(() => {
    const combined: MonitoringAlert[] = [
      ...sos.map<MonitoringAlert>((s) => ({
        kind: "sos",
        key: `sos:${s.sosEventId}`,
        timestamp: s.triggeredAt,
        sos: s,
      })),
      ...outside.map<MonitoringAlert>((e) => ({
        kind: "outside",
        key: `outside:${e.deviceId}:${e.geofenceId}`,
        timestamp: e.timestamp,
        event: e,
      })),
    ];
    combined.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    return combined;
  }, [outside, sos]);

  const value = useMemo<MonitoringAlertsContextValue>(
    () => ({ outside, sos, alerts, returned, dismissReturned, ackSos }),
    [outside, sos, alerts, returned, dismissReturned, ackSos],
  );

  return (
    <MonitoringAlertsContext.Provider value={value}>
      {children}
    </MonitoringAlertsContext.Provider>
  );
}

function sosEventToItem(e: SosEvent): SosAlertItem {
  return {
    sosEventId: e.id,
    deviceId: e.deviceId,
    deviceName: e.personName,
    lat: e.lat,
    lon: e.lon,
    batteryLevel: e.batteryLevel,
    triggeredAt: e.triggeredAt,
  };
}

export function useGeofenceAlerts(): MonitoringAlertsContextValue {
  const ctx = useContext(MonitoringAlertsContext);
  if (!ctx) {
    throw new Error(
      "GeofenceBell / GeofenceReturnedToasts must be inside <GeofenceAlertsProvider>",
    );
  }
  return ctx;
}

export function GeofenceBell({ className }: { className?: string }) {
  const router = useRouter();
  const { alerts, ackSos } = useGeofenceAlerts();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
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

  const count = alerts.length;
  const hasAlert = count > 0;
  const sosCount = alerts.filter((a) => a.kind === "sos").length;
  const outsideCount = count - sosCount;

  function handleSelectOutside(deviceId: string) {
    setOpen(false);
    router.push(`/tracking?focus=${encodeURIComponent(deviceId)}`);
  }

  function handleSelectSos(item: SosAlertItem) {
    setOpen(false);
    router.push(
      `/tracking?focus=${encodeURIComponent(item.deviceId)}&sos=${encodeURIComponent(item.sosEventId)}`,
    );
    void ackSos(item.sosEventId);
  }

  return (
    <div ref={wrapperRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          hasAlert
            ? `Có ${count} cảnh báo giám sát`
            : "Cảnh báo giám sát"
        }
        aria-expanded={open}
        title={
          hasAlert ? `${count} cảnh báo đang chờ xử lý` : "Không có cảnh báo"
        }
        className={cn(
          "relative flex h-9 w-9 items-center justify-center rounded-lg border transition-colors",
          hasAlert
            ? "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
        )}
      >
        <Bell
          className={cn("h-4 w-4", hasAlert && "animate-[wiggle_1s_ease-in-out_infinite]")}
        />
        {hasAlert && (
          <>
            <span className="absolute right-1.5 top-1.5 inline-flex h-2 w-2 animate-ping rounded-full bg-red-400" />
            <span className="absolute -right-1 -top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-[18px] text-white">
              {count > 9 ? "9+" : count}
            </span>
          </>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-[1100] mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <header className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
            <div className="text-sm font-semibold text-slate-900">
              Cảnh báo giám sát
            </div>
            <div className="flex items-center gap-1.5">
              {sosCount > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
                  SOS {sosCount}
                </span>
              )}
              {outsideCount > 0 && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  Ra khỏi vùng {outsideCount}
                </span>
              )}
              {count === 0 && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  Bình thường
                </span>
              )}
            </div>
          </header>

          <div className="max-h-[60vh] overflow-y-auto">
            {alerts.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
                Tất cả thiết bị đang an toàn.
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {alerts.map((a) =>
                  a.kind === "sos" ? (
                    <li key={a.key}>
                      <button
                        type="button"
                        onClick={() => handleSelectSos(a.sos)}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-red-50"
                      >
                        <Siren className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                              SOS
                            </span>
                            <span className="truncate text-sm font-medium text-slate-900">
                              {a.sos.deviceName ?? a.sos.deviceId.slice(0, 8)}
                            </span>
                          </div>
                          <div className="mt-0.5 truncate text-xs text-slate-600">
                            Cảnh báo SOS từ người được giám sát
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            {a.sos.batteryLevel != null && `Pin ${a.sos.batteryLevel}% · `}
                            {new Date(a.sos.triggeredAt).toLocaleTimeString("vi-VN")}
                          </div>
                        </div>
                        <MapPin className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400" />
                      </button>
                    </li>
                  ) : (
                    <li key={a.key}>
                      <button
                        type="button"
                        onClick={() => handleSelectOutside(a.event.deviceId)}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-amber-50"
                      >
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                              Ra khỏi vùng
                            </span>
                            <span className="truncate text-sm font-medium text-slate-900">
                              {a.event.deviceName ?? a.event.deviceId.slice(0, 8)}
                            </span>
                          </div>
                          <div className="mt-0.5 truncate text-xs text-slate-600">
                            Vùng gần nhất{" "}
                            <span className="font-medium">{a.event.geofenceName}</span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            Cách tâm {a.event.distanceM}m / bán kính{" "}
                            {a.event.radiusM}m ·{" "}
                            {new Date(a.event.timestamp).toLocaleTimeString("vi-VN")}
                          </div>
                        </div>
                        <MapPin className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400" />
                      </button>
                    </li>
                  ),
                )}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function GeofenceReturnedToasts() {
  const { returned, dismissReturned } = useGeofenceAlerts();

  if (returned.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[1000] flex max-w-sm flex-col gap-2">
      {returned.map((t) => (
        <div
          key={t.uid}
          role="status"
          className="pointer-events-auto flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/95 px-4 py-3 text-emerald-900 shadow-lg backdrop-blur"
        >
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-semibold">
              Thiết bị đã trở về vùng giám sát
            </div>
            <div className="mt-0.5 text-[13px]">
              {t.deviceName ?? t.deviceId.slice(0, 8)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => dismissReturned(t.uid)}
            aria-label="Đóng"
            className="text-slate-400 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
