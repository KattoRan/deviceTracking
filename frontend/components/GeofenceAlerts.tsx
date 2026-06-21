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
  Battery,
  Bell,
  CheckCircle2,
  MapPin,
  Siren,
  WifiOff,
  X,
} from "lucide-react";
import { API_BASE_URL } from "@/lib/api";
import geofenceService from "@/services/geofenceService";
import { sosService, type SosEvent } from "@/services/sosService";
import { cn } from "@/lib/utils";
import type { GeofenceBreachEvent } from "@/types/geofence";
import type { DeviceMovedEvent } from "@/types/device";

type DeviceMovedHandler = (event: DeviceMovedEvent) => void;

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

interface LowBatterySocketEvent {
  deviceId: string;
  deviceName: string | null;
  batteryLevel: number;
  timestamp: string;
}

interface BatteryUpdateSocketEvent {
  deviceId: string;
  batteryLevel: number;
  timestamp: string;
}

interface OfflineSocketEvent {
  deviceId: string;
  deviceName: string | null;
  lastSeen: string | null;
  timestamp: string;
}

// Hysteresis ngưỡng disarm phải khớp BE: ingest.service LOW_BATTERY_RESET_THRESHOLD=25.
const LOW_BATTERY_CLEAR_AT = 25;

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
    }
  | {
      kind: "lowBattery";
      key: string;
      timestamp: string;
      item: LowBatterySocketEvent;
    }
  | {
      kind: "offline";
      key: string;
      timestamp: string;
      item: OfflineSocketEvent;
    };

interface MonitoringAlertsContextValue {
  outside: GeofenceBreachEvent[];
  sos: SosAlertItem[];
  lowBattery: LowBatterySocketEvent[];
  offline: OfflineSocketEvent[];
  alerts: MonitoringAlert[];
  returned: ReturnedToast[];
  dismissReturned: (uid: string) => void;
  ackSos: (sosEventId: string) => Promise<void>;
  /** Đánh dấu tất cả SOS chưa xử lý là đã xử lý — badge count về 0 tức thì. */
  ackAllSos: () => Promise<void>;
  dismissLowBattery: (deviceId: string) => void;
  dismissOffline: (deviceId: string) => void;
  /**
   * Đăng ký lắng nghe device_moved trên socket dùng chung của provider.
   * Trả về hàm gỡ đăng ký. Caller chịu trách nhiệm gọi nó trong cleanup.
   */
  subscribeDeviceMoved: (handler: DeviceMovedHandler) => () => void;
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
  const [lowBatteryMap, setLowBatteryMap] = useState<
    Map<string, LowBatterySocketEvent>
  >(() => new Map());
  const [offlineMap, setOfflineMap] = useState<Map<string, OfflineSocketEvent>>(
    () => new Map(),
  );
  const [returned, setReturned] = useState<ReturnedToast[]>([]);
  const deviceMovedHandlersRef = useRef<Set<DeviceMovedHandler>>(new Set());

  const subscribeDeviceMoved = useCallback(
    (handler: DeviceMovedHandler) => {
      deviceMovedHandlersRef.current.add(handler);
      return () => {
        deviceMovedHandlersRef.current.delete(handler);
      };
    },
    [],
  );

  const dismissReturned = useCallback((uid: string) => {
    setReturned((prev) => prev.filter((t) => t.uid !== uid));
  }, []);

  const dismissLowBattery = useCallback((deviceId: string) => {
    setLowBatteryMap((prev) => {
      if (!prev.has(deviceId)) return prev;
      const next = new Map(prev);
      next.delete(deviceId);
      return next;
    });
  }, []);

