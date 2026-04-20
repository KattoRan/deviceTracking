"use client";

import { motion } from "framer-motion";
import {
  Clock,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Radio,
  Signal,
  Smartphone,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import deviceService from "@/services/deviceService";
import type { CellTowerInfo, Device, DeviceDetail } from "@/types/device";

interface DeviceDetailPanelProps {
  device: Device;
  onClose: () => void;
  isMobile?: boolean;
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

export default function DeviceDetailPanel({
  device,
  onClose,
  isMobile = false,
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
                {device.name || device.phone_number}
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

        <div className="mt-3 flex items-center gap-2">
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
        </div>
      </div>

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

          {device.cellTowers && device.cellTowers.length > 0 && (
            <Section
              icon={Radio}
              title={`Trạm đang kết nối (${device.cellTowers.length})`}
            >
              <div className="space-y-2">
                {device.cellTowers.map((cell, i) => (
                  <CellTowerRow key={`${cell.cid}-${cell.lac}-${i}`} cell={cell} />
                ))}
              </div>
            </Section>
          )}

          <div className="grid grid-cols-2 border-b border-slate-200">
            <div className="border-r border-slate-200 p-4">
              <SectionHeader icon={Clock} title="Cập nhật cuối" />
              <p className="text-sm font-medium text-slate-900">
                {formatDateTime(detail?.last_seen ?? device.last_seen)}
              </p>
            </div>
            <div className="p-4">
              <SectionHeader icon={MapPin} title="Tọa độ" />
              <p className="font-mono text-sm text-slate-900">
                {formatCoord(detail?.location?.latitude ?? device.latitude)}
              </p>
              <p className="font-mono text-sm text-slate-600">
                {formatCoord(detail?.location?.longitude ?? device.longitude)}
              </p>
              {(detail?.location?.district || device.district) && (
                <p className="mt-1 text-[11px] text-slate-500">
                  {detail?.location?.district || device.district}
                </p>
              )}
            </div>
          </div>

          {detail?.bts && (
            <Section icon={Radio} title="Trạm BTS đang phục vụ">
              <div className="space-y-2 text-xs text-slate-600">
                <Row label="ID" value={`#${detail.bts.id}`} />
                <Row label="Công nghệ" value={detail.bts.radio || "--"} />
                <Row
                  label="Bán kính phủ"
                  value={
                    detail.bts.range != null
                      ? `${(detail.bts.range / 1000).toFixed(1)} km`
                      : "--"
                  }
                />
                <Row
                  label="Khoảng cách"
                  value={
                    detail.bts.distance_m != null
                      ? detail.bts.distance_m >= 1000
                        ? `${(detail.bts.distance_m / 1000).toFixed(2)} km`
                        : `${detail.bts.distance_m} m`
                      : "--"
                  }
                />
              </div>
            </Section>
          )}

          <Section icon={User} title="Thông tin thiết bị">
            <div className="space-y-2.5">
              <Row
                icon={User}
                label="Chủ sở hữu"
                value={detail?.owner?.full_name || "--"}
              />
              <Row
                icon={Phone}
                label="Số điện thoại"
                value={detail?.phone_number || device.phone_number}
              />
              <Row icon={Mail} label="Email" value={detail?.owner?.email || "--"} />
              <Row
                icon={Smartphone}
                label="Thiết bị"
                value={
                  [detail?.model || device.model, detail?.device_os || device.device_os]
                    .filter(Boolean)
                    .join(" · ") || "--"
                }
              />
              <Row label="Loại" value={detail?.type || device.type || "--"} />
              <Row
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

function CellTowerRow({ cell }: { cell: CellTowerInfo }) {
  const signal = signalLevel(cell.signalDbm);
  return (
    <div
      className={`rounded-lg border px-3 py-2.5 ${cell.isServing ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50"}`}
    >
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`rounded px-1.5 py-0.5 text-xs font-semibold ${cell.isServing ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-600"}`}
          >
            {cell.type}
          </span>
          {cell.isServing && (
            <span className="text-[10px] font-medium text-blue-700">Serving</span>
          )}
        </div>
        <div className={`flex items-center gap-1 ${signal.color}`}>
          <SignalBars bars={signal.bars} />
          <span className="text-[10px]">{cell.signalDbm} dBm</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
        <span>CID: {cell.cid}</span>
        <span>LAC: {cell.lac}</span>
        <span>MCC: {cell.mcc}</span>
        <span>MNC: {cell.mnc}</span>
        {cell.pci != null && <span>PCI: {cell.pci}</span>}
      </div>
    </div>
  );
}
