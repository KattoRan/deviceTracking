"use client";

import dynamic from "next/dynamic";
import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import deviceService from "@/services/deviceService";
import geofenceService from "@/services/geofenceService";
import type { Device } from "@/types/device";
import type {
  GeofenceDetail,
  GeofenceListItem,
} from "@/types/geofence";
import type { DraftGeofence } from "@/components/geofences/GeofencePanel";

const GeofenceMap = dynamic(
  () => import("@/components/geofences/GeofenceMap"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-slate-100">
        <div className="text-sm text-slate-500">Đang tải bản đồ…</div>
      </div>
    ),
  },
);

const GeofencePanel = dynamic(
  () => import("@/components/geofences/GeofencePanel"),
  { ssr: false },
);

const HANOI_CENTER = { lat: 21.0285, lon: 105.8542 };
const DEFAULT_RADIUS_M = 200;

function extractError(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err) && err.response?.data) {
    const data = err.response.data;
    if (typeof data === "object" && data && "message" in data) {
      const msg = (data as { message: unknown }).message;
      if (typeof msg === "string") return msg;
      if (Array.isArray(msg) && msg.length > 0) return String(msg[0]);
    }
  }
  return fallback;
}

export default function GeofencesPage() {
  const [geofences, setGeofences] = useState<GeofenceListItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeDetail, setActiveDetail] = useState<GeofenceDetail | null>(null);
  const [draft, setDraft] = useState<DraftGeofence | null>(null);
  const [editingExisting, setEditingExisting] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshGeofences = useCallback(async () => {
    try {
      const list = await geofenceService.list();
      setGeofences(list);
    } catch (err) {
      setError(extractError(err, "Không tải được danh sách vùng"));
    }
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const list = await deviceService.getAll();
      setDevices(list);
    } catch (err) {
      setError(extractError(err, "Không tải được danh sách thiết bị"));
    }
  }, []);

  useEffect(() => {
    refreshGeofences();
    refreshDevices();
  }, [refreshGeofences, refreshDevices]);

  // Whenever the selection changes, fetch full detail (with devices array).
  useEffect(() => {
    if (!activeId) {
      setActiveDetail(null);
      setEditingExisting(false);
      return;
    }
    let alive = true;
    setLoadingDetail(true);
    geofenceService
      .get(activeId)
      .then((d) => {
        if (alive) setActiveDetail(d);
      })
      .catch((err) => {
        if (alive) setError(extractError(err, "Không tải được chi tiết vùng"));
      })
      .finally(() => {
        if (alive) setLoadingDetail(false);
      });
    return () => {
      alive = false;
    };
  }, [activeId]);

  const isCreating = !!draft && !activeId;
  const editing = isCreating || editingExisting;

  function handleSelect(id: string | null) {
    if (draft || editingExisting) {
      // Block selection mid-edit so unsaved changes aren't silently lost.
      return;
    }
    setActiveId(id);
  }

  function handleCreateNew() {
    setActiveId(null);
    setActiveDetail(null);
    setEditingExisting(false);
    setDraft({
      name: "",
      lat: HANOI_CENTER.lat,
      lon: HANOI_CENTER.lon,
      radiusM: DEFAULT_RADIUS_M,
    });
  }

  function handleStartEdit() {
    if (!activeDetail) return;
    setDraft({
      name: activeDetail.name,
      lat: activeDetail.lat,
      lon: activeDetail.lon,
      radiusM: activeDetail.radiusM,
    });
    setEditingExisting(true);
  }

  function handleDiscard() {
    setDraft(null);
    setEditingExisting(false);
  }

  function handleCenterChange(lat: number, lon: number) {
    if (!editing) return;
    setDraft((prev) => {
      if (prev) return { ...prev, lat, lon };
      if (activeDetail) {
        return {
          name: activeDetail.name,
          lat,
          lon,
          radiusM: activeDetail.radiusM,
        };
      }
      return prev;
    });
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      if (isCreating) {
        const created = await geofenceService.create({
          name: draft.name.trim(),
          lat: draft.lat,
          lon: draft.lon,
          radiusM: draft.radiusM,
        });
        setActiveDetail(created);
        setActiveId(created.id);
        setDraft(null);
        setEditingExisting(false);
      } else if (activeDetail) {
        const updated = await geofenceService.update(activeDetail.id, {
          name: draft.name.trim(),
          lat: draft.lat,
          lon: draft.lon,
          radiusM: draft.radiusM,
        });
        setActiveDetail(updated);
        setDraft(null);
        setEditingExisting(false);
      }
      await refreshGeofences();
    } catch (err) {
      setError(extractError(err, "Không lưu được vùng giám sát"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await geofenceService.remove(id);
      setActiveId(null);
      setActiveDetail(null);
      setDraft(null);
      setEditingExisting(false);
      await Promise.all([refreshGeofences(), refreshDevices()]);
    } catch (err) {
      setError(extractError(err, "Không xoá được vùng"));
    }
  }

  async function handleAssignDevice(deviceId: string) {
    if (!activeDetail) return;
    setError(null);
    try {
      const updated = await geofenceService.assignDevice(
        activeDetail.id,
        deviceId,
      );
      setActiveDetail(updated);
      await Promise.all([refreshGeofences(), refreshDevices()]);
    } catch (err) {
      setError(extractError(err, "Không gán được thiết bị"));
    }
  }

  async function handleDetachDevice(deviceId: string) {
    if (!activeDetail) return;
    setError(null);
    try {
      const updated = await geofenceService.detachDevice(
        activeDetail.id,
        deviceId,
      );
      setActiveDetail(updated);
      await Promise.all([refreshGeofences(), refreshDevices()]);
    } catch (err) {
      setError(extractError(err, "Không gỡ được thiết bị"));
    }
  }

  // Map renders saved zones plus, when creating/editing, the live draft on top
  // so admins see the new zone before it hits the database.
  const draftForMap = draft
    ? { lat: draft.lat, lon: draft.lon, radiusM: draft.radiusM }
    : null;

  // While editing an existing zone, hide the saved circle from the rendered
  // list so it doesn't fight visually with the orange dashed draft circle.
  const visibleZones = editingExisting
    ? geofences.filter((g) => g.id !== activeDetail?.id)
    : geofences;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col md:flex-row">
      <GeofencePanel
        geofences={geofences}
        activeDetail={activeDetail}
        draft={draft}
        editing={editing}
        loadingDetail={loadingDetail}
        saving={saving}
        devices={devices}
        onSelect={handleSelect}
        onCreateNew={handleCreateNew}
        onDraftChange={setDraft}
        onDiscard={handleDiscard}
        onSave={handleSave}
        onStartEdit={handleStartEdit}
        onDelete={handleDelete}
        onAssignDevice={handleAssignDevice}
        onDetachDevice={handleDetachDevice}
      />

      <div className="relative flex-1">
        <GeofenceMap
          geofences={visibleZones}
          activeId={activeId}
          draft={draftForMap}
          editing={editing}
          onCenterChange={handleCenterChange}
          onSelect={(id) => handleSelect(id)}
        />
        {error && (
          <div
            role="alert"
            className="pointer-events-auto absolute left-1/2 top-4 z-[400] max-w-md -translate-x-1/2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 shadow-md"
          >
            <button
              type="button"
              onClick={() => setError(null)}
              className="float-right ml-3 text-red-400 hover:text-red-600"
              aria-label="Đóng"
            >
              ×
            </button>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
