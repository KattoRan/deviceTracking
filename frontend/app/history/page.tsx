"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import {
  Calendar,
  ChevronDown,
  Clock,
  Gauge,
  MapPin,
  Route,
  Search,
} from "lucide-react";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatDistance, formatDuration } from "@/lib/utils";
import deviceService from "@/services/deviceService";
import type { Device, LocationHistory } from "@/types/device";

const HistoryMap = dynamic(() => import("@/components/history/HistoryMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-slate-100">
      <div className="text-sm text-slate-500">Đang tải bản đồ...</div>
    </div>
  ),
});

function toLocalDatetimeStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export default function HistoryPage() {
  return (
    <Suspense fallback={null}>
      <HistoryPageInner />
    </Suspense>
  );
}

function HistoryPageInner() {
  const searchParams = useSearchParams();
  const initialDeviceId = searchParams.get("deviceId") ?? "";

  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] =
    useState<string>(initialDeviceId);
  const [deviceSearch, setDeviceSearch] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return toLocalDatetimeStr(d);
  });
  const [toDate, setToDate] = useState(() => toLocalDatetimeStr(new Date()));

  const [history, setHistory] = useState<LocationHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mapSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    deviceService
      .getAll()
      .then((data) => {
        if (!cancelled) setDevices(data);
      })
      .catch(() => {
        if (!cancelled) setError("Không tải được danh sách thiết bị");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSearch = useCallback(async () => {
    if (!selectedDeviceId) {
      setError("Vui lòng chọn thiết bị");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await deviceService.getHistory(
        selectedDeviceId,
        new Date(fromDate).toISOString(),
        new Date(toDate).toISOString(),
      );
      setHistory(data);
      if (data.points.length === 0) {
        setError("Không có dữ liệu trong khoảng thời gian này");
      } else {
        // Scroll the map into view so the user lands on the result without
        // having to scroll the long form section above it.
        requestAnimationFrame(() => {
          mapSectionRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        });
      }
    } catch (err) {
      setError("Lỗi tải dữ liệu lịch sử");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedDeviceId, fromDate, toDate]);

  // Auto-fetch when arriving via deep-link (?deviceId=...) so the user lands on a populated map.
  const autoFetched = useRef(false);
  useEffect(() => {
    if (autoFetched.current) return;
    if (initialDeviceId && devices.some((d) => d.id === initialDeviceId)) {
      autoFetched.current = true;
      void handleSearch();
    }
  }, [initialDeviceId, devices, handleSearch]);

  const setPreset = (hours: number) => {
    const now = new Date();
    const from = new Date(now.getTime() - hours * 3_600_000);
    setFromDate(toLocalDatetimeStr(from));
    setToDate(toLocalDatetimeStr(now));
  };

  const setPresetToday = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    setFromDate(toLocalDatetimeStr(start));
    setToDate(toLocalDatetimeStr(now));
  };

  const filteredDevices = useMemo(() => {
    const q = deviceSearch.toLowerCase();
    return devices.filter(
      (d) =>
        (d.owner_name?.toLowerCase() || "").includes(q) ||
        (d.phone_number?.includes(q) ?? false) ||
        (d.model?.toLowerCase() || "").includes(q),
    );
  }, [devices, deviceSearch]);

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);
  const points = history?.points ?? [];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">
            Lịch sử di chuyển
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Xem lại lộ trình di chuyển của thiết bị theo thời gian
          </p>
        </div>

        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-12">
            <div className="md:col-span-4" ref={dropdownRef}>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">
                Thiết bị
              </label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setDropdownOpen((v) => !v)}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm transition-colors hover:border-slate-300"
                >
                  <span
                    className={
                      selectedDevice ? "text-slate-900" : "text-slate-400"
                    }
                  >
                    {selectedDevice
                      ? selectedDevice.phone_number
                        ? `${selectedDevice.owner_name || selectedDevice.phone_number} — ${selectedDevice.phone_number}`
                        : selectedDevice.owner_name || selectedDevice.id.slice(0, 8)
                      : "Chọn thiết bị..."}
                  </span>
                  <ChevronDown className="h-4 w-4 text-slate-400" />
                </button>

                {dropdownOpen && (
                  <div className="absolute left-0 right-0 top-full z-[1000] mt-1 max-h-64 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
                    <div className="border-b border-slate-100 p-2">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          placeholder="Tìm thiết bị..."
                          value={deviceSearch}
                          onChange={(e) => setDeviceSearch(e.target.value)}
                          className="w-full rounded-md border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none"
                          autoFocus
                        />
                      </div>
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {filteredDevices.length === 0 ? (
                        <div className="px-3 py-4 text-center text-sm text-slate-500">
                          Không tìm thấy thiết bị
                        </div>
                      ) : (
                        filteredDevices.map((d) => (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => {
                              setSelectedDeviceId(d.id);
                              setDropdownOpen(false);
                              setDeviceSearch("");
                            }}
                            className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-slate-50 ${
                              d.id === selectedDeviceId
                                ? "bg-emerald-50 text-emerald-700"
                                : "text-slate-700"
                            }`}
                          >
                            <div
                              className={`h-2 w-2 flex-shrink-0 rounded-full ${
                                d.status === "online"
                                  ? "bg-emerald-500"
                                  : "bg-slate-400"
                              }`}
                            />
                            <div className="min-w-0">
                              <div className="truncate font-medium">
                                {d.owner_name || d.phone_number || d.id.slice(0, 8)}
                              </div>
                              <div className="truncate text-xs text-slate-500">
                                {[d.phone_number, d.model || "Unknown"]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </div>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="md:col-span-3">
              <label className="mb-1.5 block text-xs font-medium text-slate-600">
                Từ
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="datetime-local"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                />
              </div>
            </div>

            <div className="md:col-span-3">
              <label className="mb-1.5 block text-xs font-medium text-slate-600">
                Đến
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="datetime-local"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                />
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="invisible mb-1.5 block text-xs text-slate-600">
                _
              </label>
              <button
                type="button"
                onClick={handleSearch}
                disabled={loading || !selectedDeviceId}
                className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400"
              >
                {loading ? "Đang tải..." : "Xem lịch sử"}
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <span className="py-1 text-xs text-slate-500">Nhanh:</span>
            {[
              { label: "1 giờ", hours: 1 },
              { label: "3 giờ", hours: 3 },
              { label: "6 giờ", hours: 6 },
              { label: "12 giờ", hours: 12 },
              { label: "24 giờ", hours: 24 },
            ].map((p) => (
              <button
                key={p.hours}
                type="button"
                onClick={() => setPreset(p.hours)}
                className="rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900"
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              onClick={setPresetToday}
              className="rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900"
            >
              Hôm nay
            </button>
          </div>

        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {history && points.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-3">
            <StatBadge
              icon={<MapPin className="h-3.5 w-3.5" />}
              label="Điểm"
              value={String(history.total)}
            />
            <StatBadge
              icon={<Route className="h-3.5 w-3.5" />}
              label="Quãng đường"
              value={formatDistance(history.distance_total_m)}
            />
            <StatBadge
              icon={<Clock className="h-3.5 w-3.5" />}
              label="Thời lượng"
              value={formatDuration(history.duration_ms)}
            />
            <StatBadge
              icon={<Gauge className="h-3.5 w-3.5" />}
              label="Vận tốc TB"
              value={`${history.avg_speed_kmh.toFixed(1)} km/h`}
            />
            <StatBadge
              icon={<Clock className="h-3.5 w-3.5" />}
              label="Bắt đầu"
              value={new Date(points[0].time).toLocaleTimeString("vi-VN")}
            />
            <StatBadge
              icon={<Clock className="h-3.5 w-3.5" />}
              label="Kết thúc"
              value={new Date(
                points[points.length - 1].time,
              ).toLocaleTimeString("vi-VN")}
            />
          </div>
        )}

        <div
          ref={mapSectionRef}
          className="flex h-[calc(100vh-3.5rem)] scroll-mt-14 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
        >
          <div className="min-h-0 flex-1">
            <HistoryMap points={points} />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBadge({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs shadow-sm">
      <span className="text-emerald-600">{icon}</span>
      <span className="text-slate-500">{label}:</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}
