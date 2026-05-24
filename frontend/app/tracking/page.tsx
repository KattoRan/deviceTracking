"use client";

import dynamic from "next/dynamic";
import { AnimatePresence } from "framer-motion";
import { AlertCircle, Menu } from "lucide-react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useSocket } from "@/hooks/useSocket";
import deviceService from "@/services/deviceService";
import btsService, { type MapBounds } from "@/services/btsService";
import geofenceService from "@/services/geofenceService";
import type { BtsGeoJson } from "@/types/bts";
import type { Device, DeviceMovedEvent } from "@/types/device";
import type { GeofenceListItem } from "@/types/geofence";

const MapView = dynamic(() => import("@/components/tracking/MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-slate-100">
      <div className="text-sm text-slate-500">Đang tải bản đồ...</div>
    </div>
  ),
});

const MapControls = dynamic(
  () => import("@/components/tracking/MapControls"),
  { ssr: false },
);

const DeviceSidebar = dynamic(
  () => import("@/components/tracking/DeviceSidebar"),
  { ssr: false },
);

const DeviceDetailPanel = dynamic(
  () => import("@/components/tracking/DeviceDetailPanel"),
  { ssr: false },
);

const TrackingIntervalControl = dynamic(
  () => import("@/components/tracking/TrackingIntervalControl"),
  { ssr: false },
);

