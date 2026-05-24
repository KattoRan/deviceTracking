"use client";

import {
  Bell,
  Check,
  Loader2,
  Lock,
  LockOpen,
  MapPin,
  Power,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import commandService from "@/services/commandService";
import deviceService from "@/services/deviceService";
import type {
  CommandName,
  CommandPayload,
  CommandRow,
  CommandStatus,
  CommandStatusChangedEvent,
} from "@/types/command";
import { useCommandSocket } from "@/hooks/useCommandSocket";

interface RemoteControlPanelProps {
  deviceId: string;
  isLocked?: boolean;
  onLockChange?: (locked: boolean) => void;
}

interface ActiveCommand {
  commandId: string;
  command: CommandName;
  status: CommandStatus;
  error: string | null;
  at: number;
}

const STATUS_LABEL: Record<CommandStatus, string> = {
  pending: "Đang chờ",
  delivered: "Đã nhận",
  executed: "Thành công",
  failed: "Thất bại",
};

const STATUS_COLOR: Record<CommandStatus, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  delivered: "bg-blue-50 text-blue-700 border-blue-200",
  executed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-red-50 text-red-700 border-red-200",
};

const COMMAND_LABEL: Record<CommandName, string> = {
  request_location_now: "Cập nhật vị trí ngay",
  ring_alarm: "Kêu chuông",
  toggle_tracking: "Bật/tắt tracking",
  lock_device: "Khóa thiết bị",
};

