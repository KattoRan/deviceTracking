"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  Calendar,
  Clock,
  Loader2,
  MapPin,
  Phone,
  Radio,
  Signal,
  Smartphone,
  Tag,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import deviceService from "@/services/deviceService";
import type {
  Activity,
  CellTowerInfo,
  ConnectedBts,
  Device,
  DeviceDetail,
} from "@/types/device";

const ACTIVITY_LABEL: Record<Activity, string> = {
  STILL: "Đứng yên",
  WALKING: "Đang đi bộ",
  RUNNING: "Đang chạy",
  ON_BICYCLE: "Đang đi xe đạp",
  IN_VEHICLE: "Đang lái xe",
  UNKNOWN: "Không xác định",
};

const ACTIVITY_ICON: Record<Activity, string> = {
  STILL: "⏸️",
  WALKING: "🚶",
  RUNNING: "🏃",
  ON_BICYCLE: "🚴",
  IN_VEHICLE: "🚗",
  UNKNOWN: "❓",
};
import RemoteControlPanel from "./RemoteControlPanel";

interface DeviceDetailPanelProps {
  device: Device;
  onClose: () => void;
  isMobile?: boolean;
  onLockChange?: (deviceId: string, locked: boolean) => void;
  /**
   * Yêu cầu map fly tới trạm BTS — gọi khi user bấm vào row serving cell
   * trong danh sách trạm kết nối. Page truyền callback để forward sang MapView.
   */
  onFocusBts?: (bts: ConnectedBts) => void;
}

interface SignalLevel {
  label: string;
  color: string;
  bars: number;
}

function signalLevel(dbm: number | null | undefined): SignalLevel {
  if (dbm == null) return { label: "Không rõ", color: "text-slate-400", bars: 0 };
  if (dbm >= -70) return { label: "Rất tốt", color: "text-emerald-600", bars: 4 };
  if (dbm >= -85) return { label: "Tốt", color: "text-emerald-600", bars: 3 };
  if (dbm >= -100) return { label: "Trung bình", color: "text-amber-600", bars: 2 };
  return { label: "Yếu", color: "text-red-600", bars: 1 };
}

function SignalBars({ bars }: { bars: number }) {
  return (
    <div className="flex h-4 items-end gap-[2px]">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={`w-[3px] rounded-sm transition-colors ${i <= bars ? "bg-current" : "bg-slate-200"}`}
          style={{ height: `${4 + i * 3}px` }}
        />
      ))}
    </div>
  );
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatCoord(val: number | null | undefined): string {
  return val == null ? "--" : val.toFixed(6);
}