function TrackingPageInner() {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const isTablet = useMediaQuery("(min-width: 768px) and (max-width: 1023px)");
  const searchParams = useSearchParams();
  const focusDeviceId = searchParams.get("focus");

  const [devices, setDevices] = useState<Device[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showBts, setShowBts] = useState(true);
  const [showCoverage, setShowCoverage] = useState(false);
  const [showBtsLines, setShowBtsLines] = useState(true);
  const [geoJsonData, setGeoJsonData] = useState<BtsGeoJson | null>(null);
  const [btsLoading, setBtsLoading] = useState(false);
  const [geofences, setGeofences] = useState<GeofenceListItem[]>([]);
  const [showGeofences, setShowGeofences] = useState(true);

  const handleDeviceMoved = useCallback((event: DeviceMovedEvent) => {
    const patch: Partial<Device> = {
      latitude: event.lat,
      longitude: event.lon,
      accuracy: event.accuracy,
      quality: event.quality,
      last_seen: event.timestamp,
      status: "online",
      cellTowers: event.cellTowers,
      connectedBts: event.connectedBts,
      spoofingSuspected: event.spoofingSuspected,
      gpsBtsDistanceM: event.gpsBtsDistanceM,
    };
    setDevices((prev) =>
      prev.map((d) => (d.id === event.deviceId ? { ...d, ...patch } : d)),
    );
    setSelectedDevice((prev) =>
      prev && prev.id === event.deviceId ? { ...prev, ...patch } : prev,
    );
  }, []);
  useSocket(handleDeviceMoved);

  useEffect(() => {
    if (isMobile || isTablet) setSidebarOpen(false);
    else setSidebarOpen(true);
  }, [isMobile, isTablet]);

  useEffect(() => {
    let cancelled = false;
    setDevicesLoading(true);
    setDevicesError(null);
    deviceService
      .getAll()
      .then((data) => {
        if (!cancelled) setDevices(data);
      })
      .catch(() => {
        if (!cancelled) setDevicesError("Không tải được danh sách thiết bị");
      })
      .finally(() => {
        if (!cancelled) setDevicesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Deep-link from a geofence breach toast (`/tracking?focus=<id>`):
  // pick the device once it's in the loaded list. MapView's `FlyToDevice`
  // then takes over and pans the map to it.
  useEffect(() => {
    if (!focusDeviceId || devices.length === 0) return;
    const target = devices.find((d) => d.id === focusDeviceId);
    if (target) setSelectedDevice(target);
  }, [focusDeviceId, devices]);

  // Geofences are admin-managed and rarely change; load once on mount.
  useEffect(() => {
    let cancelled = false;
    geofenceService
      .list()
      .then((data) => {
        if (!cancelled) setGeofences(data);
      })
      .catch(() => {
        // Non-fatal — the rest of the page still works without zones.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Serialize BTS map requests so the latest bbox/zoom always wins — without
  // this a slow in-flight response can overwrite a newer one.
  const btsRequestId = useRef(0);
  const handleMapMove = useCallback(async (bounds: MapBounds, zoom: number) => {
    const id = ++btsRequestId.current;
    setBtsLoading(true);
    try {
      const data = await btsService.getMapData(bounds, zoom);
      if (id === btsRequestId.current) setGeoJsonData(data);
    } catch {
      // Map stays on last good data; a new move will retry.
    } finally {
      if (id === btsRequestId.current) setBtsLoading(false);
    }
  }, []);

  const handleLockChange = useCallback(
    (deviceId: string, locked: boolean) => {
      setDevices((prev) =>
        prev.map((d) => (d.id === deviceId ? { ...d, is_locked: locked } : d)),
      );
      setSelectedDevice((prev) =>
        prev && prev.id === deviceId ? { ...prev, is_locked: locked } : prev,
      );
    },
    [],
  );

  const handleDeviceSelect = useCallback(
    (device: Device) => {
      setSelectedDevice(device);
      if (isMobile) setSidebarOpen(false);
    },
    [isMobile],
  );

  const mappableDevices = devices.filter(
    (d) => d.latitude != null && d.longitude != null,
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden bg-slate-100">
      <DeviceSidebar
        devices={devices}
        selectedDevice={selectedDevice}
        onDeviceSelect={handleDeviceSelect}
        loading={devicesLoading}
        open={sidebarOpen}
        onToggle={setSidebarOpen}
        isMobile={isMobile}
      />

      <div className="relative flex-1">
        {!sidebarOpen && (
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Mở danh sách thiết bị"
            className="absolute left-4 top-4 z-[1001] rounded-lg border border-slate-200 bg-white p-2 text-slate-600 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900 lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}

        <MapView
          devices={mappableDevices}
          geoJsonData={geoJsonData}
          selectedDevice={selectedDevice}
          onDeviceClick={setSelectedDevice}
          onMapMove={handleMapMove}
          showBts={showBts}
          showCoverage={showCoverage}
          showBtsLines={showBtsLines}
          geofences={geofences}
          showGeofences={showGeofences}
        />

        <MapControls
          showBts={showBts}
          onToggleBts={() => setShowBts((v) => !v)}
          showCoverage={showCoverage}
          onToggleCoverage={() => setShowCoverage((v) => !v)}
          showBtsLines={showBtsLines}
          onToggleBtsLines={() => setShowBtsLines((v) => !v)}
          showGeofences={showGeofences}
          onToggleGeofences={() => setShowGeofences((v) => !v)}
        />

        <TrackingIntervalControl />

        <AnimatePresence>
          {selectedDevice && (
            <DeviceDetailPanel
              key={selectedDevice.id}
              device={selectedDevice}
              onClose={() => setSelectedDevice(null)}
              isMobile={isMobile}
              onLockChange={handleLockChange}
            />
          )}
        </AnimatePresence>

        {btsLoading && (
          <div className="absolute left-1/2 top-4 z-[1000] -translate-x-1/2 rounded-lg border border-slate-200 bg-white/95 px-3 py-1.5 text-sm text-slate-700 shadow-sm">
            Đang tải BTS...
          </div>
        )}

        {geoJsonData?.meta?.truncated && (
          <div className="absolute bottom-4 left-1/2 z-[1000] -translate-x-1/2 whitespace-nowrap rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-700 shadow-sm">
            Chỉ hiển thị {geoJsonData.meta.displayed}/{geoJsonData.meta.total} trạm.
            Hãy zoom để xem chi tiết hơn.
          </div>
        )}

        {devicesError && (
          <div className="absolute left-1/2 top-4 z-[1000] -translate-x-1/2 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-700 shadow-sm">
            <AlertCircle className="h-4 w-4" />
            {devicesError}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TrackingPage() {
  return (
    <Suspense fallback={null}>
      <TrackingPageInner />
    </Suspense>
  );
}
