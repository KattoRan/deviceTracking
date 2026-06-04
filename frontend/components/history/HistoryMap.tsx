"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import {
  AttributionControl,
  Map as MapGL,
  Marker as MapMarker,
  NavigationControl,
  Popup,
  Source,
  Layer,
} from "react-map-gl/maplibre";
import type {
  Feature,
  FeatureCollection,
  LineString,
  Point,
  Polygon,
} from "geojson";
import type { MapLayerMouseEvent } from "maplibre-gl";
import { GOONG_ATTRIBUTION, GOONG_STYLE_URL, hidePoiLayers } from "@/lib/mapTiles";
import { metersCircle } from "@/lib/geoCircle";
import type { HistoryPoint, LocationQuality } from "@/types/device";

const HANOI_CENTER = { longitude: 105.8542, latitude: 21.0285, zoom: 12 };
// Above this point count, drawing one marker per waypoint becomes a DOM
// nightmare. MapLibre dùng GPU vẽ qua 1 layer nên đỡ hơn Leaflet rất nhiều
// — vẫn giữ budget này để tooltip không bị spam khi user click.
const WAYPOINT_BUDGET = 200;

// Visual encoding của quality tier trên chấm waypoint. NULL coi như 'gps'
// để dòng history persist trước migration vẫn render màu "đáng tin".
const QUALITY_COLORS: Record<
  "gps" | "approx" | "network",
  { passed: string; pending: string; fillPending: string }
> = {
  gps: { passed: "#16a34a", pending: "#94a3b8", fillPending: "#cbd5e1" },
  approx: { passed: "#f59e0b", pending: "#fbbf24", fillPending: "#fde68a" },
  network: { passed: "#ef4444", pending: "#f87171", fillPending: "#fecaca" },
};

function colorsFor(quality: LocationQuality | null) {
  return QUALITY_COLORS[quality ?? "gps"];
}

function qualityLabel(quality: LocationQuality | null): string {
  if (quality === "approx") return "Gần đúng";
  if (quality === "network") return "WiFi/Cell";
  return "GPS";
}

interface WaypointPopup {
  index: number;
  point: HistoryPoint;
}

interface HistoryMapProps {
  points: HistoryPoint[];
  currentIndex: number;
  isPlaying: boolean;
}

