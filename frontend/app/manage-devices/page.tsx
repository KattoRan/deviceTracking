"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clock,
  History,
  Loader2,
  MapPin,
  Radio,
  Search,
  Smartphone,
  Trash2,
  User,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import deviceService from "@/services/deviceService";
import type { Device, DeviceDetail } from "@/types/device";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | "online" | "offline";

const PAGE_SIZE = 10;

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCoord(val: number | null | undefined): string {
  return val == null ? "--" : val.toFixed(6);
}

export default function ManageDevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await deviceService.getAll();
      setDevices(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Không tải được danh sách");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  const handleDeleted = useCallback(
    (id: string) => {
      setDevices((prev) => prev.filter((d) => d.id !== id));
      setSelectedId(null);
    },
    [],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return devices.filter((d) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (!q) return true;
      return (
        d.name.toLowerCase().includes(q) ||
        (d.phone_number?.toLowerCase().includes(q) ?? false) ||
        (d.model ?? "").toLowerCase().includes(q) ||
        d.id.toLowerCase().includes(q)
      );
    });
  }, [devices, search, statusFilter]);

  // Reset pagination whenever filters change so the user isn't stranded on an
  // empty page after narrowing the result set.
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageStart = (pageSafe - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 md:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Quản lý thiết bị
          </h1>
          <p className="text-sm text-slate-600">
            Danh sách thiết bị đã đăng ký, trạng thái và thông tin chi tiết.
          </p>
        </div>
      </header>

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative flex-1 md:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên, số điện thoại, model, ID..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {(["all", "online", "offline"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                statusFilter === s
                  ? "bg-emerald-50 text-emerald-700"
                  : "text-slate-600 hover:bg-slate-50",
              )}
            >
              {s === "all" ? "Tất cả" : s === "online" ? "Trực tuyến" : "Ngoại tuyến"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white py-16 text-center text-sm text-slate-500">
          Không tìm thấy thiết bị nào khớp bộ lọc.
        </div>
      ) : (
        <>
          <DeviceTable
            rows={pageRows}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id)}
          />
          <DeviceCardList
            rows={pageRows}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id)}
          />

          <Pagination
            page={pageSafe}
            totalPages={totalPages}
            totalItems={filtered.length}
            pageSize={PAGE_SIZE}
            onChange={setPage}
          />
        </>
      )}

      {selectedId && (
        <DetailDrawer
          deviceId={selectedId}
          onClose={() => setSelectedId(null)}
          onDeleted={handleDeleted}
        />
      )}
    </main>
  );
}

