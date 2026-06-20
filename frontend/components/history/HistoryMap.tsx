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
import type { FeatureCollection, LineString, Point } from "geojson";
import type { MapLayerMouseEvent } from "maplibre-gl";
import { GOONG_ATTRIBUTION, GOONG_STYLE_URL, hidePoiLayers } from "@/lib/mapTiles";
import { formatDuration } from "@/lib/utils";
import type { HistoryPoint, LocationQuality } from "@/types/device";

const HANOI_CENTER = { longitude: 105.8542, latitude: 21.0285, zoom: 12 };
const WAYPOINT_BUDGET = 200;

// Tách segment khi khoảng cách thời gian giữa 2 điểm liên tiếp > 5 phút —
// đủ dài để chắc chắn tracking bị tắt (mobile gửi heartbeat mỗi 30-60s,
// gap > 5 phút = user pause/kill app rồi bật lại sau). Tránh nối "đường bay"
// B→C khi user chuyển vùng giữa 2 lần bật theo dõi.
const SEGMENT_GAP_MS = 5 * 60 * 1000;

// Stationary pause: gap thời gian 2-5 phút giữa 2 fix liên tiếp = user đứng
// yên 1 chỗ (mobile event-driven không fire location khi STILL). Render label
// "Dừng X phút" giữa 2 điểm để bù lại visual gap.
const STATIONARY_PAUSE_MIN_MS = 2 * 60 * 1000;

const QUALITY_COLORS: Record<"gps" | "approx" | "network", string> = {
  gps: "#16a34a",
  approx: "#f59e0b",
  network: "#ef4444",
};

