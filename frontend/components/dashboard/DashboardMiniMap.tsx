"use client";

import "leaflet/dist/leaflet.css";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  CircleMarker,
  MapContainer,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import type { Device } from "@/types/device";

const HANOI_CENTER: [number, number] = [21.0285, 105.8542];
const CARTO_VOYAGER_TILES =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

interface MappableDevice extends Device {
  latitude: number;
  longitude: number;
}

function FitBoundsOnce({ devices }: { devices: MappableDevice[] }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current || devices.length === 0) return;
    map.fitBounds(
      devices.map((d) => [d.latitude, d.longitude]),
      { padding: [40, 40], maxZoom: 14 },
    );
    fitted.current = true;
  }, [devices, map]);

  return null;
}

function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

export default function DashboardMiniMap({ devices }: { devices: Device[] }) {
  const router = useRouter();

  const mappable = devices.filter(
    (d): d is MappableDevice => d.latitude != null && d.longitude != null,
  );

  return (
    <MapContainer
      center={HANOI_CENTER}
      zoom={11}
      scrollWheelZoom={false}
      className="h-full w-full"
    >
      <TileLayer
        url={CARTO_VOYAGER_TILES}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        maxZoom={19}
        subdomains="abcd"
      />
      <InvalidateOnResize />
      <FitBoundsOnce devices={mappable} />

      {mappable.map((d) => {
        const online = d.status === "online";
        return (
          <CircleMarker
            key={d.id}
            center={[d.latitude, d.longitude]}
            radius={7}
            pathOptions={{
              color: online ? "#059669" : "#94a3b8",
              fillColor: online ? "#10b981" : "#cbd5e1",
              fillOpacity: 0.85,
              weight: 2,
            }}
            eventHandlers={{
              click: () => router.push(`/tracking?focus=${d.id}`),
            }}
          >
            <Tooltip direction="top" offset={[0, -4]}>
              <div className="text-xs">
                <div className="font-semibold">{d.name}</div>
                <div className="text-slate-500">
                  {online ? "Trực tuyến" : "Ngoại tuyến"}
                </div>
              </div>
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