  const dismissOffline = useCallback((deviceId: string) => {
    setOfflineMap((prev) => {
      if (!prev.has(deviceId)) return prev;
      const next = new Map(prev);
      next.delete(deviceId);
      return next;
    });
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

  const ackAllSos = useCallback(async () => {
    // Optimistic — clear local map ngay để badge về 0, server sẽ ack đồng loạt.
    setSosMap((prev) => (prev.size === 0 ? prev : new Map()));
    try {
      await sosService.acknowledgeAll();
    } catch {
      // Non-fatal — nếu fail, lần load trang SOS kế tiếp sẽ re-fetch và
      // populate lại sosMap từ API.
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
      query: { clientType: "web" },
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

    socket.on("low_battery", (event: LowBatterySocketEvent) => {
      setLowBatteryMap((prev) => {
        const next = new Map(prev);
        next.set(event.deviceId, event);
        return next;
      });
    });

    socket.on("device_offline", (event: OfflineSocketEvent) => {
      setOfflineMap((prev) => {
        const next = new Map(prev);
        next.set(event.deviceId, event);
        return next;
      });
    });

    // Auto-clear: pin sạc lại ≥25 → BE silently flip flag, FE tự dọn cảnh báo
    // tương ứng. Ngưỡng khớp với BE LOW_BATTERY_RESET_THRESHOLD.
    socket.on("battery_update", (event: BatteryUpdateSocketEvent) => {
      if (event.batteryLevel < LOW_BATTERY_CLEAR_AT) return;
      setLowBatteryMap((prev) => {
        if (!prev.has(event.deviceId)) return prev;
        const next = new Map(prev);
        next.delete(event.deviceId);
        return next;
      });
    });

    // Auto-clear: device online lại → ingest gửi `device_moved`, dọn offline.
    // Đồng thời dispatch cho các subscriber bên ngoài (vd trang tracking dùng
    // event này để cập nhật toạ độ marker), để 1 socket phục vụ nhiều consumer.
    socket.on("device_moved", (event: DeviceMovedEvent) => {
      setOfflineMap((prev) => {
        if (!prev.has(event.deviceId)) return prev;
        const next = new Map(prev);
        next.delete(event.deviceId);
        return next;
      });
      for (const h of deviceMovedHandlersRef.current) h(event);
    });

    return () => {
      socket.off("geofence_breach");
      socket.off("sos_alert");
      socket.off("low_battery");
      socket.off("device_offline");
      socket.off("battery_update");
      socket.off("device_moved");
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

  const lowBattery = useMemo(
    () =>
      Array.from(lowBatteryMap.values()).sort(
        (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
      ),
    [lowBatteryMap],
  );

  const offline = useMemo(
    () =>
      Array.from(offlineMap.values()).sort(
        (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
      ),
    [offlineMap],
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
      ...lowBattery.map<MonitoringAlert>((e) => ({
        kind: "lowBattery",
        key: `lowBattery:${e.deviceId}`,
        timestamp: e.timestamp,
        item: e,
      })),
      ...offline.map<MonitoringAlert>((e) => ({
        kind: "offline",
        key: `offline:${e.deviceId}`,
        timestamp: e.timestamp,
        item: e,
      })),
    ];
    combined.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    return combined;
  }, [outside, sos, lowBattery, offline]);

  const value = useMemo<MonitoringAlertsContextValue>(
    () => ({
      outside,
      sos,
      lowBattery,
      offline,
      alerts,
      returned,
      dismissReturned,
      ackSos,
      ackAllSos,
      dismissLowBattery,
      dismissOffline,
      subscribeDeviceMoved,
    }),
    [
      outside,
      sos,
      lowBattery,
      offline,
      alerts,
      returned,
      dismissReturned,
      ackSos,
      ackAllSos,
      dismissLowBattery,
      dismissOffline,
      subscribeDeviceMoved,
    ],
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
    deviceName: e.ownerName,
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
  const { alerts, ackSos, dismissLowBattery, dismissOffline } =
    useGeofenceAlerts();
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
  const outsideCount = alerts.filter((a) => a.kind === "outside").length;
  const lowBatteryCount = alerts.filter((a) => a.kind === "lowBattery").length;
  const offlineCount = alerts.filter((a) => a.kind === "offline").length;

  function focusDevice(deviceId: string) {
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
              {lowBatteryCount > 0 && (
                <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-700">
                  Pin yếu {lowBatteryCount}
                </span>
              )}
              {offlineCount > 0 && (
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                  Mất kết nối {offlineCount}
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
                {alerts.map((a) => {
                  if (a.kind === "sos") {
                    return (
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
                              {a.sos.batteryLevel != null &&
                                `Pin ${a.sos.batteryLevel}% · `}
                              {new Date(a.sos.triggeredAt).toLocaleTimeString(
                                "vi-VN",
                              )}
                            </div>
                          </div>
                          <MapPin className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400" />
                        </button>
                      </li>
                    );
                  }

                  if (a.kind === "outside") {
                    return (
                      <li key={a.key}>
                        <button
                          type="button"
                          onClick={() => focusDevice(a.event.deviceId)}
                          className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-amber-50"
                        >
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                                Ra khỏi vùng
                              </span>
                              <span className="truncate text-sm font-medium text-slate-900">
                                {a.event.deviceName ??
                                  a.event.deviceId.slice(0, 8)}
                              </span>
                            </div>
                            <div className="mt-0.5 truncate text-xs text-slate-600">
                              Vùng gần nhất{" "}
                              <span className="font-medium">
                                {a.event.geofenceName}
                              </span>
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-500">
                              Cách tâm {a.event.distanceM}m / bán kính{" "}
                              {a.event.radiusM}m ·{" "}
                              {new Date(a.event.timestamp).toLocaleTimeString(
                                "vi-VN",
                              )}
                            </div>
                          </div>
                          <MapPin className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400" />
                        </button>
                      </li>
                    );
                  }

                  if (a.kind === "lowBattery") {
                    return (
                      <li
                        key={a.key}
                        className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-orange-50"
                      >
                        <Battery className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => focusDevice(a.item.deviceId)}
                            className="block w-full text-left"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="rounded bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                                Pin yếu
                              </span>
                              <span className="truncate text-sm font-medium text-slate-900">
                                {a.item.deviceName ??
                                  a.item.deviceId.slice(0, 8)}
                              </span>
                            </div>
                            <div className="mt-0.5 text-xs text-slate-600">
                              Còn{" "}
                              <span className="font-semibold text-orange-700">
                                {a.item.batteryLevel}%
                              </span>{" "}
                              pin — hãy nhắc sạc.
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-500">
                              {new Date(a.item.timestamp).toLocaleTimeString(
                                "vi-VN",
                              )}
                            </div>
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => dismissLowBattery(a.item.deviceId)}
                          aria-label="Bỏ qua"
                          className="mt-0.5 text-slate-400 hover:text-slate-700"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  }

                  // a.kind === "offline"
                  return (
                    <li
                      key={a.key}
                      className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-slate-100"
                    >
                      <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => focusDevice(a.item.deviceId)}
                          className="block w-full text-left"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="rounded bg-slate-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                              Mất kết nối
                            </span>
                            <span className="truncate text-sm font-medium text-slate-900">
                              {a.item.deviceName ??
                                a.item.deviceId.slice(0, 8)}
                            </span>
                          </div>
                          <div className="mt-0.5 text-xs text-slate-600">
                            Không gửi tín hiệu hơn 5 phút.
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            {a.item.lastSeen
                              ? `Lần cuối ${new Date(a.item.lastSeen).toLocaleTimeString("vi-VN")}`
                              : `Phát hiện ${new Date(a.item.timestamp).toLocaleTimeString("vi-VN")}`}
                          </div>
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => dismissOffline(a.item.deviceId)}
                        aria-label="Bỏ qua"
                        className="mt-0.5 text-slate-400 hover:text-slate-700"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  );
                })}
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
