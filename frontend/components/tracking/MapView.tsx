"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import {
  Map as MapGL,
  Marker as MapMarker,
  NavigationControl,
  Popup,
  Source,
  Layer,
  AttributionControl,
} from "react-map-gl/maplibre";
import type { MapLayerMouseEvent } from "maplibre-gl";
import type { FeatureCollection, LineString, Point, Polygon } from "geojson";
import { GOONG_ATTRIBUTION, GOONG_STYLE_URL } from "@/lib/mapTiles";
import { metersCircle } from "@/lib/geoCircle";
import type { MapBounds } from "@/services/btsService";
import type { BtsFeature, BtsGeoJson } from "@/types/bts";
import type { Device } from "@/types/device";
import type { GeofenceListItem } from "@/types/geofence";

const MOVE_DEBOUNCE_MS = 300;
// MapLibre dùng [lon, lat] khác Leaflet [lat, lon] — audit kỹ mọi chỗ tọa độ.
const HANOI_CENTER = { longitude: 105.8542, latitude: 21.0285, zoom: 12 };
const INITIAL_FLY_DURATION = 1000;

const STATUS_COLOR: Record<Device["status"], string> = {
  online: "#16a34a",
  offline: "#64748b",
};
const SPOOF_COLOR = "#dc2626";

// Bán kính phủ sóng default theo công nghệ (m). Khớp giá trị cũ BtsLayer.tsx
// để hành vi không đổi sau khi chuyển từ Leaflet sang MapLibre.
function coverageRadius(props: BtsFeature["properties"]): number {
  if (props.coverageRadius && props.coverageRadius > 0) return props.coverageRadius;
  const tech = (props.radio || "").toUpperCase();
  if (tech.includes("GSM")) return 3500;
  if (tech.includes("UMTS") || tech.includes("WCDMA")) return 1500;
  if (tech.includes("LTE")) return 800;
  if (tech.includes("NR") || tech.includes("5G")) return 500;
  return 800;
}

function techColor(radio?: string | null): string {
  const tech = (radio || "").toUpperCase();
  if (tech.includes("GSM")) return "#059669";
  if (tech.includes("UMTS") || tech.includes("WCDMA")) return "#0284c7";
  if (tech.includes("LTE")) return "#d97706";
  if (tech.includes("NR") || tech.includes("5G")) return "#dc2626";
  return "#0284c7";
}

interface BtsPopupState {
  longitude: number;
  latitude: number;
  id: number;
  radio: string | null;
  radius: number;
  isConnected: boolean;
}

interface DevicePopupState {
  device: Device;
}

interface MapViewProps {
  devices: Device[];
  geoJsonData: BtsGeoJson | null;
  selectedDevice: Device | null;
  onDeviceClick: (device: Device) => void;
  onMapMove: (bounds: MapBounds, zoom: number) => void;
  showBts: boolean;
  showCoverage: boolean;
  showBtsLines: boolean;
  geofences: GeofenceListItem[];
  showGeofences: boolean;
}

