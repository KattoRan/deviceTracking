"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import type { HistoryPoint } from "@/types/device";

// Above this point count, drawing one CircleMarker per waypoint becomes the
// dominant cost (each one is a DOM/canvas object with its own popup). The
// polyline already shows the path, so we sample a fixed number of waypoints.
const WAYPOINT_BUDGET = 200;

const currentIcon = L.divIcon({
  className: "",
  html: `<div style="
    width:18px;height:18px;border-radius:50%;
    background:#16a34a;border:3px solid #fff;
    box-shadow:0 0 0 2px rgba(22,163,74,0.25), 0 2px 6px rgba(15,23,42,0.25);
  "></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function FitRoute({ points }: { points: HistoryPoint[] }) {
  const map = useMap();
  const fittedKey = useRef<string | null>(null);

  useEffect(() => {
    if (points.length === 0) {
      fittedKey.current = null;
      return;
    }
    const key = `${points[0].time}-${points[points.length - 1].time}-${points.length}`;
    if (fittedKey.current === key) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lon]));
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    fittedKey.current = key;
  }, [points, map]);

  return null;
}

function FollowPoint({ point }: { point: HistoryPoint | null }) {
  const map = useMap();
  useEffect(() => {
    if (!point) return;
    // setView is instant; flyTo queues a 0.5s animation, which during fast
    // playback (4x/8x) chains animations and visibly stutters.
    map.setView([point.lat, point.lon], Math.max(map.getZoom(), 15), {
      animate: false,
    });
  }, [point, map]);
  return null;
}

function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);
  return null;
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
  const routeLatLngs: [number, number][] = useMemo(
    () => points.map((p) => [p.lat, p.lon]),
    [points],
  );
  const traveledLatLngs = useMemo(
    () => routeLatLngs.slice(0, currentIndex + 1),
    [routeLatLngs, currentIndex],
  );
  const currentPoint = points[currentIndex] ?? null;

  // Sample interior waypoints so we never draw more than WAYPOINT_BUDGET dots.
  const sampledWaypoints = useMemo(() => {
    if (points.length <= 2) return [] as Array<{ point: HistoryPoint; idx: number }>;
    const step = Math.max(1, Math.ceil((points.length - 2) / WAYPOINT_BUDGET));
    const out: Array<{ point: HistoryPoint; idx: number }> = [];
    for (let i = 1; i < points.length - 1; i += step) {
      out.push({ point: points[i], idx: i });
    }
    return out;
  }, [points]);

  return (
    <MapContainer
      center={[21.0285, 105.8542]}
      zoom={12}
      className="h-full w-full"
      zoomControl={false}
      preferCanvas
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        subdomains="abcd"
        maxZoom={19}
      />

      <InvalidateOnResize />
      <FitRoute points={points} />
      {isPlaying && currentPoint && <FollowPoint point={currentPoint} />}

      {routeLatLngs.length > 1 && (
        <Polyline
          positions={routeLatLngs}
          pathOptions={{
            color: "#94a3b8",
            weight: 3,
            opacity: 0.55,
            dashArray: "8 4",
          }}
        />
      )}

      {traveledLatLngs.length > 1 && (
        <Polyline
          positions={traveledLatLngs}
          pathOptions={{ color: "#16a34a", weight: 4, opacity: 0.95 }}
        />
      )}

      {points.length > 0 && (
        <CircleMarker
          center={[points[0].lat, points[0].lon]}
          radius={6}
          pathOptions={{
            color: "#3b82f6",
            fillColor: "#3b82f6",
            fillOpacity: 1,
          }}
        >
          <Popup>
            <div className="text-xs">
              <strong>Xuất phát</strong>
              <br />
              {new Date(points[0].time).toLocaleString("vi-VN")}
              <br />
              {points[0].district ||
                `${points[0].lat.toFixed(5)}, ${points[0].lon.toFixed(5)}`}
            </div>
          </Popup>
        </CircleMarker>
      )}

      {points.length > 1 && (
        <CircleMarker
          center={[
            points[points.length - 1].lat,
            points[points.length - 1].lon,
          ]}
          radius={6}
          pathOptions={{
            color: "#ef4444",
            fillColor: "#ef4444",
            fillOpacity: 1,
          }}
        >
          <Popup>
            <div className="text-xs">
              <strong>Kết thúc</strong>
              <br />
              {new Date(points[points.length - 1].time).toLocaleString("vi-VN")}
              <br />
              {points[points.length - 1].district ||
                `${points[points.length - 1].lat.toFixed(5)}, ${points[points.length - 1].lon.toFixed(5)}`}
            </div>
          </Popup>
        </CircleMarker>
      )}

      {currentPoint && (
        <Marker
          position={[currentPoint.lat, currentPoint.lon]}
          icon={currentIcon}
        >
          <Popup>
            <div className="text-xs">
              <strong>Vị trí hiện tại</strong>
              <br />
              {new Date(currentPoint.time).toLocaleString("vi-VN")}
              <br />
              {currentPoint.district ||
                `${currentPoint.lat.toFixed(5)}, ${currentPoint.lon.toFixed(5)}`}
            </div>
          </Popup>
        </Marker>
      )}

      {sampledWaypoints.map(({ point: p, idx }) => {
        const isPassed = idx <= currentIndex;
        return (
          <CircleMarker
            key={`${p.time}-${idx}`}
            center={[p.lat, p.lon]}
            radius={3}
            pathOptions={{
              color: isPassed ? "#16a34a" : "#94a3b8",
              fillColor: isPassed ? "#16a34a" : "#cbd5e1",
              fillOpacity: isPassed ? 0.9 : 0.6,
            }}
          >
            <Popup>
              <div className="text-xs">
                #{idx + 1} — {new Date(p.time).toLocaleTimeString("vi-VN")}
                <br />
                {p.district || `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`}
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
