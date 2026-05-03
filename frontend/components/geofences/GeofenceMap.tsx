"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { Fragment, useEffect, useMemo } from "react";
import {
  Circle,
  MapContainer,
  Marker,
  TileLayer,
  ZoomControl,
  useMap,
  useMapEvents,
} from "react-leaflet";
import type { GeofenceListItem } from "@/types/geofence";

const HANOI_CENTER: [number, number] = [21.0285, 105.8542];
const CARTO_VOYAGER_TILES =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

function centerIcon(active: boolean): L.DivIcon {
  return L.divIcon({
    className: "geofence-center",
    html: `<div style="
      width: 22px; height: 22px;
      border-radius: 50%;
      background: ${active ? "#059669" : "#94a3b8"};
      border: 3px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.25);
    "></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function ClickHandler({
  onClick,
}: {
  onClick: ((lat: number, lon: number) => void) | null;
}) {
  useMapEvents({
    click(e) {
      if (onClick) onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function FlyToActive({
  center,
}: {
  center: [number, number] | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (!center) return;
    map.flyTo(center, Math.max(map.getZoom(), 14), { duration: 0.6 });
  }, [center, map]);
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

interface GeofenceMapProps {
  geofences: GeofenceListItem[];
  activeId: string | null;
  /** Draft = unsaved geofence (creating). When set, renders alongside saved zones. */
  draft: { lat: number; lon: number; radiusM: number } | null;
  /** Whether map clicks should re-position the active/draft center. */
  editing: boolean;
  onCenterChange: (lat: number, lon: number) => void;
  onSelect: (id: string) => void;
}

export default function GeofenceMap({
  geofences,
  activeId,
  draft,
  editing,
  onCenterChange,
  onSelect,
}: GeofenceMapProps) {
  const activeZone = useMemo(
    () => geofences.find((g) => g.id === activeId) ?? null,
    [geofences, activeId],
  );

  const flyCenter: [number, number] | null = useMemo(() => {
    if (draft) return [draft.lat, draft.lon];
    if (activeZone) return [activeZone.lat, activeZone.lon];
    return null;
  }, [draft, activeZone]);

  return (
    <MapContainer
      center={HANOI_CENTER}
      zoom={12}
      className="h-full w-full"
      zoomControl={false}
    >
      <TileLayer
        url={CARTO_VOYAGER_TILES}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        maxZoom={19}
        subdomains="abcd"
      />
      <ZoomControl position="bottomright" />
      <InvalidateOnResize />
      <ClickHandler onClick={editing ? onCenterChange : null} />
      <FlyToActive center={flyCenter} />

      {geofences.map((g) => {
        const isActive = g.id === activeId;
        return (
          <Fragment key={g.id}>
            <Circle
              center={[g.lat, g.lon]}
              radius={g.radiusM}
              pathOptions={{
                color: isActive ? "#059669" : "#0ea5e9",
                weight: isActive ? 3 : 2,
                opacity: 0.9,
                fillColor: isActive ? "#10b981" : "#38bdf8",
                fillOpacity: isActive ? 0.18 : 0.08,
              }}
              eventHandlers={{ click: () => onSelect(g.id) }}
            />
            <Marker
              position={[g.lat, g.lon]}
              icon={centerIcon(isActive)}
              draggable={isActive && editing && !draft}
              eventHandlers={{
                click: () => onSelect(g.id),
                dragend: (e) => {
                  const m = e.target as L.Marker;
                  const { lat, lng } = m.getLatLng();
                  onCenterChange(lat, lng);
                },
              }}
            />
          </Fragment>
        );
      })}

      {draft && (
        <>
          <Circle
            center={[draft.lat, draft.lon]}
            radius={draft.radiusM}
            pathOptions={{
              color: "#f59e0b",
              weight: 3,
              opacity: 0.95,
              dashArray: "6 4",
              fillColor: "#fbbf24",
              fillOpacity: 0.15,
            }}
          />
          <Marker
            position={[draft.lat, draft.lon]}
            icon={centerIcon(true)}
            draggable={editing}
            eventHandlers={{
              dragend: (e) => {
                const m = e.target as L.Marker;
                const { lat, lng } = m.getLatLng();
                onCenterChange(lat, lng);
              },
            }}
          />
        </>
      )}
    </MapContainer>
  );
}