export default function MapView({
  devices,
  geoJsonData,
  selectedDevice,
  onDeviceClick,
  onMapMove,
  showBts,
  showCoverage,
  showBtsLines,
  geofences,
  showGeofences,
}: MapViewProps) {
  const mapRef = useRef<MapRef | null>(null);
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fittedRef = useRef(false);
  const [btsPopup, setBtsPopup] = useState<BtsPopupState | null>(null);
  const [devicePopup, setDevicePopup] = useState<DevicePopupState | null>(null);

  const reportBounds = useCallback(() => {
    if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
    moveTimerRef.current = setTimeout(() => {
      const map = mapRef.current;
      if (!map) return;
      const b = map.getBounds();
      onMapMove(
        {
          west: b.getWest(),
          south: b.getSouth(),
          east: b.getEast(),
          north: b.getNorth(),
        },
        map.getZoom(),
      );
    }, MOVE_DEBOUNCE_MS);
  }, [onMapMove]);

  // Lần load đầu tiên có danh sách thiết bị → fit bounds 1 lần. Không re-fit
  // khi state cập nhật (sẽ kéo map giật giật mỗi khi nhận device_moved).
  useEffect(() => {
    if (fittedRef.current) return;
    const valid = devices.filter(
      (d): d is Device & { latitude: number; longitude: number } =>
        d.latitude != null && d.longitude != null,
    );
    if (valid.length === 0) return;
    const map = mapRef.current;
    if (!map) return;
    if (valid.length === 1) {
      map.flyTo({
        center: [valid[0].longitude, valid[0].latitude],
        zoom: 14,
        duration: INITIAL_FLY_DURATION,
      });
    } else {
      const lons = valid.map((d) => d.longitude);
      const lats = valid.map((d) => d.latitude);
      map.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        { padding: 60, maxZoom: 14, duration: INITIAL_FLY_DURATION },
      );
    }
    fittedRef.current = true;
  }, [devices]);

  // Fly tới device được chọn (cả BTS nếu có) — chạy mỗi khi selectedDevice
  // hoặc tọa độ thay đổi (vì BTS có thể dời sau khi user chọn xong).
  useEffect(() => {
    if (!selectedDevice) return;
    if (selectedDevice.latitude == null || selectedDevice.longitude == null) return;
    const map = mapRef.current;
    if (!map) return;
    const btsLat = selectedDevice.connectedBts?.lat;
    const btsLon = selectedDevice.connectedBts?.lon;
    if (btsLat != null && btsLon != null) {
      const lons = [selectedDevice.longitude, btsLon];
      const lats = [selectedDevice.latitude, btsLat];
      map.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        { padding: 80, maxZoom: 17, duration: INITIAL_FLY_DURATION },
      );
    } else {
      map.flyTo({
        center: [selectedDevice.longitude, selectedDevice.latitude],
        zoom: 17,
        duration: INITIAL_FLY_DURATION,
      });
    }
    // selectedDevice không vào dependency vì ta chỉ muốn fly khi tọa độ hoặc
    // device khác — các update không liên quan (status, battery…) không nên
    // kéo map về.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedDevice?.id,
    selectedDevice?.latitude,
    selectedDevice?.longitude,
    selectedDevice?.connectedBts,
  ]);

  // ── GeoJSON sources ──
  // Mọi vòng tròn (accuracy ring, geofence, BTS coverage) đều convert sang
  // polygon qua turf rồi gom vào FeatureCollection — render 3 layer thay vì
  // hàng trăm component, GPU vẽ 1 pass.

  const accuracyRings = useMemo<FeatureCollection<Polygon>>(() => {
    const features = devices.flatMap((d) => {
      if (d.latitude == null || d.longitude == null) return [];
      if (d.status !== "online") return [];
      if (!d.quality || d.quality === "gps") return [];
      if (d.accuracy == null || d.accuracy <= 0) return [];
      const ringColor = d.quality === "network" ? "#ef4444" : "#f59e0b";
      return [
        metersCircle(d.longitude, d.latitude, d.accuracy, {
          deviceId: d.id,
          ringColor,
        }),
      ];
    });
    return { type: "FeatureCollection", features };
  }, [devices]);

  const btsLines = useMemo<FeatureCollection<LineString>>(() => {
    if (!showBtsLines) return { type: "FeatureCollection", features: [] };
    const features = devices.flatMap((d) => {
      if (d.latitude == null || d.longitude == null) return [];
      const realtime = d.connectedBts;
      const fallback =
        d.bts_id != null
          ? geoJsonData?.features.find(
              (f) =>
                f.properties.type === "bts" && f.properties.id === d.bts_id,
            )
          : undefined;
      const btsLat = realtime?.lat ?? Number(fallback?.geometry.coordinates[1]);
      const btsLon = realtime?.lon ?? Number(fallback?.geometry.coordinates[0]);
      if (!Number.isFinite(btsLat) || !Number.isFinite(btsLon)) return [];
      return [
        {
          type: "Feature" as const,
          geometry: {
            type: "LineString" as const,
            coordinates: [
              [d.longitude, d.latitude],
              [btsLon, btsLat],
            ],
          },
          properties: { realtime: !!realtime, deviceId: d.id },
        },
      ];
    });
    return { type: "FeatureCollection", features };
  }, [devices, geoJsonData, showBtsLines]);

  const geofenceRings = useMemo<FeatureCollection<Polygon>>(() => {
    if (!showGeofences) return { type: "FeatureCollection", features: [] };
    const features = geofences.map((g) =>
      metersCircle(g.lon, g.lat, g.radiusM, {
        id: g.id,
        name: g.name,
        deviceCount: g.deviceCount,
        radiusM: g.radiusM,
      }),
    );
    return { type: "FeatureCollection", features };
  }, [geofences, showGeofences]);

  // BTS: tách thành 3 nhóm để render với 3 style khác nhau:
  //   - cluster (zoom out — gom nhiều trạm)
  //   - bts thường (trạm đơn, chưa kết nối tới ai)
  //   - bts đang kết nối (highlight cam, kích thước to)
  const connectedBtsIds = useMemo(() => {
    const ids = new Set<number>();
    devices.forEach((d) => {
      if (d.connectedBts?.id != null) ids.add(d.connectedBts.id);
      else if (d.bts_id != null) ids.add(d.bts_id);
    });
    return ids;
  }, [devices]);

  const btsPoints = useMemo<FeatureCollection<Point>>(() => {
    if (!geoJsonData || !showBts) return { type: "FeatureCollection", features: [] };
    const features = geoJsonData.features
      .filter((f) => f.properties.type === "bts" && f.properties.id != null)
      .map((f) => {
        const id = f.properties.id!;
        const isConnected = connectedBtsIds.has(id);
        return {
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [
              Number(f.geometry.coordinates[0]),
              Number(f.geometry.coordinates[1]),
            ],
          },
          properties: {
            id,
            radio: f.properties.radio,
            radius: coverageRadius(f.properties),
            isConnected,
          },
        };
      });
    return { type: "FeatureCollection", features };
  }, [geoJsonData, showBts, connectedBtsIds]);

  // Connected BTS phải luôn hiển thị kể cả khi showBts=false — đây là tín hiệu
  // mạnh cho operator biết thiết bị đang nối với trạm nào. Khi showBts=true,
  // chúng đã có trong btsPoints; khi showBts=false ta render thêm 1 nguồn riêng.
  const connectedOnlyBts = useMemo<FeatureCollection<Point>>(() => {
    if (showBts || !geoJsonData)
      return { type: "FeatureCollection", features: [] };
    const features = geoJsonData.features
      .filter(
        (f) =>
          f.properties.type === "bts" &&
          f.properties.id != null &&
          connectedBtsIds.has(f.properties.id!),
      )
      .map((f) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [
            Number(f.geometry.coordinates[0]),
            Number(f.geometry.coordinates[1]),
          ],
        },
        properties: {
          id: f.properties.id!,
          radio: f.properties.radio,
          radius: coverageRadius(f.properties),
          isConnected: true,
        },
      }));
    return { type: "FeatureCollection", features };
  }, [geoJsonData, showBts, connectedBtsIds]);

  const btsCoverage = useMemo<FeatureCollection<Polygon>>(() => {
    if (!showCoverage || !geoJsonData)
      return { type: "FeatureCollection", features: [] };
    const features = geoJsonData.features
      .filter((f) => f.properties.type === "bts" && f.properties.id != null)
      .flatMap((f) => {
        const radius = coverageRadius(f.properties);
        if (radius < 50) return [];
        const id = f.properties.id!;
        const isConnected = connectedBtsIds.has(id);
        // Nếu showBts=false thì chỉ vẽ coverage cho BTS đang kết nối.
        if (!showBts && !isConnected) return [];
        return [
          metersCircle(
            Number(f.geometry.coordinates[0]),
            Number(f.geometry.coordinates[1]),
            radius,
            {
              id,
              radius,
              color: techColor(f.properties.radio),
              radio: f.properties.radio,
            },
          ),
        ];
      });
    return { type: "FeatureCollection", features };
  }, [geoJsonData, showCoverage, showBts, connectedBtsIds]);

  const clusterFeatures = useMemo<FeatureCollection<Point>>(() => {
    if (!geoJsonData || !showBts) return { type: "FeatureCollection", features: [] };
    const features = geoJsonData.features
      .filter((f) => f.properties.type === "cluster" && f.properties.count != null)
      .map((f) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [
            Number(f.geometry.coordinates[0]),
            Number(f.geometry.coordinates[1]),
          ],
        },
        properties: { count: f.properties.count! },
      }));
    return { type: "FeatureCollection", features };
  }, [geoJsonData, showBts]);

  const handleMapClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const features = e.features ?? [];
      const btsHit = features.find(
        (f) =>
          f.layer.id === "bts-points" ||
          f.layer.id === "bts-points-connected" ||
          f.layer.id === "bts-connected-only",
      );
      if (btsHit && btsHit.geometry.type === "Point") {
        const [lon, lat] = btsHit.geometry.coordinates;
        const p = btsHit.properties as {
          id: number;
          radio: string | null;
          radius: number;
          isConnected: boolean;
        };
        setBtsPopup({
          longitude: lon,
          latitude: lat,
          id: p.id,
          radio: p.radio,
          radius: p.radius,
          isConnected: !!p.isConnected,
        });
        setDevicePopup(null);
        return;
      }
      // Click vào nền — đóng popup nếu đang mở.
      setBtsPopup(null);
      setDevicePopup(null);
    },
    [],
  );

  // Đổi con trỏ thành "pointer" khi hover lên BTS để cho biết có thể click.
  const handleMouseEnter = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map) map.getCanvas().style.cursor = "pointer";
  }, []);
  const handleMouseLeave = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map) map.getCanvas().style.cursor = "";
  }, []);

  return (
    <MapGL
      ref={mapRef}
      initialViewState={HANOI_CENTER}
      mapStyle={GOONG_STYLE_URL}
      style={{ width: "100%", height: "100%" }}
      attributionControl={false}
      onMoveEnd={reportBounds}
      onLoad={reportBounds}
      onClick={handleMapClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      interactiveLayerIds={[
        "bts-points",
        "bts-points-connected",
        "bts-connected-only",
        "bts-clusters",
      ]}
      cursor="grab"
    >
      <NavigationControl position="bottom-right" showCompass={false} />
      <AttributionControl customAttribution={GOONG_ATTRIBUTION} compact />

      {/* Accuracy ring (GPS yếu) — fill+line, ring color qua data-driven */}
      <Source id="accuracy-rings" type="geojson" data={accuracyRings}>
        <Layer
          id="accuracy-rings-fill"
          type="fill"
          paint={{
            "fill-color": ["get", "ringColor"],
            "fill-opacity": 0.1,
          }}
        />
        <Layer
          id="accuracy-rings-line"
          type="line"
          paint={{
            "line-color": ["get", "ringColor"],
            "line-width": 1,
            "line-dasharray": [4, 4],
          }}
        />
      </Source>

      {/* Geofence vùng an toàn */}
      <Source id="geofence-rings" type="geojson" data={geofenceRings}>
        <Layer
          id="geofence-rings-fill"
          type="fill"
          paint={{
            "fill-color": "#fbbf24",
            "fill-opacity": 0.1,
          }}
        />
        <Layer
          id="geofence-rings-line"
          type="line"
          paint={{
            "line-color": "#f59e0b",
            "line-width": 2,
            "line-dasharray": [6, 4],
            "line-opacity": 0.9,
          }}
        />
      </Source>

      {/* BTS coverage — render TRƯỚC điểm để điểm không bị đè */}
      <Source id="bts-coverage" type="geojson" data={btsCoverage}>
        <Layer
          id="bts-coverage-fill"
          type="fill"
          paint={{
            "fill-color": ["get", "color"],
            "fill-opacity": 0.08,
          }}
        />
        <Layer
          id="bts-coverage-line"
          type="line"
          paint={{
            "line-color": ["get", "color"],
            "line-width": 1.5,
            "line-dasharray": [6, 6],
            "line-opacity": 0.7,
          }}
        />
      </Source>

      {/* BTS connection lines (device → BTS) */}
      <Source id="bts-lines" type="geojson" data={btsLines}>
        <Layer
          id="bts-lines-rendered"
          type="line"
          paint={{
            "line-color": [
              "case",
              ["get", "realtime"],
              "#2563eb",
              "#94a3b8",
            ],
            "line-width": ["case", ["get", "realtime"], 2.5, 1.5],
            "line-dasharray": [6, 4],
            "line-opacity": 0.85,
          }}
        />
      </Source>

      {/* BTS points — chia 2 lớp: thường (nhỏ, xanh) và đang kết nối (to, cam) */}
      <Source id="bts-points-src" type="geojson" data={btsPoints}>
        <Layer
          id="bts-points"
          type="circle"
          filter={["!=", ["get", "isConnected"], true]}
          paint={{
            "circle-radius": 6,
            "circle-color": "#0284c7",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          }}
        />
        <Layer
          id="bts-points-connected"
          type="circle"
          filter={["==", ["get", "isConnected"], true]}
          paint={{
            "circle-radius": 10,
            "circle-color": "#d97706",
            "circle-stroke-width": 3,
            "circle-stroke-color": "#ffffff",
          }}
        />
      </Source>

      {/* Khi showBts=false vẫn render BTS đang kết nối */}
      <Source id="bts-connected-only-src" type="geojson" data={connectedOnlyBts}>
        <Layer
          id="bts-connected-only"
          type="circle"
          paint={{
            "circle-radius": 10,
            "circle-color": "#d97706",
            "circle-stroke-width": 3,
            "circle-stroke-color": "#ffffff",
          }}
        />
      </Source>

      {/* Cluster (gom trạm khi zoom out) */}
      <Source id="bts-clusters-src" type="geojson" data={clusterFeatures}>
        <Layer
          id="bts-clusters"
          type="circle"
          paint={{
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["get", "count"],
              1, 14,
              50, 22,
              200, 28,
            ],
            "circle-color": "#0284c7",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
            "circle-opacity": 0.9,
          }}
        />
        <Layer
          id="bts-clusters-count"
          type="symbol"
          layout={{
            "text-field": ["get", "count"],
            "text-size": 12,
            "text-font": ["Roboto Regular"],
          }}
          paint={{
            "text-color": "#ffffff",
          }}
        />
      </Source>

      {/* Device markers (HTML, render bằng react-map-gl <Marker>) */}
      {devices.map((d) => {
        if (d.latitude == null || d.longitude == null) return null;
        const color = d.spoofingSuspected
          ? SPOOF_COLOR
          : STATUS_COLOR[d.status];
        const selected = selectedDevice?.id === d.id;
        const isApprox =
          d.status === "online" && d.quality != null && d.quality !== "gps";
        const size = selected ? 56 : 36;
        const opacity = isApprox ? 0.7 : 1;
        return (
          <MapMarker
            key={d.id}
            longitude={d.longitude}
            latitude={d.latitude}
            anchor="center"
            style={{ zIndex: selected ? 1000 : 1, opacity }}
          >
            <button
              type="button"
              aria-label={d.name || d.phone_number || d.id}
              onClick={(e) => {
                e.stopPropagation();
                onDeviceClick(d);
                setDevicePopup({ device: d });
                setBtsPopup(null);
              }}
              className="block bg-transparent border-0 p-0 cursor-pointer"
              style={{ position: "relative", width: size, height: size }}
            >
              {selected && (
                <span
                  style={{
                    position: "absolute",
                    inset: -10,
                    borderRadius: "50%",
                    border: `2px solid ${color}`,
                    opacity: 0.6,
                    animation:
                      "device-marker-pulse 1.6s ease-out infinite",
                  }}
                />
              )}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  width: size,
                  height: size,
                  borderRadius: "50%",
                  background: color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: selected
                    ? "0 4px 14px rgba(15,23,42,0.35), 0 0 0 4px #fff, 0 0 0 7px #f59e0b"
                    : "0 2px 6px rgba(15,23,42,0.25), 0 0 0 2px #fff",
                  border: "2px solid #fff",
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  width={selected ? 22 : 16}
                  height={selected ? 22 : 16}
                  fill="none"
                >
                  <rect
                    x="7"
                    y="2"
                    width="10"
                    height="20"
                    rx="2"
                    stroke="white"
                    strokeWidth="2"
                  />
                  <circle cx="12" cy="18" r="1" fill="white" />
                </svg>
              </div>
              {d.spoofingSuspected && (
                <div
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -4,
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: SPOOF_COLOR,
                    border: "2px solid #fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width={10}
                    height={10}
                    fill="none"
                    stroke="white"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </div>
              )}
            </button>
          </MapMarker>
        );
      })}

      {devicePopup &&
        devicePopup.device.latitude != null &&
        devicePopup.device.longitude != null && (
          <Popup
            longitude={devicePopup.device.longitude}
            latitude={devicePopup.device.latitude}
            anchor="bottom"
            offset={28}
            closeOnClick={false}
            onClose={() => setDevicePopup(null)}
          >
            <DevicePopupContent device={devicePopup.device} />
          </Popup>
        )}

      {btsPopup && (
        <Popup
          longitude={btsPopup.longitude}
          latitude={btsPopup.latitude}
          anchor="bottom"
          offset={14}
          closeOnClick={false}
          onClose={() => setBtsPopup(null)}
        >
          <div
            style={{
              minWidth: 180,
              color: "#0f172a",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            <b>BTS #{btsPopup.id}</b>
            {btsPopup.isConnected && (
              <span style={{ color: "#d97706", fontWeight: 600 }}>
                {" "}
                ● Đang kết nối
              </span>
            )}
            <br />
            <span style={{ color: "#475569" }}>Công nghệ:</span>{" "}
            <b>{btsPopup.radio || "Không rõ"}</b>
            <br />
            <span style={{ color: "#475569" }}>Bán kính:</span>{" "}
            {(btsPopup.radius / 1000).toFixed(1)} km
            <br />
            <span style={{ color: "#475569" }}>Tọa độ:</span>{" "}
            {btsPopup.latitude.toFixed(4)}, {btsPopup.longitude.toFixed(4)}
          </div>
        </Popup>
      )}
    </MapGL>
  );
}

function DevicePopupContent({ device }: { device: Device }) {
  const isApprox =
    device.status === "online" && device.quality != null && device.quality !== "gps";
  const qualityLabel =
    device.quality === "approx"
      ? "GPS yếu (≤80m)"
      : device.quality === "network"
        ? "WiFi/Cell (≤200m)"
        : device.quality === "gps"
          ? "GPS chuẩn"
          : null;
  return (
    <div style={{ minWidth: 160, color: "#0f172a" }}>
      <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>
        {device.name || device.phone_number}
      </div>
      <div style={{ fontSize: 12, marginBottom: 4, color: "#475569" }}>
        Trạng thái:{" "}
        <span style={{ color: STATUS_COLOR[device.status], fontWeight: 600 }}>
          {device.status}
        </span>
      </div>
      {device.spoofingSuspected && (
        <div
          style={{
            fontSize: 11,
            marginBottom: 4,
            color: "#dc2626",
            fontWeight: 600,
          }}
        >
          Nghi ngờ fake GPS
          {device.gpsBtsDistanceM != null
            ? ` · cách BTS ${
                device.gpsBtsDistanceM >= 1000
                  ? `${(device.gpsBtsDistanceM / 1000).toFixed(1)}km`
                  : `${device.gpsBtsDistanceM}m`
              }`
            : ""}
        </div>
      )}
      {qualityLabel && (
        <div
          style={{
            fontSize: 11,
            marginBottom: 4,
            color: isApprox ? "#b45309" : "#475569",
          }}
        >
          {qualityLabel}
          {device.accuracy != null ? ` · ±${Math.round(device.accuracy)}m` : ""}
        </div>
      )}
      {device.district && (
        <div style={{ fontSize: 11, color: "#64748b" }}>{device.district}</div>
      )}
    </div>
  );
}

