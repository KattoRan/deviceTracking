"use client";

import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  MapPin,
  Search,
  Smartphone,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Device } from "@/types/device";

type StatusFilter = "all" | "online" | "offline";

interface DeviceSidebarProps {
  devices: Device[];
  selectedDevice: Device | null;
  onDeviceSelect: (device: Device) => void;
  loading?: boolean;
  open: boolean;
  onToggle: (open: boolean) => void;
  isMobile?: boolean;
}

const STATUS_LABEL: Record<Device["status"], string> = {
  online: "Trực tuyến",
  offline: "Ngoại tuyến",
};

const STATUS_DOT: Record<Device["status"], string> = {
  online: "bg-emerald-500",
  offline: "bg-slate-400",
};

export default function DeviceSidebar({
  devices,
  selectedDevice,
  onDeviceSelect,
  loading = false,
  open,
  onToggle,
  isMobile = false,
}: DeviceSidebarProps) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const onlineCount = useMemo(
    () => devices.filter((d) => d.status === "online").length,
    [devices],
  );
  const offlineCount = devices.length - onlineCount;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return devices.filter((d) => {
      if (status !== "all" && d.status !== status) return false;
      if (!q) return true;
      return (
        d.name.toLowerCase().includes(q) ||
        d.phone_number.toLowerCase().includes(q) ||
        (d.model?.toLowerCase().includes(q) ?? false) ||
        (d.district?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [devices, search, status]);

  if (!open) {
    if (isMobile) return null;
    return (
      <div className="flex w-12 flex-col items-center gap-3 border-r border-slate-200 bg-white py-4">
        <button
          type="button"
          onClick={() => onToggle(true)}
          title="Mở danh sách thiết bị"
          className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-50">
          <Smartphone className="h-3 w-3 text-blue-600" />
        </div>
        <span className="font-mono text-[10px] text-slate-500">
          {devices.length}
        </span>
      </div>
    );
  }

  const body = (
    <div className="flex h-full w-80 max-w-[85vw] flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-slate-900">Thiết bị</h2>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
              {devices.length}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onToggle(false)}
            title={isMobile ? "Đóng" : "Thu gọn"}
            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            {isMobile ? <X className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm theo tên, sđt, model, khu vực..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-900 placeholder-slate-400 transition-colors focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
        </div>

        <div className="mt-3 flex gap-1">
          <FilterChip
            active={status === "all"}
            onClick={() => setStatus("all")}
            label={`Tất cả (${devices.length})`}
          />
          <FilterChip
            active={status === "online"}
            onClick={() => setStatus("online")}
            label={`Online (${onlineCount})`}
            dot="bg-emerald-500"
          />
          <FilterChip
            active={status === "offline"}
            onClick={() => setStatus("offline")}
            label={`Offline (${offlineCount})`}
            dot="bg-slate-400"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">
            {search || status !== "all"
              ? "Không tìm thấy thiết bị phù hợp"
              : "Chưa có thiết bị"}
          </div>
        ) : (
          filtered.map((device) => (
            <DeviceItem
              key={device.id}
              device={device}
              selected={selectedDevice?.id === device.id}
              onClick={() => onDeviceSelect(device)}
            />
          ))
        )}
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <>
        <div
          className="fixed inset-0 z-[1002] bg-slate-900/40"
          onClick={() => onToggle(false)}
        />
        <div className="fixed bottom-0 left-0 top-0 z-[1003]">{body}</div>
      </>
    );
  }

  return body;
}

function FilterChip({
  active,
  onClick,
  label,
  dot,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  dot?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-blue-200 bg-blue-50 text-blue-700"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />}
      {label}
    </button>
  );
}

function DeviceItem({
  device,
  selected,
  onClick,
}: {
  device: Device;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full border-b border-slate-100 px-4 py-3 text-left transition-colors hover:bg-slate-50",
        selected && "border-l-2 border-l-blue-500 bg-blue-50",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="relative mt-0.5 flex-shrink-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100">
            <Smartphone className="h-4 w-4 text-slate-500" />
          </div>
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white",
              STATUS_DOT[device.status],
            )}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <p className="truncate text-sm font-medium text-slate-900">
              {device.name || device.phone_number}
            </p>
            <span
              className={cn(
                "ml-2 flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                device.status === "online"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-slate-100 text-slate-500",
              )}
            >
              {STATUS_LABEL[device.status]}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {device.model || "--"}
            {device.device_os ? ` · ${device.device_os}` : ""}
          </p>
          {device.district && (
            <p className="mt-1 flex items-center gap-1 truncate text-xs text-slate-500">
              <MapPin className="h-3 w-3 flex-shrink-0" />
              {device.district}
            </p>
          )}
          {device.last_seen && (
            <p className="mt-1 text-[10px] text-slate-400">
              {formatLastSeen(device.last_seen)}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

function formatLastSeen(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Vừa xong";
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.floor(hours / 24)} ngày trước`;
}