function colorFor(quality: LocationQuality | null): string {
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

interface SegmentInfo {
  points: HistoryPoint[];
  startGlobalIdx: number;
}

interface StationaryPause {
  lat: number;
  lon: number;
  durationMs: number;
  startTime: string;
}


/**
 * Tìm các stationary pauses — đoạn user đứng yên 2-5 phút (giữa 2 fix có
 * gap thời gian trong khoảng đó, nhưng vẫn cùng segment). Render label tại
 * trung điểm 2 fix.
 */
function detectStationaryPauses(points: HistoryPoint[]): StationaryPause[] {
  const out: StationaryPause[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const gap = new Date(b.time).getTime() - new Date(a.time).getTime();
    if (gap >= STATIONARY_PAUSE_MIN_MS && gap < SEGMENT_GAP_MS) {
      out.push({
        lat: (a.lat + b.lat) / 2,
        lon: (a.lon + b.lon) / 2,
        durationMs: gap,
        startTime: a.time,
      });
    }
  }
  return out;
}

/**
 * Tách points thành các segment dựa trên gap thời gian. Mỗi segment vẽ
 * riêng một LineString, không có đường nối giữa các segment.
 */
function splitIntoSegments(points: HistoryPoint[]): SegmentInfo[] {
  if (points.length === 0) return [];
  const segs: SegmentInfo[] = [{ points: [points[0]], startGlobalIdx: 0 }];
  for (let i = 1; i < points.length; i++) {
    const gap =
      new Date(points[i].time).getTime() -
      new Date(points[i - 1].time).getTime();
    if (gap > SEGMENT_GAP_MS) {
      segs.push({ points: [points[i]], startGlobalIdx: i });
    } else {
      segs[segs.length - 1].points.push(points[i]);
    }
  }
  return segs;
}

interface HistoryMapProps {
  points: HistoryPoint[];
}

interface EndpointPopup {
  segmentIdx: number;
  kind: "start" | "end";
  point: HistoryPoint;
}

export default function HistoryMap({ points }: HistoryMapProps) {
  const mapRef = useRef<MapRef | null>(null);
  const fittedKeyRef = useRef<string | null>(null);
  const [waypointPopup, setWaypointPopup] = useState<WaypointPopup | null>(null);
  const [endpointPopup, setEndpointPopup] = useState<EndpointPopup | null>(null);

  const segments = useMemo(() => splitIntoSegments(points), [points]);
  const stationaryPauses = useMemo(() => detectStationaryPauses(points), [points]);

  // GeoJSON: mỗi segment 1 LineString — MapLibre vẽ tách bạch, không nối qua
  // gap. Dùng FeatureCollection với nhiều features hơn MultiLineString để
  // dễ debug và mở rộng (vd: color theo segment sau này).
  const routeLines = useMemo<FeatureCollection<LineString>>(() => {
    return {
      type: "FeatureCollection",
      features: segments
        .filter((s) => s.points.length >= 2)
        .map((s, idx) => ({
          type: "Feature",
          properties: { segmentIdx: idx },
          geometry: {
            type: "LineString",
            coordinates: s.points.map((p) => [p.lon, p.lat]),
          },
        })),
    };
  }, [segments]);

  // Lấy mẫu waypoint nội đoạn (bỏ start/end của mỗi segment vì đã có marker)
  // để tổng số dots không vượt budget, tránh DOM nặng khi có hàng nghìn điểm.
  const sampledWaypoints = useMemo(() => {
    const internal: Array<{ point: HistoryPoint; idx: number }> = [];
    for (const seg of segments) {
      const len = seg.points.length;
      if (len <= 2) continue;
      // Phân bổ budget theo độ dài segment
      const segBudget = Math.max(
        1,
        Math.floor((WAYPOINT_BUDGET * (len - 2)) / Math.max(1, points.length)),
      );
      const step = Math.max(1, Math.ceil((len - 2) / segBudget));
      for (let i = 1; i < len - 1; i += step) {
        internal.push({
          point: seg.points[i],
          idx: seg.startGlobalIdx + i,
        });
      }
    }
    return internal;
  }, [segments, points.length]);

  const waypointFeatures = useMemo<FeatureCollection<Point>>(() => {
    return {
      type: "FeatureCollection",
      features: sampledWaypoints.map(({ point: p, idx }) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: {
          idx,
          time: p.time,
          quality: p.quality,
          accuracy: p.accuracy,
          color: colorFor(p.quality),
        },
      })),
    };
  }, [sampledWaypoints]);

  // Fit bounds một lần cho mỗi route (key đổi mới re-fit).
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
      { padding: 60, maxZoom: 16, duration: 600 },
    );
    fittedKeyRef.current = key;
  }, [points]);

  const handleClick = useCallback((e: MapLayerMouseEvent) => {
    const hit = (e.features ?? []).find((f) => f.layer.id === "history-waypoints");
    if (hit && hit.geometry.type === "Point") {
      const p = hit.properties as {
        idx: number;
        time: string;
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
          time: p.time,
        },
      });
      setEndpointPopup(null);
      return;
    }
    setWaypointPopup(null);
  }, []);

  const setCursor = useCallback((cursor: string) => {
    const map = mapRef.current?.getMap();
    if (map) map.getCanvas().style.cursor = cursor;
  }, []);

  return (
    <div className="relative h-full w-full">
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

        {/* Đường đi — mỗi segment một LineString, không nối qua gap */}
        <Source id="history-routes" type="geojson" data={routeLines}>
          <Layer
            id="history-route-line"
            type="line"
            paint={{
              "line-color": "#16a34a",
              "line-width": 4,
              "line-opacity": 0.9,
            }}
          />
        </Source>

        {/* Waypoint dots — màu theo quality */}
        <Source id="history-waypoints-src" type="geojson" data={waypointFeatures}>
          <Layer
            id="history-waypoints"
            type="circle"
            paint={{
              "circle-radius": 3,
              "circle-color": ["get", "color"],
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 1,
              "circle-opacity": 0.9,
            }}
          />
        </Source>

        {/* Marker start/end cho TỪNG segment — gap giữa các segment lộ rõ
            bằng cặp đỏ-xanh không có line nối */}
        {segments.map((seg, segIdx) => {
          if (seg.points.length === 0) return null;
          const start = seg.points[0];
          const end = seg.points.length > 1
            ? seg.points[seg.points.length - 1]
            : null;
          return (
            <div key={segIdx}>
              <MapMarker
                longitude={start.lon}
                latitude={start.lat}
                anchor="center"
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  setEndpointPopup({ segmentIdx: segIdx, kind: "start", point: start });
                  setWaypointPopup(null);
                }}
              >
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: "#3b82f6",
                    border: "3px solid #fff",
                    boxShadow: "0 2px 6px rgba(15,23,42,0.35)",
                    cursor: "pointer",
                  }}
                  title={`Bắt đầu chặng ${segIdx + 1}`}
                />
              </MapMarker>
              {end && (
                <MapMarker
                  longitude={end.lon}
                  latitude={end.lat}
                  anchor="center"
                  onClick={(e) => {
                    e.originalEvent.stopPropagation();
                    setEndpointPopup({ segmentIdx: segIdx, kind: "end", point: end });
                    setWaypointPopup(null);
                  }}
                >
                  <div
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      background: "#ef4444",
                      border: "3px solid #fff",
                      boxShadow: "0 2px 6px rgba(15,23,42,0.35)",
                      cursor: "pointer",
                    }}
                    title={`Kết thúc chặng ${segIdx + 1}`}
                  />
                </MapMarker>
              )}
            </div>
          );
        })}

        {/* Stationary pause labels — đoạn user đứng yên 2-5 phút */}
        {stationaryPauses.map((p, i) => (
          <MapMarker
            key={`pause-${i}`}
            longitude={p.lon}
            latitude={p.lat}
            anchor="center"
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 8px",
                borderRadius: 12,
                background: "rgba(148, 163, 184, 0.95)",
                color: "white",
                fontSize: 11,
                fontWeight: 600,
                boxShadow: "0 1px 3px rgba(15,23,42,0.3)",
                whiteSpace: "nowrap",
              }}
              title={`Dừng ${formatDuration(p.durationMs)} từ ${new Date(p.startTime).toLocaleTimeString("vi-VN")}`}
            >
              ⏸ {formatDuration(p.durationMs)}
            </div>
          </MapMarker>
        ))}

        {endpointPopup && (
          <Popup
            longitude={endpointPopup.point.lon}
            latitude={endpointPopup.point.lat}
            anchor="bottom"
            offset={18}
            closeOnClick={false}
            onClose={() => setEndpointPopup(null)}
          >
            <div className="text-xs">
              <strong>
                {endpointPopup.kind === "start" ? "Bắt đầu" : "Kết thúc"} chặng{" "}
                {endpointPopup.segmentIdx + 1}
              </strong>
              <br />
              {new Date(endpointPopup.point.time).toLocaleString("vi-VN")}
              <br />
              {`${endpointPopup.point.lat.toFixed(5)}, ${endpointPopup.point.lon.toFixed(5)}`}
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
              {`${waypointPopup.point.lat.toFixed(5)}, ${waypointPopup.point.lon.toFixed(5)}`}
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

      {/* Legend — góc trên trái */}
      {points.length > 0 && (
        <div className="absolute left-3 top-3 z-10 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-md backdrop-blur">
          <div className="mb-1.5 font-semibold text-slate-700">Chú thích</div>
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-full border-2 border-white"
              style={{ background: "#3b82f6", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }}
            />
            <span className="text-slate-600">Bắt đầu chặng</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-full border-2 border-white"
              style={{ background: "#ef4444", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }}
            />
            <span className="text-slate-600">Kết thúc chặng</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="inline-block h-1 w-5 rounded" style={{ background: "#16a34a" }} />
            <span className="text-slate-600">Đường đi</span>
          </div>
          {stationaryPauses.length > 0 && (
            <div className="mt-1 flex items-center gap-2">
              <span className="rounded-full bg-slate-400 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                ⏸
              </span>
              <span className="text-slate-600">Dừng tại đây</span>
            </div>
          )}
          {(segments.length > 1 || stationaryPauses.length > 0) && (
            <div className="mt-1.5 border-t border-slate-200 pt-1.5 text-[10px] text-slate-500">
              {segments.length > 1 && `${segments.length} chặng`}
              {segments.length > 1 && stationaryPauses.length > 0 && " · "}
              {stationaryPauses.length > 0 &&
                `${stationaryPauses.length} điểm dừng`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