export default function HistoryMap({
  points,
  currentIndex,
  isPlaying,
}: HistoryMapProps) {
  const mapRef = useRef<MapRef | null>(null);
  const fittedKeyRef = useRef<string | null>(null);
  const [waypointPopup, setWaypointPopup] = useState<WaypointPopup | null>(null);
  const [endpointPopup, setEndpointPopup] = useState<"start" | "end" | null>(
    null,
  );
  const [currentPopupOpen, setCurrentPopupOpen] = useState(false);

  const currentPoint = points[currentIndex] ?? null;

  // ─── Tính trước GeoJSON ───
  // Toàn route (xám)
  const routeLine = useMemo<FeatureCollection<LineString>>(() => {
    if (points.length < 2) return { type: "FeatureCollection", features: [] };
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: points.map((p) => [p.lon, p.lat]),
          },
        },
      ],
    };
  }, [points]);

  // Phần đã đi (xanh đậm)
  const traveledLine = useMemo<FeatureCollection<LineString>>(() => {
    if (currentIndex < 1) return { type: "FeatureCollection", features: [] };
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: points
              .slice(0, currentIndex + 1)
              .map((p) => [p.lon, p.lat]),
          },
        },
      ],
    };
  }, [points, currentIndex]);

  // Lấy mẫu waypoint giữa đường (bỏ start/end)
  const sampledWaypoints = useMemo(() => {
    if (points.length <= 2) return [] as Array<{ point: HistoryPoint; idx: number }>;
    const step = Math.max(1, Math.ceil((points.length - 2) / WAYPOINT_BUDGET));
    const out: Array<{ point: HistoryPoint; idx: number }> = [];
    for (let i = 1; i < points.length - 1; i += step) {
      out.push({ point: points[i], idx: i });
    }
    return out;
  }, [points]);

  // Encode waypoint thành GeoJSON Point với thuộc tính passed/quality →
  // MapLibre data-driven style sẽ chọn màu sắc, 1 layer vẽ tất cả qua GPU.
  const waypointFeatures = useMemo<FeatureCollection<Point>>(() => {
    return {
      type: "FeatureCollection",
      features: sampledWaypoints.map(({ point: p, idx }) => {
        const palette = colorsFor(p.quality);
        const isPassed = idx <= currentIndex;
        return {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [p.lon, p.lat],
          },
          properties: {
            idx,
            time: p.time,
            district: p.district,
            quality: p.quality,
            accuracy: p.accuracy,
            color: isPassed ? palette.passed : palette.pending,
            fillColor: isPassed ? palette.passed : palette.fillPending,
            opacity: isPassed ? 0.9 : 0.6,
          },
        };
      }),
    };
  }, [sampledWaypoints, currentIndex]);

  // Accuracy ring cho điểm hiện tại (chỉ vẽ khi quality khác gps)
  const accuracyRing = useMemo<FeatureCollection<Polygon>>(() => {
    if (
      !currentPoint ||
      !currentPoint.quality ||
      currentPoint.quality === "gps" ||
      currentPoint.accuracy == null ||
      currentPoint.accuracy <= 0
    ) {
      return { type: "FeatureCollection", features: [] };
    }
    const palette = colorsFor(currentPoint.quality);
    return {
      type: "FeatureCollection",
      features: [
        metersCircle(currentPoint.lon, currentPoint.lat, currentPoint.accuracy, {
          color: palette.passed,
          fillColor: palette.fillPending,
        }),
      ] as Feature<Polygon>[],
    };
  }, [currentPoint]);

  // ─── Fit bounds 1 lần cho mỗi route (chỉ key đầu/cuối/độ dài đổi mới fit) ───
  useEffect(() => {
    if (points.length === 0) {
      fittedKeyRef.current = null;
      return;
    }
    const key = `${points[0].time}-${points[points.length - 1].time}-${points.length}`;
    if (fittedKeyRef.current === key) return;
    const map = mapRef.current;
    if (!map) return;
    const lons = points.map((p) => p.lon);
    const lats = points.map((p) => p.lat);
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 50, maxZoom: 16, duration: 600 },
    );
    fittedKeyRef.current = key;
  }, [points]);

  // ─── Follow current point khi đang play ───
  useEffect(() => {
    if (!isPlaying || !currentPoint) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    // setCenter (không animate) — playback 4x/8x gọi liên tục, animate sẽ
    // queue và giật. setCenter là instant như Leaflet `setView({ animate:false })`.
    map.setCenter([currentPoint.lon, currentPoint.lat]);
    if (map.getZoom() < 15) map.setZoom(15);
  }, [isPlaying, currentPoint]);

  // ─── Click vào waypoint → popup ───
  const handleClick = useCallback((e: MapLayerMouseEvent) => {
    const hit = (e.features ?? []).find((f) => f.layer.id === "history-waypoints");
    if (hit && hit.geometry.type === "Point") {
      const p = hit.properties as {
        idx: number;
        time: string;
        district: string | null;
        quality: LocationQuality | null;
        accuracy: number | null;
      };
      const [lon, lat] = hit.geometry.coordinates;
      setWaypointPopup({
        index: p.idx,
        point: {
          lat,
          lon,
          accuracy: p.accuracy,
          quality: p.quality,
          district: p.district,
          time: p.time,
        },
      });
      setEndpointPopup(null);
      setCurrentPopupOpen(false);
      return;
    }
    setWaypointPopup(null);
  }, []);

  const setCursor = useCallback((cursor: string) => {
    const map = mapRef.current?.getMap();
    if (map) map.getCanvas().style.cursor = cursor;
  }, []);

  const start = points[0] ?? null;
  const end = points.length > 1 ? points[points.length - 1] : null;

  return (
    <MapGL
      ref={mapRef}
      initialViewState={HANOI_CENTER}
      mapStyle={GOONG_STYLE_URL}
      style={{ width: "100%", height: "100%" }}
      attributionControl={false}
      onLoad={(e) => hidePoiLayers(e.target)}
      onClick={handleClick}
      onMouseEnter={() => setCursor("pointer")}
      onMouseLeave={() => setCursor("")}
      interactiveLayerIds={["history-waypoints"]}
    >
      <NavigationControl position="bottom-right" showCompass={false} />
      <AttributionControl customAttribution={GOONG_ATTRIBUTION} compact />

      {/* Toàn route — line dashed mờ */}
      <Source id="history-route" type="geojson" data={routeLine}>
        <Layer
          id="history-route-line"
          type="line"
          paint={{
            "line-color": "#94a3b8",
            "line-width": 3,
            "line-opacity": 0.55,
            "line-dasharray": [8, 4],
          }}
        />
      </Source>

      {/* Phần đã đi — line đậm */}
      <Source id="history-traveled" type="geojson" data={traveledLine}>
        <Layer
          id="history-traveled-line"
          type="line"
          paint={{
            "line-color": "#16a34a",
            "line-width": 4,
            "line-opacity": 0.95,
          }}
        />
      </Source>

      {/* Accuracy ring (chỉ khi current là approx/network) */}
      <Source id="history-accuracy" type="geojson" data={accuracyRing}>
        <Layer
          id="history-accuracy-fill"
          type="fill"
          paint={{
            "fill-color": ["get", "fillColor"],
            "fill-opacity": 0.18,
          }}
        />
        <Layer
          id="history-accuracy-line"
          type="line"
          paint={{
            "line-color": ["get", "color"],
            "line-width": 1,
            "line-dasharray": [4, 4],
          }}
        />
      </Source>

      {/* Waypoint dots — 1 layer GPU render */}
      <Source id="history-waypoints-src" type="geojson" data={waypointFeatures}>
        <Layer
          id="history-waypoints"
          type="circle"
          paint={{
            "circle-radius": 3,
            "circle-color": ["get", "fillColor"],
            "circle-stroke-color": ["get", "color"],
            "circle-stroke-width": 1,
            "circle-opacity": ["get", "opacity"],
          }}
        />
      </Source>

      {/* Start point — chấm xanh dương */}
      {start && (
        <MapMarker
          longitude={start.lon}
          latitude={start.lat}
          anchor="center"
          onClick={(e) => {
            e.originalEvent.stopPropagation();
            setEndpointPopup("start");
            setWaypointPopup(null);
            setCurrentPopupOpen(false);
          }}
        >
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: "#3b82f6",
              border: "2px solid #fff",
              boxShadow: "0 2px 6px rgba(15,23,42,0.3)",
              cursor: "pointer",
            }}
          />
        </MapMarker>
      )}

      {/* End point — chấm đỏ */}
      {end && (
        <MapMarker
          longitude={end.lon}
          latitude={end.lat}
          anchor="center"
          onClick={(e) => {
            e.originalEvent.stopPropagation();
            setEndpointPopup("end");
            setWaypointPopup(null);
            setCurrentPopupOpen(false);
          }}
        >
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: "#ef4444",
              border: "2px solid #fff",
              boxShadow: "0 2px 6px rgba(15,23,42,0.3)",
              cursor: "pointer",
            }}
          />
        </MapMarker>
      )}

      {/* Current point — chấm xanh lá to với ring sáng */}
      {currentPoint && (
        <MapMarker
          longitude={currentPoint.lon}
          latitude={currentPoint.lat}
          anchor="center"
          onClick={(e) => {
            e.originalEvent.stopPropagation();
            setCurrentPopupOpen(true);
            setEndpointPopup(null);
            setWaypointPopup(null);
          }}
        >
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "#16a34a",
              border: "3px solid #fff",
              boxShadow:
                "0 0 0 2px rgba(22,163,74,0.25), 0 2px 6px rgba(15,23,42,0.25)",
              cursor: "pointer",
            }}
          />
        </MapMarker>
      )}

      {endpointPopup === "start" && start && (
        <Popup
          longitude={start.lon}
          latitude={start.lat}
          anchor="bottom"
          offset={16}
          closeOnClick={false}
          onClose={() => setEndpointPopup(null)}
        >
          <div className="text-xs">
            <strong>Xuất phát</strong>
            <br />
            {new Date(start.time).toLocaleString("vi-VN")}
            <br />
            {start.district || `${start.lat.toFixed(5)}, ${start.lon.toFixed(5)}`}
          </div>
        </Popup>
      )}

      {endpointPopup === "end" && end && (
        <Popup
          longitude={end.lon}
          latitude={end.lat}
          anchor="bottom"
          offset={16}
          closeOnClick={false}
          onClose={() => setEndpointPopup(null)}
        >
          <div className="text-xs">
            <strong>Kết thúc</strong>
            <br />
            {new Date(end.time).toLocaleString("vi-VN")}
            <br />
            {end.district || `${end.lat.toFixed(5)}, ${end.lon.toFixed(5)}`}
          </div>
        </Popup>
      )}

      {currentPopupOpen && currentPoint && (
        <Popup
          longitude={currentPoint.lon}
          latitude={currentPoint.lat}
          anchor="bottom"
          offset={22}
          closeOnClick={false}
          onClose={() => setCurrentPopupOpen(false)}
        >
          <div className="text-xs">
            <strong>Vị trí hiện tại</strong>
            <br />
            {new Date(currentPoint.time).toLocaleString("vi-VN")}
            <br />
            {currentPoint.district ||
              `${currentPoint.lat.toFixed(5)}, ${currentPoint.lon.toFixed(5)}`}
            <br />
            <span className="text-slate-500">
              {qualityLabel(currentPoint.quality)}
              {currentPoint.accuracy != null
                ? ` · ±${Math.round(currentPoint.accuracy)}m`
                : ""}
            </span>
          </div>
        </Popup>
      )}

      {waypointPopup && (
        <Popup
          longitude={waypointPopup.point.lon}
          latitude={waypointPopup.point.lat}
          anchor="bottom"
          offset={10}
          closeOnClick={false}
          onClose={() => setWaypointPopup(null)}
        >
          <div className="text-xs">
            #{waypointPopup.index + 1} —{" "}
            {new Date(waypointPopup.point.time).toLocaleTimeString("vi-VN")}
            <br />
            {waypointPopup.point.district ||
              `${waypointPopup.point.lat.toFixed(5)}, ${waypointPopup.point.lon.toFixed(5)}`}
            <br />
            <span className="text-slate-500">
              {qualityLabel(waypointPopup.point.quality)}
              {waypointPopup.point.accuracy != null
                ? ` · ±${Math.round(waypointPopup.point.accuracy)}m`
                : ""}
            </span>
          </div>
        </Popup>
      )}
    </MapGL>
  );
}