function formatDistance(m: number | null): string {
  if (m == null) return "--";
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m} m`;
}

export default function DeviceDetailPanel({
  device,
  onClose,
  isMobile = false,
  onLockChange,
  onFocusBts,
}: DeviceDetailPanelProps) {
  const [detail, setDetail] = useState<DeviceDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetail(null);

    deviceService
      .getOne(device.id)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch(() => {
        /* fall back to the list-level `device` data */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [device.id]);

  const servingCell = device.cellTowers?.find((c) => c.isServing);
  const signalDbm = servingCell?.signalDbm ?? detail?.cell?.signal_dbm ?? null;
  const signal = signalLevel(signalDbm);
  const isOnline = (detail?.status ?? device.status) === "online";

  // Tick mỗi 15s để badge "GPS mất N phút" cập nhật mà không phụ thuộc
  // heartbeat đến (heartbeat đến mới rerender — nhưng GPS lost còn được tính
  // ngay cả khi heartbeat chưa kịp đến).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  // Coi là "mất GPS" khi fix GPS cuối > 90s và device vẫn online. Threshold
  // 90s = 3× heartbeat interval (30s) để tránh false positive: lastFixAt đầu
  // tiên đến từ socket có thể đã ~60s tuổi nếu page vừa load giữa chu kỳ.
  const GPS_LOST_THRESHOLD_MS = 90_000;
  const gpsLostMs =
    isOnline && device.lastGpsAt
      ? Math.max(0, now - new Date(device.lastGpsAt).getTime())
      : 0;
  const isGpsLost = gpsLostMs > GPS_LOST_THRESHOLD_MS;
  const gpsLostLabel = (() => {
    if (!isGpsLost) return null;
    const sec = Math.floor(gpsLostMs / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} phút`;
    const hr = Math.floor(min / 60);
    return `${hr} giờ ${min % 60} phút`;
  })();

  // Danh sách trạm kết nối — ưu tiên dữ liệu realtime từ socket (`device.cellTowers`).
  // Khi chưa có socket update (mới mở panel), fallback về single serving cell
  // từ `detail.cell` để user vẫn thấy thông tin ngay thay vì list rỗng.
  const cellTowers = useMemo<CellTowerInfo[]>(() => {
    if (device.cellTowers && device.cellTowers.length > 0) return device.cellTowers;
    const c = detail?.cell;
    if (
      c &&
      c.mcc != null &&
      c.mnc != null &&
      c.lac != null &&
      c.cid != null &&
      c.signal_dbm != null
    ) {
      return [
        {
          type: c.type ?? "",
          mcc: c.mcc,
          mnc: c.mnc,
          lac: c.lac,
          cid: c.cid,
          pci: c.pci,
          rssi: c.rssi,
          signalDbm: c.signal_dbm,
          isServing: true,
        },
      ];
    }
    return [];
  }, [device.cellTowers, detail?.cell]);

  return (
    <motion.div
      initial={{ x: isMobile ? "100%" : 380 }}
      animate={{ x: 0 }}
      exit={{ x: isMobile ? "100%" : 380 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className={
        isMobile
          ? "absolute inset-0 z-[1000] overflow-y-auto bg-white text-slate-900"
          : "absolute bottom-0 right-0 top-0 z-[1000] w-[380px] max-w-[calc(100vw-48px)] overflow-y-auto border-l border-slate-200 bg-white text-slate-900 shadow-xl"
      }
    >
      <div className="border-b border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50">
                <Smartphone className="h-5 w-5 text-blue-600" />
              </div>
              <span
                className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${isOnline ? "bg-emerald-500" : "bg-slate-400"}`}
              />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">
                {device.owner_name || device.phone_number}
              </p>
              <p className="text-xs text-slate-500">
                {detail?.model || device.model || "--"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${isOnline ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
          >
            {isOnline ? "Trực tuyến" : "Ngoại tuyến"}
          </span>
          {(servingCell?.type || detail?.cell?.type) && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
              {servingCell?.type || detail?.cell?.type}
            </span>
          )}
          {isGpsLost && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
              GPS mất {gpsLostLabel}
            </span>
          )}
        </div>
      </div>

      {isGpsLost && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-semibold text-amber-800">
                Mất tín hiệu GPS {gpsLostLabel}
              </p>
              <p className="mt-0.5 text-xs text-amber-700">
                Vị trí marker là điểm GPS cuối cùng nhận được. Thiết bị vẫn còn
                hoạt động và đang kết nối
                {device.connectedBts ? (
                  <>
                    {" "}trạm{" "}
                    <span className="font-semibold">
                      #{device.connectedBts.id}
                    </span>
                    {device.connectedBts.range != null && (
                      <>
                        {" "}(bán kính phủ ~
                        {formatDistance(device.connectedBts.range)})
                      </>
                    )}
                    — khả năng cao đang trong vùng phủ sóng của trạm này.
                  </>
                ) : (
                  <> mạng di động.</>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {device.activity && device.activity !== "UNKNOWN" && (
        <div className="border-b border-slate-100 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-base">{ACTIVITY_ICON[device.activity]}</span>
            <span className="text-xs font-medium text-slate-600">
              {ACTIVITY_LABEL[device.activity]}
            </span>
            {device.activityConfidence != null && (
              <span className="ml-auto text-[10px] text-slate-400">
                {device.activityConfidence}% tin cậy
              </span>
            )}
          </div>
        </div>
      )}

      {device.spoofingSuspected && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
            <div>
              <p className="text-sm font-semibold text-red-800">
                Nghi ngờ giả mạo GPS
              </p>
              <p className="mt-0.5 text-xs text-red-700">
                Vị trí GPS cách trạm BTS đang kết nối{" "}
                <span className="font-semibold">
                  {device.gpsBtsDistanceM != null
                    ? formatDistance(device.gpsBtsDistanceM)
                    : "?"}
                </span>
                {device.connectedBts?.range != null && (
                  <>, vượt quá phạm vi phủ sóng{" "}
                    <span className="font-semibold">
                      {formatDistance(device.connectedBts.range)}
                    </span>
                  </>
                )}
                . Thiết bị có thể đang sử dụng ứng dụng fake GPS.
              </p>
            </div>
          </div>
        </div>
      )}

      <RemoteControlPanel
        deviceId={device.id}
        isLocked={device.is_locked}
        onLockChange={(locked) => onLockChange?.(device.id, locked)}
      />

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
        </div>
      ) : (
        <>
          <Section icon={Signal} title="Mạng di động & Tín hiệu">
            <div className="grid grid-cols-2 gap-3">
              <InfoCard
                label="Cường độ"
                value={signalDbm != null ? `${signalDbm} dBm` : "--"}
                sub={signal.label}
                accent={signal.color}
                extra={<SignalBars bars={signal.bars} />}
              />
              <InfoCard
                label="RSSI"
                value={
                  servingCell?.rssi != null
                    ? `${servingCell.rssi}`
                    : detail?.cell?.rssi != null
                      ? `${detail.cell.rssi}`
                      : "--"
                }
              />
              <InfoCard
                label="Công nghệ"
                value={servingCell?.type || detail?.cell?.type || "--"}
              />
              <InfoCard
                label="PCI"
                value={
                  servingCell?.pci != null
                    ? `${servingCell.pci}`
                    : detail?.cell?.pci != null
                      ? `${detail.cell.pci}`
                      : "--"
                }
              />
            </div>
          </Section>

          <div className="grid grid-cols-2 border-b border-slate-200">
            <div className="border-r border-slate-200 p-4">
              <SectionHeader icon={Clock} title="Cập nhật cuối" />
              <p className="text-sm font-medium text-slate-900">
                {formatDateTime(device.last_seen ?? detail?.last_seen)}
              </p>
            </div>
            <div className="p-4">
              <SectionHeader icon={MapPin} title="Tọa độ" />
              <p className="font-mono text-sm font-medium text-slate-900">
                {formatCoord(device.latitude ?? detail?.location?.latitude)}
              </p>
              <p className="font-mono text-sm font-medium text-slate-900">
                {formatCoord(device.longitude ?? detail?.location?.longitude)}
              </p>
            </div>
          </div>

          <Section icon={Radio} title="Trạm kết nối">
            {cellTowers.length === 0 ? (
              <p className="text-xs text-slate-500">
                Chưa có dữ liệu trạm kết nối.
              </p>
            ) : (
              <ul className="space-y-2">
                {cellTowers.map((c) => (
                  <CellTowerRow
                    key={`${c.mcc}-${c.mnc}-${c.lac}-${c.cid}`}
                    cell={c}
                    onSelect={
                      c.isServing && device.connectedBts && onFocusBts
                        ? () => onFocusBts(device.connectedBts!)
                        : undefined
                    }
                  />
                ))}
              </ul>
            )}
          </Section>

          <Section icon={User} title="Thông tin thiết bị">
            <div className="space-y-2.5">
              <Row
                icon={User}
                label="Người dùng"
                value={detail?.owner_name || device.owner_name || "--"}
              />
              <Row
                icon={Phone}
                label="Số điện thoại"
                value={detail?.phone_number || device.phone_number || "--"}
              />
              <Row
                icon={Smartphone}
                label="Thiết bị"
                value={
                  [detail?.model || device.model, detail?.device_os || device.device_os]
                    .filter(Boolean)
                    .join(" · ") || "--"
                }
              />
              <Row
                icon={Tag}
                label="Loại"
                value={detail?.type || device.type || "--"}
              />
              <Row
                icon={Calendar}
                label="Ngày đăng ký"
                value={
                  detail?.registered_at
                    ? new Date(detail.registered_at).toLocaleDateString("vi-VN")
                    : "--"
                }
              />
            </div>
          </Section>
        </>
      )}
    </motion.div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-slate-200 p-4">
      <SectionHeader icon={Icon} title={title} />
      {children}
    </div>
  );
}

function SectionHeader({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 text-slate-400" />
      <h4 className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {title}
      </h4>
    </div>
  );
}

function InfoCard({
  label,
  value,
  sub,
  accent,
  extra,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  extra?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
      <p className="mb-1 text-[10px] text-slate-500">{label}</p>
      <div className="flex items-center justify-between">
        <div>
          <p className={`text-sm font-semibold ${accent || "text-slate-900"}`}>
            {value}
          </p>
          {sub && (
            <p className={`mt-0.5 text-[10px] ${accent || "text-slate-500"}`}>{sub}</p>
          )}
        </div>
        {extra && <div className={accent || "text-slate-400"}>{extra}</div>}
      </div>
    </div>
  );
}

function CellTowerRow({
  cell,
  onSelect,
}: {
  cell: CellTowerInfo;
  onSelect?: () => void;
}) {
  const sig = signalLevel(cell.signalDbm);
  const clickable = !!onSelect;
  const baseClass = `rounded-lg border p-2.5 text-left ${
    cell.isServing
      ? "border-blue-200 bg-blue-50"
      : "border-slate-200 bg-slate-50"
  }`;
  const interactiveClass = clickable
    ? " w-full cursor-pointer transition-colors hover:bg-blue-100"
    : "";
  const content = (
    <>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {cell.type && (
            <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 ring-1 ring-slate-200">
              {cell.type}
            </span>
          )}
          <span className="font-mono text-xs font-semibold text-slate-900">
            CID {cell.cid}
          </span>
        </div>
        {cell.isServing && (
          <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            Đang phục vụ
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-600">
        <div>
          <p className="text-[9px] uppercase tracking-wide text-slate-400">
            Cường độ
          </p>
          <p className={`font-medium ${sig.color}`}>{cell.signalDbm} dBm</p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wide text-slate-400">RSSI</p>
          <p className="font-medium text-slate-900">{cell.rssi ?? "--"}</p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wide text-slate-400">PCI</p>
          <p className="font-medium text-slate-900">{cell.pci ?? "--"}</p>
        </div>
      </div>
      <p className="mt-1.5 font-mono text-[10px] text-slate-500">
        MCC {cell.mcc} · MNC {cell.mnc} · LAC {cell.lac}
        {clickable && (
          <span className="ml-2 text-blue-600">· Xem trên bản đồ</span>
        )}
      </p>
    </>
  );
  return (
    <li>
      {clickable ? (
        <button
          type="button"
          onClick={onSelect}
          className={baseClass + interactiveClass}
        >
          {content}
        </button>
      ) : (
        <div className={baseClass}>{content}</div>
      )}
    </li>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon?: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      {Icon ? (
        <Icon className="h-4 w-4 flex-shrink-0 text-slate-400" />
      ) : (
        <div className="w-4" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-slate-500">{label}</p>
        <p className="truncate text-sm text-slate-900">{value}</p>
      </div>
    </div>
  );
}