interface RowProps {
  rows: Device[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function DeviceTable({ rows, selectedId, onSelect }: RowProps) {
  return (
    <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white md:block">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Chủ sở hữu</th>
            <th className="px-4 py-3 text-left font-medium">Thiết bị</th>
            <th className="px-4 py-3 text-left font-medium">Số điện thoại</th>
            <th className="px-4 py-3 text-left font-medium">Cập nhật</th>
            <th className="px-4 py-3 text-left font-medium">Trạng thái</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((d) => {
            const online = d.status === "online";
            return (
              <tr
                key={d.id}
                onClick={() => onSelect(d.id)}
                className={cn(
                  "cursor-pointer transition-colors hover:bg-slate-50",
                  selectedId === d.id && "bg-emerald-50/40",
                )}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                      <User className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{d.name}</p>
                      <p className="truncate text-xs text-slate-500">
                        {d.id.slice(0, 8)}…
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-700">
                  <div className="flex items-center gap-2">
                    <Smartphone className="h-4 w-4 text-slate-400" />
                    <span>{d.model || "--"}</span>
                  </div>
                  <p className="pl-6 text-xs text-slate-500">{d.device_os || ""}</p>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-700">
                  {d.phone_number}
                </td>
                <td className="px-4 py-3 text-xs text-slate-600">
                  {formatDateTime(d.last_seen)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      online
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-500",
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        online ? "bg-emerald-500" : "bg-slate-400",
                      )}
                    />
                    {online ? "Trực tuyến" : "Ngoại tuyến"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DeviceCardList({ rows, selectedId, onSelect }: RowProps) {
  return (
    <div className="space-y-2 md:hidden">
      {rows.map((d) => {
        const online = d.status === "online";
        return (
          <button
            type="button"
            key={d.id}
            onClick={() => onSelect(d.id)}
            className={cn(
              "w-full rounded-xl border bg-white p-4 text-left transition-colors",
              selectedId === d.id
                ? "border-emerald-300 bg-emerald-50/40"
                : "border-slate-200 hover:border-slate-300",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate font-medium text-slate-900">{d.name}</p>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                  online
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-slate-100 text-slate-500",
                )}
              >
                {online ? "Trực tuyến" : "Ngoại tuyến"}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
              <span className="flex items-center gap-1">
                <Smartphone className="h-3 w-3" />
                {d.model || "--"}
              </span>
              <span className="font-mono">{d.phone_number}</span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDateTime(d.last_seen)}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  onChange,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onChange: (page: number) => void;
}) {
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-sm">
      <p className="text-slate-500">
        Hiển thị <span className="font-medium text-slate-700">{from}-{to}</span>{" "}
        trên <span className="font-medium text-slate-700">{totalItems}</span> thiết bị
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Trang trước"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="px-3 text-xs text-slate-600">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Trang sau"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function DetailDrawer({
  deviceId,
  onClose,
  onDeleted,
}: {
  deviceId: string;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [detail, setDetail] = useState<DeviceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    deviceService
      .getOne(deviceId)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Không tải được chi tiết");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  const handleConfirmDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deviceService.remove(deviceId);
      onDeleted(deviceId);
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : "Không xoá được thiết bị");
      setDeleting(false);
    }
  };

  const online = detail?.status === "online";

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-slate-900/30"
        onClick={onClose}
        aria-hidden
      />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Smartphone className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">
                {detail?.person_name || "Chi tiết thiết bị"}
              </p>
              <p className="truncate text-xs text-slate-500">{detail?.model || "--"}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : error ? (
          <div className="m-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : detail ? (
          <div className="flex-1 space-y-5 p-4">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                  online
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-slate-100 text-slate-500",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    online ? "bg-emerald-500" : "bg-slate-400",
                  )}
                />
                {online ? "Trực tuyến" : "Ngoại tuyến"}
              </span>
              {detail.cell?.type && (
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                  {detail.cell.type}
                </span>
              )}
            </div>

            <DetailSection icon={User} title="Người được giám sát">
              <DetailRow label="Tên" value={detail.person_name} />
              <DetailRow
                label="Loại"
                value={detail.person_type === "CHILD" ? "Trẻ em" : "Người già"}
              />
              {detail.last_battery != null && (
                <DetailRow
                  label="Pin"
                  value={`${detail.last_battery}%`}
                />
              )}
            </DetailSection>

            <DetailSection icon={Smartphone} title="Thiết bị">
              <DetailRow label="Số điện thoại" value={detail.phone_number} mono />
              <DetailRow label="Model" value={detail.model} />
              <DetailRow label="Hệ điều hành" value={detail.device_os} />
              <DetailRow label="Loại" value={detail.type} />
              <DetailRow
                label="Đăng ký"
                value={formatDateTime(detail.registered_at)}
              />
              <DetailRow label="Cập nhật cuối" value={formatDateTime(detail.last_seen)} />
            </DetailSection>

            {detail.location && (
              <DetailSection icon={MapPin} title="Vị trí gần nhất">
                <DetailRow
                  label="Tọa độ"
                  value={`${formatCoord(detail.location.latitude)}, ${formatCoord(detail.location.longitude)}`}
                  mono
                />
                <DetailRow label="Khu vực" value={detail.location.district} />
                <DetailRow
                  label="Thời điểm"
                  value={formatDateTime(detail.location.recorded_at)}
                />
              </DetailSection>
            )}

            {detail.bts && (
              <DetailSection icon={Radio} title="Trạm BTS phục vụ">
                <DetailRow label="ID" value={`#${detail.bts.id}`} />
                <DetailRow label="Công nghệ" value={detail.bts.radio} />
                <DetailRow
                  label="Bán kính phủ"
                  value={
                    detail.bts.range != null
                      ? `${(detail.bts.range / 1000).toFixed(1)} km`
                      : null
                  }
                />
                <DetailRow
                  label="Khoảng cách"
                  value={
                    detail.bts.distance_m != null
                      ? detail.bts.distance_m >= 1000
                        ? `${(detail.bts.distance_m / 1000).toFixed(2)} km`
                        : `${detail.bts.distance_m} m`
                      : null
                  }
                />
              </DetailSection>
            )}
          </div>
        ) : null}

        <div className="sticky bottom-0 space-y-2 border-t border-slate-200 bg-white p-3">
          <div className="flex gap-2">
            <Link
              href={`/tracking?deviceId=${deviceId}`}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              <MapPin className="h-4 w-4" />
              Xem trên bản đồ
            </Link>
            <Link
              href={`/history?deviceId=${deviceId}`}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <History className="h-4 w-4" />
              Xem lịch sử
            </Link>
          </div>
          <button
            type="button"
            onClick={() => {
              setDeleteError(null);
              setConfirmingDelete(true);
            }}
            disabled={loading || !detail}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            Huỷ thiết bị
          </button>
        </div>
      </aside>
      {confirmingDelete && (
        <DeleteConfirmModal
          deviceName={detail?.person_name || detail?.phone_number || deviceId}
          deleting={deleting}
          error={deleteError}
          onCancel={() => {
            if (deleting) return;
            setConfirmingDelete(false);
            setDeleteError(null);
          }}
          onConfirm={handleConfirmDelete}
        />
      )}
    </>
  );
}

function DeleteConfirmModal({
  deviceName,
  deleting,
  error,
  onCancel,
  onConfirm,
}: {
  deviceName: string;
  deleting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">
              Huỷ đăng ký thiết bị?
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Thiết bị <span className="font-medium text-slate-900">{deviceName}</span>{" "}
              cùng toàn bộ lịch sử di chuyển và dữ liệu liên quan sẽ bị xoá vĩnh
              viễn. Người dùng cũng sẽ bị xoá nếu không còn thiết bị nào khác.
              Hành động không thể hoàn tác.
            </p>
          </div>
        </div>
        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Huỷ
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
            {deleting ? "Đang xoá..." : "Xoá thiết bị"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailSection({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof User;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      <div className="space-y-1.5 rounded-lg border border-slate-100 bg-slate-50/50 p-3">
        {children}
      </div>
    </section>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-xs text-slate-500">{label}</span>
      <span
        className={cn(
          "min-w-0 truncate text-right text-slate-900",
          mono && "font-mono text-xs",
        )}
      >
        {value ?? "--"}
      </span>
    </div>
  );
}
