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
  X,
} from "lucide-react";
import { API_BASE_URL } from "@/lib/api";
import geofenceService from "@/services/geofenceService";
import { cn } from "@/lib/utils";
import type { GeofenceBreachEvent } from "@/types/geofence";

const RETURNED_DISMISS_MS = 6_000;
let returnedCounter = 0;

interface ReturnedToast extends GeofenceBreachEvent {
  uid: string;
}

interface GeofenceAlertsContextValue {
  active: GeofenceBreachEvent[];
  returned: ReturnedToast[];
  dismissReturned: (uid: string) => void;
}

const GeofenceAlertsContext =
  createContext<GeofenceAlertsContextValue | null>(null);

/**
 * Manages two lists, exposed to consumer components via context:
 *
 *   - `active` — devices currently outside their zone. Bootstrapped from
 *     /breaches/active so any page load reflects the current truth, kept up
 *     to date by socket events. Persistent until the device returns.
 *
 *   - `returned` — short-lived confirmations that auto-dismiss; useful for
 *     acknowledging that a violation resolved without leaving a banner.
 *
 * Rendering is split: <GeofenceBell> shows the active list as a notification
 * dropdown, <GeofenceReturnedToasts> shows the ephemeral confirmations.
 * Splitting keeps the bell free of layout concerns so it can be embedded
 * inside the nav OR positioned floating on /tracking.
 */
export function GeofenceAlertsProvider({ children }: { children: ReactNode }) {
  const [activeMap, setActiveMap] = useState<
    Map<string, GeofenceBreachEvent>
  >(() => new Map());
  const [returned, setReturned] = useState<ReturnedToast[]>([]);

  const dismissReturned = useCallback((uid: string) => {
    setReturned((prev) => prev.filter((t) => t.uid !== uid));
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

    return () => {
      socket.off("geofence_breach");
      socket.disconnect();
    };
  }, [dismissReturned]);

  const active = useMemo(
    () =>
      Array.from(activeMap.values()).sort(
        (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
      ),
    [activeMap],
  );

  const value = useMemo<GeofenceAlertsContextValue>(
    () => ({ active, returned, dismissReturned }),
    [active, returned, dismissReturned],
  );

  return (
    <GeofenceAlertsContext.Provider value={value}>
      {children}
    </GeofenceAlertsContext.Provider>
  );
}

function useGeofenceAlerts(): GeofenceAlertsContextValue {
  const ctx = useContext(GeofenceAlertsContext);
  if (!ctx) {
    throw new Error(
      "GeofenceBell / GeofenceReturnedToasts must be inside <GeofenceAlertsProvider>",
    );
  }
  return ctx;
}

export function GeofenceBell({ className }: { className?: string }) {
  const router = useRouter();
  const { active } = useGeofenceAlerts();
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

  const count = active.length;
  const hasAlert = count > 0;

  function handleSelect(deviceId: string) {
    setOpen(false);
    router.push(`/tracking?focus=${encodeURIComponent(deviceId)}`);
  }

  return (
    <div ref={wrapperRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          hasAlert
            ? `Có ${count} thiết bị đang vi phạm vùng an toàn`
            : "Cảnh báo vùng an toàn"
        }
        aria-expanded={open}
        title={
          hasAlert
            ? `${count} thiết bị đang vi phạm`
            : "Không có cảnh báo"
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
              Cảnh báo vùng an toàn
            </div>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                hasAlert
                  ? "bg-red-100 text-red-700"
                  : "bg-slate-100 text-slate-600",
              )}
            >
              {count} đang vi phạm
            </span>
          </header>

          <div className="max-h-[60vh] overflow-y-auto">
            {active.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
                Tất cả thiết bị đang trong vùng an toàn.
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {active.map((t) => (
                  <li key={t.deviceId}>
                    <button
                      type="button"
                      onClick={() => handleSelect(t.deviceId)}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-red-50"
                    >
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-900">
                          {t.deviceName ?? t.deviceId.slice(0, 8)}
                        </div>
                        <div className="truncate text-xs text-slate-600">
                          Vùng{" "}
                          <span className="font-medium">{t.geofenceName}</span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          Cách tâm {t.distanceM}m / bán kính {t.radiusM}m ·{" "}
                          {new Date(t.timestamp).toLocaleTimeString("vi-VN")}
                        </div>
                      </div>
                      <MapPin className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400" />
                    </button>
                  </li>
                ))}
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
              Thiết bị đã trở về vùng an toàn
            </div>
            <div className="mt-0.5 text-[13px]">
              {t.deviceName ?? t.deviceId.slice(0, 8)} · vùng{" "}
              <span className="font-medium">{t.geofenceName}</span>
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
