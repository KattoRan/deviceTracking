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
import type { FeatureCollection, LineString, Point, Polygon } from "geojson";
import { GOONG_ATTRIBUTION, GOONG_STYLE_URL, hidePoiLayers } from "@/lib/mapTiles";
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

// Coverage chỉ vẽ cho 1 trạm được chọn → dùng 1 màu cam thống nhất, không
// phân biệt theo công nghệ (trước đây hiển thị nhiều trạm cùng lúc rất rối).
const COVERAGE_COLOR = "#d97706";

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
  showBtsLines: boolean;
  geofences: GeofenceListItem[];
  showGeofences: boolean;
  /**
   * Yêu cầu fly map tới 1 BTS (vd từ panel cell click). Mỗi click parent
   * tạo object literal mới để useEffect re-fire dù cùng cell. Set null để
   * không fly.
   */
  focusBts?: { id: number; lat: number; lon: number; range: number | null } | null;
}

export default function MapView({
  devices,
  geoJsonData,
  selectedDevice,
  onDeviceClick,
  onMapMove,
  showBts,
  showBtsLines,
  geofences,
  showGeofences,
  focusBts,
}: MapViewProps) {
  const mapRef = useRef<MapRef | null>(null);
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fittedRef = useRef(false);
  const [btsPopup, setBtsPopup] = useState<BtsPopupState | null>(null);
  const [devicePopup, setDevicePopup] = useState<DevicePopupState | null>(null);
  // Trạm BTS được chọn → vẽ vùng phủ sóng cho trạm đó. Null = không vẽ.
  // Đồng bộ với popup: mở popup trạm nào thì coverage hiện cho trạm đó.
  const [selectedBtsId, setSelectedBtsId] = useState<number | null>(null);

  // Tick để vùng phủ "GPS lost" tự bật khi qua ngưỡng 60s, không cần đợi
  // heartbeat tiếp theo về để re-render. Cũng cần thiết cho lúc selectedDevice
  // không đổi trong khi GPS vừa mới mất.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  // Khi parent yêu cầu focus 1 BTS (vd user click serving cell trong panel) →
  // fly camera tới trạm + set selectedBtsId để hiện coverage. Parent tạo object
  // literal mới mỗi click nên kể cả cùng BTS, effect vẫn re-fire.
  useEffect(() => {
    if (!focusBts) return;
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({
      center: [focusBts.lon, focusBts.lat],
      zoom: 16,
      duration: INITIAL_FLY_DURATION,
    });
    setSelectedBtsId(focusBts.id);
  }, [focusBts]);

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
      // `bts_id` là trạm "last known" từ REST list, chỉ là best-guess ban đầu.
      // Khi đã nhận `device_moved` (cellTowers !== undefined), serving cell
      // realtime là nguồn sự thật duy nhất: nếu nó chưa resolve được trạm
      // (connectedBts == null, ví dụ API tra trạm hết quota) thì KHÔNG vẽ về
      // `bts_id` nữa — nếu không sẽ kẹt một đường nối tới trạm cũ mà thiết bị
      // đã rời khỏi vùng phủ sóng. Chỉ fallback khi chưa có dữ liệu realtime.
      const hasRealtimeCells = d.cellTowers !== undefined;
      const fallback =
        !hasRealtimeCells && d.bts_id != null
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

  // BTS render qua <Marker> SVG (tháp ăng-ten) — không dùng GPU circle layer
  // vì user muốn giữ icon dấu hiệu rõ. Khi showBts=true: tất cả BTS. Khi
  // showBts=false: chỉ BTS đang kết nối (signal cho operator).
  const btsList = useMemo(() => {
    if (!geoJsonData) return [];
    return geoJsonData.features
      .filter((f) => f.properties.type === "bts" && f.properties.id != null)
      .flatMap((f) => {
        const id = f.properties.id!;
        const isConnected = connectedBtsIds.has(id);
        if (!showBts && !isConnected) return [];
        return [
          {
            id,
            lon: Number(f.geometry.coordinates[0]),
            lat: Number(f.geometry.coordinates[1]),
            radio: f.properties.radio,
            radius: coverageRadius(f.properties),
            isConnected,
          },
        ];
      });
  }, [geoJsonData, showBts, connectedBtsIds]);

  const btsCoverage = useMemo<FeatureCollection<Polygon>>(() => {
    // Chỉ vẽ vùng phủ sóng cho trạm đang chọn — hiển thị tất cả cùng lúc rất
    // rối. User click trạm nào thì hiện coverage của trạm đó.
    if (selectedBtsId == null)
      return { type: "FeatureCollection", features: [] };

    let lon: number | null = null;
    let lat: number | null = null;
    let radius = 0;
    let radio: string | null = null;

    // Ưu tiên geoJsonData (BTS trong viewport hiện tại có range chính xác).
    const target = geoJsonData?.features.find(
      (f) => f.properties.type === "bts" && f.properties.id === selectedBtsId,
    );
    if (target) {
      lon = Number(target.geometry.coordinates[0]);
      lat = Number(target.geometry.coordinates[1]);
      radius = coverageRadius(target.properties);
      radio = target.properties.radio ?? null;
    } else if (focusBts && focusBts.id === selectedBtsId) {
      // Fallback: panel cell click có thể fly tới BTS ngoài viewport vừa rồi.
      // Map sẽ refetch sau flyTo nhưng coverage cần hiện ngay.
      lon = focusBts.lon;
      lat = focusBts.lat;
      radius = focusBts.range && focusBts.range > 0 ? focusBts.range : 1000;
    }

    if (lon == null || lat == null || radius < 50)
      return { type: "FeatureCollection", features: [] };
    return {
      type: "FeatureCollection",
      features: [
        metersCircle(lon, lat, radius, { id: selectedBtsId, radius, radio }),
      ],
    };
  }, [geoJsonData, selectedBtsId, focusBts]);

  // Coverage auto cho selected device khi đang mất GPS — báo cha mẹ "thiết bị
  // đâu đó trong vùng phủ trạm này". Re-eval mỗi heartbeat (device prop đổi
  // → memo re-run) nên trong 30s không có heartbeat thì state có thể stale,
  // chấp nhận được.
  const GPS_LOST_THRESHOLD_MS = 60_000;
  const gpsLostCoverage = useMemo<FeatureCollection<Polygon>>(() => {
    if (!selectedDevice?.connectedBts || !selectedDevice.lastGpsAt)
      return { type: "FeatureCollection", features: [] };
    const lastGpsMs = new Date(selectedDevice.lastGpsAt).getTime();
    if (now - lastGpsMs <= GPS_LOST_THRESHOLD_MS)
      return { type: "FeatureCollection", features: [] };
    const bts = selectedDevice.connectedBts;
    const radius = bts.range && bts.range > 0 ? bts.range : 1000;
    return {
      type: "FeatureCollection",
      features: [
        metersCircle(bts.lon, bts.lat, radius, {
          id: bts.id,
          radius,
          radio: bts.radio,
        }),
      ],
    };
  }, [selectedDevice, now]);

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

  const handleMapClick = useCallback(() => {
    // Click vào nền (không phải BTS/Marker) — đóng popup nếu đang mở. BTS
    // click đi qua <Marker onClick>, không lọt vào đây vì stopPropagation.
    setBtsPopup(null);
    setDevicePopup(null);
    setSelectedBtsId(null);
  }, []);

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
      onLoad={(e) => {
        hidePoiLayers(e.target);
        reportBounds();
      }}
      onClick={handleMapClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      interactiveLayerIds={["bts-clusters"]}
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

      {/* Geofence vùng an toàn — xanh lá để tách biệt khỏi cam coverage */}
      <Source id="geofence-rings" type="geojson" data={geofenceRings}>
        <Layer
          id="geofence-rings-fill"
          type="fill"
          paint={{
            "fill-color": "#22c55e",
            "fill-opacity": 0.1,
          }}
        />
        <Layer
          id="geofence-rings-line"
          type="line"
          paint={{
            "line-color": "#16a34a",
            "line-width": 2,
            "line-dasharray": [6, 4],
            "line-opacity": 0.9,
          }}
        />
      </Source>

      {/* Vùng phủ trạm đang nối khi selected device đang mất GPS — hiện rõ
          hơn coverage thường để cha mẹ thấy ngay "thiết bị đâu đó trong đây". */}
      <Source id="gps-lost-coverage" type="geojson" data={gpsLostCoverage}>
        <Layer
          id="gps-lost-coverage-fill"
          type="fill"
          paint={{
            "fill-color": "#f59e0b",
            "fill-opacity": 0.18,
          }}
        />
        <Layer
          id="gps-lost-coverage-line"
          type="line"
          paint={{
            "line-color": "#d97706",
            "line-width": 2.5,
            "line-dasharray": [4, 3],
            "line-opacity": 0.9,
          }}
        />
      </Source>

      {/* BTS coverage — render TRƯỚC điểm để điểm không bị đè. Chỉ hiện cho
          trạm được chọn, dùng 1 màu cam thống nhất. */}
      <Source id="bts-coverage" type="geojson" data={btsCoverage}>
        <Layer
          id="bts-coverage-fill"
          type="fill"
          paint={{
            "fill-color": COVERAGE_COLOR,
            "fill-opacity": 0.12,
          }}
        />
        <Layer
          id="bts-coverage-line"
          type="line"
          paint={{
            "line-color": COVERAGE_COLOR,
            "line-width": 1.5,
            "line-dasharray": [6, 6],
            "line-opacity": 0.8,
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

      {/* BTS points — render qua <Marker> SVG ăng-ten, tham khảo icon cũ
          ở BtsLayer.tsx (đã xoá). Connected thì to + cam + glow nhẹ. */}
      {btsList.map((b) => (
        <MapMarker
          key={`bts-${b.id}`}
          longitude={b.lon}
          latitude={b.lat}
          anchor="center"
          style={{ zIndex: b.isConnected ? 100 : 0 }}
        >
          <button
            type="button"
            aria-label={`BTS #${b.id}`}
            title={
              b.isConnected
                ? `${b.radio || "BTS"} #${b.id} (đang kết nối)`
                : `${b.radio || "BTS"} #${b.id}`
            }
            onClick={(e) => {
              e.stopPropagation();
              setBtsPopup({
                longitude: b.lon,
                latitude: b.lat,
                id: b.id,
                radio: b.radio ?? null,
                radius: b.radius,
                isConnected: b.isConnected,
              });
              setSelectedBtsId(b.id);
              setDevicePopup(null);
            }}
            className="block bg-transparent border-0 p-0 cursor-pointer"
          >
            <BtsTowerIcon
              size={b.isConnected ? 34 : 26}
              color={b.isConnected ? "#d97706" : "#0284c7"}
              connected={b.isConnected}
            />
          </button>
        </MapMarker>
      ))}

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
        const width = selected ? 32 : 24;
        const height = width * 1.5;
        const opacity = isApprox ? 0.7 : 1;
        return (
          <MapMarker
            key={d.id}
            longitude={d.longitude}
            latitude={d.latitude}
            anchor="bottom"
            style={{ zIndex: selected ? 1000 : 1, opacity }}
          >
            <button
              type="button"
              aria-label={d.owner_name || d.phone_number || d.id}
              onClick={(e) => {
                e.stopPropagation();
                onDeviceClick(d);
                setDevicePopup({ device: d });
                setBtsPopup(null);
                setSelectedBtsId(null);
              }}
              className="block bg-transparent border-0 p-0 cursor-pointer"
              style={{ position: "relative", width, height }}
            >
              {selected && (
                <span
                  style={{
                    position: "absolute",
                    top: -6,
                    left: width / 2 - 14,
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    border: `2px solid ${color}`,
                    opacity: 0.6,
                    animation: "device-marker-pulse 1.6s ease-out infinite",
                  }}
                />
              )}
              {/* Pin teardrop có hình điện thoại bên trong (vùng tròn) */}
              <svg
                viewBox="0 0 24 36"
                width={width}
                height={height}
                style={{
                  display: "block",
                  filter: `drop-shadow(0 2px 3px rgba(15,23,42,0.35))`,
                }}
              >
                {/* Pin shape — fill màu status */}
                <path
                  d="M12 0 C5.4 0 0 5.4 0 12 C0 21 12 35 12 35 C12 35 24 21 24 12 C24 5.4 18.6 0 12 0 Z"
                  fill={color}
                  stroke={selected ? "#f59e0b" : "#fff"}
                  strokeWidth={selected ? 2 : 1.5}
                />
                {/* Smartphone trong vùng tròn của pin (center ~ (12,12)) */}
                <rect
                  x="8.5"
                  y="5"
                  width="7"
                  height="12"
                  rx="1.4"
                  fill="#fff"
                />
                {/* Màn hình */}
                <rect
                  x="9.2"
                  y="6.3"
                  width="5.6"
                  height="8.4"
                  rx="0.5"
                  fill={color}
                  opacity="0.35"
                />
                {/* Nút home */}
                <circle cx="12" cy="15.7" r="0.6" fill={color} />
              </svg>
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
          onClose={() => {
            setBtsPopup(null);
            setSelectedBtsId(null);
          }}
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
        {device.owner_name || device.phone_number}
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
    </div>
  );
}

// Icon BTS — chỉ tháp ăng-ten + sóng, không có pin teardrop bao quanh để
// gọn nhẹ, không che bản đồ. Đỉnh ăng-ten là điểm tham chiếu trên bản đồ
// (MapMarker dùng anchor="bottom").
function BtsTowerIcon({
  size,
  color,
  connected,
}: {
  size: number;
  color: string;
  connected: boolean;
}) {
  const glow = connected
    ? `drop-shadow(0 1px 2px rgba(15,23,42,0.3)) drop-shadow(0 0 4px ${color}AA)`
    : "drop-shadow(0 1px 2px rgba(15,23,42,0.25))";
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      style={{ filter: glow, display: "block" }}
    >
      {/* Halo trắng phía sau cho dễ nhìn trên nền bản đồ */}
      <path
        d="M4.5 8.5C4.5 5.46 7.46 3 12 3s7.5 2.46 7.5 5.5"
        stroke="#fff"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <path
        d="M7 11c0-2.21 2.24-4 5-4s5 1.79 5 4"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <line x1="12" y1="13" x2="12" y2="21" stroke="#fff" strokeWidth="3.5" />
      <line x1="8" y1="21" x2="16" y2="21" stroke="#fff" strokeWidth="3.5" />
      {/* Strokes màu chính ở trên */}
      <path
        d="M4.5 8.5C4.5 5.46 7.46 3 12 3s7.5 2.46 7.5 5.5"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M7 11c0-2.21 2.24-4 5-4s5 1.79 5 4"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line x1="12" y1="13" x2="12" y2="21" stroke={color} strokeWidth="2" />
      <line x1="8" y1="21" x2="16" y2="21" stroke={color} strokeWidth="2" />
      <circle cx="12" cy="13" r="1.5" fill={color} />
    </svg>
  );
}

