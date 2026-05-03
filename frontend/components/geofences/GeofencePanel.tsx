"use client";

import { useMemo, useState } from "react";
import {
  Loader2,
  MapPin,
  Plus,
  Save,
  Shield,
  Trash2,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import type { Device } from "@/types/device";
import type {
  GeofenceDetail,
  GeofenceListItem,
} from "@/types/geofence";
import { cn } from "@/lib/utils";

export interface DraftGeofence {
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
}

interface GeofencePanelProps {
  geofences: GeofenceListItem[];
  activeDetail: GeofenceDetail | null;
  draft: DraftGeofence | null;
  /** True when admin clicked "new" or is editing an existing zone. */
  editing: boolean;
  loadingDetail: boolean;
  saving: boolean;
  devices: Device[];
  onSelect: (id: string | null) => void;
  onCreateNew: () => void;
  onDraftChange: (next: DraftGeofence) => void;
  onDiscard: () => void;
  onSave: () => Promise<void> | void;
  onStartEdit: () => void;
  onDelete: (id: string) => Promise<void> | void;
  onAssignDevice: (deviceId: string) => Promise<void> | void;
  onDetachDevice: (deviceId: string) => Promise<void> | void;
}

export default function GeofencePanel({
  geofences,
  activeDetail,
  draft,
  editing,
  loadingDetail,
  saving,
  devices,
  onSelect,
  onCreateNew,
  onDraftChange,
  onDiscard,
  onSave,
  onStartEdit,
  onDelete,
  onAssignDevice,
  onDetachDevice,
}: GeofencePanelProps) {
  const [deviceToAdd, setDeviceToAdd] = useState<string>("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isCreating = !!draft && !activeDetail;
  const isEditingExisting = !!activeDetail && editing;

  const assignedIds = useMemo(
    () => new Set(activeDetail?.devices.map((d) => d.id) ?? []),
    [activeDetail],
  );

  const availableDevices = useMemo(
    () => devices.filter((d) => !assignedIds.has(d.id)),
    [devices, assignedIds],
  );

  const radius = draft?.radiusM ?? activeDetail?.radiusM ?? 0;
  const name = draft?.name ?? activeDetail?.name ?? "";
  const lat = draft?.lat ?? activeDetail?.lat ?? null;
  const lon = draft?.lon ?? activeDetail?.lon ?? null;

  function patchDraft(patch: Partial<DraftGeofence>) {
    if (!draft) return;
    onDraftChange({ ...draft, ...patch });
  }

  return (
    <aside className="flex h-full w-full flex-col border-r border-slate-200 bg-white md:w-96">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-emerald-600" />
          <h2 className="text-base font-semibold text-slate-900">
            Vùng an toàn
          </h2>
        </div>
        <button
          type="button"
          onClick={onCreateNew}
          disabled={isCreating}
          className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-400"
        >
          <Plus className="h-3.5 w-3.5" />
          Tạo vùng
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* List */}
        <div className="border-b border-slate-200">
          {geofences.length === 0 && !isCreating && (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              Chưa có vùng nào. Bấm <span className="font-medium">Tạo vùng</span>{" "}
              để bắt đầu.
            </div>
          )}
          <ul className="divide-y divide-slate-100">
            {geofences.map((g) => {
              const active = activeDetail?.id === g.id;
              return (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(active ? null : g.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm transition-colors",
                      active
                        ? "bg-emerald-50"
                        : "hover:bg-slate-50",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-slate-900">
                        {g.name}
                      </div>
                      <div className="truncate text-xs text-slate-500">
                        Bán kính {g.radiusM}m · {g.deviceCount} thiết bị
                      </div>
                    </div>
                    <MapPin
                      className={cn(
                        "h-4 w-4 shrink-0",
                        active ? "text-emerald-600" : "text-slate-400",
                      )}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Form / Detail */}
        {(isCreating || activeDetail) && (
          <div className="space-y-4 px-4 py-4">
            {isCreating && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Bấm vào bản đồ để chọn tâm vùng. Có thể kéo điểm tâm để hiệu chỉnh.
              </div>
            )}

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-600">
                Tên vùng
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) =>
                  isCreating
                    ? patchDraft({ name: e.target.value })
                    : isEditingExisting
                      ? patchDraft({ name: e.target.value })
                      : null
                }
                disabled={!isCreating && !isEditingExisting}
                placeholder="VD: Trụ sở chính"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50 disabled:text-slate-600"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="mb-1.5 block text-xs font-medium text-slate-600">
                  Vĩ độ
                </span>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
                  {lat != null ? lat.toFixed(6) : "—"}
                </div>
              </div>
              <div>
                <span className="mb-1.5 block text-xs font-medium text-slate-600">
                  Kinh độ
                </span>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
                  {lon != null ? lon.toFixed(6) : "—"}
                </div>
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-600">
                <span>Bán kính</span>
                <span className="font-mono text-slate-900">{radius}m</span>
              </div>
              <input
                type="range"
                min={10}
                max={5000}
                step={10}
                value={radius}
                onChange={(e) =>
                  isCreating || isEditingExisting
                    ? patchDraft({ radiusM: Number(e.target.value) })
                    : null
                }
                disabled={!isCreating && !isEditingExisting}
                className="w-full accent-emerald-600 disabled:opacity-50"
              />
              <input
                type="number"
                min={10}
                max={100_000}
                step={10}
                value={radius}
                onChange={(e) =>
                  isCreating || isEditingExisting
                    ? patchDraft({ radiusM: Number(e.target.value) || 10 })
                    : null
                }
                disabled={!isCreating && !isEditingExisting}
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50"
              />
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              {(isCreating || isEditingExisting) && (
                <>
                  <button
                    type="button"
                    onClick={onSave}
                    disabled={saving || !name.trim() || lat == null || lon == null}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-400"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Lưu
                  </button>
                  <button
                    type="button"
                    onClick={onDiscard}
                    disabled={saving}
                    className="flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                    aria-label="Hủy"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </>
              )}
              {activeDetail && !isEditingExisting && (
                <>
                  <button
                    type="button"
                    onClick={onStartEdit}
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    Chỉnh sửa
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="flex items-center justify-center rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
                    aria-label="Xoá vùng"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>

            {confirmDelete && activeDetail && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="mb-3 text-sm text-red-800">
                  Xoá vùng này? Các thiết bị thuộc vùng sẽ tự động được gỡ liên kết.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await onDelete(activeDetail.id);
                      setConfirmDelete(false);
                    }}
                    className="flex-1 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                  >
                    Xoá
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Huỷ
                  </button>
                </div>
              </div>
            )}

            {/* Assigned devices */}
            {activeDetail && (
              <div className="border-t border-slate-200 pt-4">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Thiết bị trong vùng ({activeDetail.devices.length})
                </h3>
                {loadingDetail ? (
                  <div className="py-2 text-xs text-slate-400">Đang tải…</div>
                ) : (
                  <ul className="space-y-1.5">
                    {activeDetail.devices.length === 0 && (
                      <li className="text-xs text-slate-400">
                        Chưa có thiết bị nào.
                      </li>
                    )}
                    {activeDetail.devices.map((d) => (
                      <li
                        key={d.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-slate-900">
                            {d.name}
                          </div>
                          <div className="truncate font-mono text-xs text-slate-500">
                            {d.phone_number}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onDetachDevice(d.id)}
                          className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                          aria-label="Gỡ thiết bị"
                          title="Gỡ thiết bị"
                        >
                          <UserMinus className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-3 flex gap-2">
                  <select
                    value={deviceToAdd}
                    onChange={(e) => setDeviceToAdd(e.target.value)}
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  >
                    <option value="">+ Thêm thiết bị…</option>
                    {availableDevices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} · {d.phone_number}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!deviceToAdd) return;
                      await onAssignDevice(deviceToAdd);
                      setDeviceToAdd("");
                    }}
                    disabled={!deviceToAdd}
                    className="flex items-center justify-center rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-400"
                    aria-label="Gán thiết bị"
                  >
                    <UserPlus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