export default function RemoteControlPanel({ deviceId, isLocked, onLockChange }: RemoteControlPanelProps) {
  const [active, setActive] = useState<ActiveCommand | null>(null);
  const [history, setHistory] = useState<CommandRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [lockLoading, setLockLoading] = useState(false);

  // `toggle_tracking` needs both enable/disable — we keep a local hint toggled
  // each time the user presses the button. The true source of truth lives on
  // the device; this is purely a UI guess so the next press sends the opposite.
  const [trackingHint, setTrackingHint] = useState(true);

  const reloadHistory = useCallback(async () => {
    try {
      const res = await commandService.list(deviceId, { limit: 10 });
      setHistory(res.items);
    } catch {
      // the panel still works even if history fails
    }
  }, [deviceId]);

  useEffect(() => {
    setLoading(true);
    setActive(null);
    setHistory([]);
    void reloadHistory().finally(() => setLoading(false));
  }, [reloadHistory]);

  const handleStatusChanged = useCallback(
    (event: CommandStatusChangedEvent) => {
      setActive((prev) =>
        prev && prev.commandId === event.commandId
          ? {
              ...prev,
              status: event.status,
              error: event.error ?? null,
              at: Date.now(),
            }
          : prev,
      );
      setHistory((prev) =>
        prev.map((row) =>
          row.id === event.commandId
            ? {
                ...row,
                status: event.status,
                error: event.error ?? row.error,
                deliveredAt:
                  event.status === "delivered"
                    ? new Date().toISOString()
                    : row.deliveredAt,
                executedAt:
                  event.status === "executed" || event.status === "failed"
                    ? new Date().toISOString()
                    : row.executedAt,
              }
            : row,
        ),
      );
    },
    [],
  );

  useCommandSocket(
    useMemo(
      () => ({ onCommandStatusChanged: handleStatusChanged }),
      [handleStatusChanged],
    ),
  );

  const sendCommand = useCallback(
    async (name: CommandName, payload?: CommandPayload) => {
      if (active?.status === "pending" || active?.status === "delivered") {
        // prevent stacking while one is in flight — the timeout guarantees
        // this clears within 30s even if the device never ACKs.
        return;
      }
      try {
        const res = await commandService.create(deviceId, name, payload);
        setActive({
          commandId: res.commandId,
          command: name,
          status: res.status,
          error: null,
          at: Date.now(),
        });
        // optimistic history insert; the socket `command_status_changed` will
        // keep it in sync; a `reloadHistory` on next focus backfills anything
        // we missed.
        setHistory((prev) =>
          [
            {
              id: res.commandId,
              command: name,
              payload: payload ?? null,
              status: res.status,
              createdAt: res.createdAt,
              deliveredAt: null,
              executedAt: null,
              error: null,
            },
            ...prev,
          ].slice(0, 10),
        );
      } catch (err) {
        setActive({
          commandId: "",
          command: name,
          status: "failed",
          error: err instanceof Error ? err.message : "Không gửi được lệnh",
          at: Date.now(),
        });
      }
    },
    [active, deviceId],
  );

  const toggleLock = useCallback(async () => {
    const newLocked = !isLocked;
    setLockLoading(true);
    try {
      await deviceService.setLockStatus(deviceId, newLocked);
      onLockChange?.(newLocked);
    } catch {
      // failed — state stays the same
    } finally {
      setLockLoading(false);
    }
  }, [deviceId, isLocked, onLockChange]);

  return (
    <div className="border-b border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Điều khiển thiết bị
        </h4>
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          className="text-[11px] text-blue-600 hover:underline"
        >
          {showHistory ? "Ẩn lịch sử" : "Lịch sử lệnh"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <CommandButton
          icon={MapPin}
          label="Vị trí ngay"
          onClick={() => sendCommand("request_location_now")}
          disabled={isBusy(active)}
        />
        <CommandButton
          icon={Bell}
          label="Kêu chuông"
          onClick={() => sendCommand("ring_alarm", { durationSec: 10 })}
          disabled={isBusy(active)}
          tone="amber"
        />
        <CommandButton
          icon={Power}
          label={trackingHint ? "Dừng tracking" : "Bật tracking"}
          onClick={() => {
            void sendCommand("toggle_tracking", { enabled: !trackingHint });
            setTrackingHint((v) => !v);
          }}
          disabled={isBusy(active)}
          tone={trackingHint ? "emerald" : "slate"}
        />
        <button
          type="button"
          onClick={toggleLock}
          disabled={lockLoading}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            isLocked
              ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
              : "border-slate-200 bg-white text-slate-700 hover:border-red-200 hover:bg-red-50 hover:text-red-700"
          }`}
        >
          {lockLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : isLocked ? (
            <LockOpen className="h-3.5 w-3.5" />
          ) : (
            <Lock className="h-3.5 w-3.5" />
          )}
          <span className="truncate">
            {isLocked ? "Mở khóa" : "Khóa thiết bị"}
          </span>
        </button>
      </div>

      {active && (
        <div className="mt-3 flex items-center gap-2 text-xs">
          <StatusPill status={active.status} />
          <span className="truncate text-slate-700">
            {COMMAND_LABEL[active.command]}
          </span>
          {isBusy(active) && (
            <Loader2 className="ml-auto h-3 w-3 shrink-0 animate-spin text-slate-400" />
          )}
          {active.error && (
            <span className="ml-auto truncate text-red-600">{active.error}</span>
          )}
        </div>
      )}

      {showHistory && (
        <div className="mt-3 space-y-1.5">
          {loading ? (
            <div className="py-3 text-center text-xs text-slate-500">
              Đang tải lịch sử...
            </div>
          ) : history.length === 0 ? (
            <div className="py-3 text-center text-xs text-slate-500">
              Chưa có lệnh nào
            </div>
          ) : (
            history.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px]"
              >
                <StatusIcon status={c.status} />
                <span className="flex-1 truncate">
                  {COMMAND_LABEL[c.command as CommandName] ?? c.command}
                </span>
                <span className="text-slate-500">
                  {new Date(c.createdAt).toLocaleTimeString("vi-VN")}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function isBusy(active: ActiveCommand | null): boolean {
  return !!active && (active.status === "pending" || active.status === "delivered");
}

function StatusPill({ status }: { status: CommandStatus }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_COLOR[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function StatusIcon({ status }: { status: CommandStatus }) {
  if (status === "executed")
    return <Check className="h-3 w-3 text-emerald-600" />;
  if (status === "failed") return <X className="h-3 w-3 text-red-600" />;
  return <Loader2 className="h-3 w-3 animate-spin text-slate-400" />;
}

interface CommandButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "blue" | "red" | "emerald" | "amber" | "slate";
}

function CommandButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  tone = "blue",
}: CommandButtonProps) {
  const toneClass = {
    blue: "hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200",
    red: "hover:bg-red-50 hover:text-red-700 hover:border-red-200",
    emerald:
      "hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200",
    amber: "hover:bg-amber-50 hover:text-amber-700 hover:border-amber-200",
    slate: "hover:bg-slate-50 hover:text-slate-900",
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${toneClass}`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="truncate">{label}</span>
    </button>
  );
}
