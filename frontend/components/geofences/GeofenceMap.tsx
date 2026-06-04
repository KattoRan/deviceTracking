"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { MapRef, MarkerDragEvent } from "react-map-gl/maplibre";
import {
  AttributionControl,
  Map as MapGL,
  Marker as MapMarker,
  NavigationControl,
  Source,
  Layer,
} from "react-map-gl/maplibre";
import type { FeatureCollection, Polygon } from "geojson";
import type { MapLayerMouseEvent } from "maplibre-gl";
import { GOONG_ATTRIBUTION, GOONG_STYLE_URL, hidePoiLayers } from "@/lib/mapTiles";
import { metersCircle } from "@/lib/geoCircle";
import type { GeofenceListItem } from "@/types/geofence";

const HANOI_CENTER = { longitude: 105.8542, latitude: 21.0285, zoom: 12 };

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
  const mapRef = useRef<MapRef | null>(null);

  const activeZone = useMemo(
    () => geofences.find((g) => g.id === activeId) ?? null,
    [geofences, activeId],
  );

  // ─── Fly tới zone đang chỉnh / draft ───
  const flyCenter = useMemo<[number, number] | null>(() => {
    if (draft) return [draft.lon, draft.lat];
    if (activeZone) return [activeZone.lon, activeZone.lat];
    return null;
  }, [draft, activeZone]);

  useEffect(() => {
    if (!flyCenter) return;
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({
      center: flyCenter,
      zoom: Math.max(map.getZoom(), 14),
      duration: 600,
    });
  }, [flyCenter]);

  // ─── GeoJSON cho saved zones (split active / inactive để style khác nhau) ───
  const inactiveZones = useMemo<FeatureCollection<Polygon>>(() => {
    const features = geofences
      .filter((g) => g.id !== activeId)
      .map((g) =>
        metersCircle(g.lon, g.lat, g.radiusM, {
          id: g.id,
          name: g.name,
          radiusM: g.radiusM,
        }),
      );
    return { type: "FeatureCollection", features };
  }, [geofences, activeId]);

  const activeZoneRing = useMemo<FeatureCollection<Polygon>>(() => {
    if (!activeZone) return { type: "FeatureCollection", features: [] };
    return {
      type: "FeatureCollection",
      features: [
        metersCircle(activeZone.lon, activeZone.lat, activeZone.radiusM, {
          id: activeZone.id,
          name: activeZone.name,
        }),
      ],
    };
  }, [activeZone]);

  const draftRing = useMemo<FeatureCollection<Polygon>>(() => {
    if (!draft) return { type: "FeatureCollection", features: [] };
    return {
      type: "FeatureCollection",
      features: [metersCircle(draft.lon, draft.lat, draft.radiusM)],
    };
  }, [draft]);

  // ─── Click trên nền map → đặt lại tâm khi đang editing ───
  // Vẫn cho click vào vòng inactive để select zone đó — handle qua
  // interactiveLayerIds + filter trong handler.
  const handleClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const hit = (e.features ?? []).find((f) =>
        f.layer.id === "inactive-zones-fill",
      );
      if (hit) {
        const id = hit.properties?.id;
        if (typeof id === "string") {
          onSelect(id);
          return;
        }
      }
      if (editing) {
        onCenterChange(e.lngLat.lat, e.lngLat.lng);
      }
    },
    [editing, onCenterChange, onSelect],
  );

  const handleMarkerDrag = useCallback(
    (e: MarkerDragEvent) => {
      onCenterChange(e.lngLat.lat, e.lngLat.lng);
    },
    [onCenterChange],
  );

  const setCursor = useCallback((cursor: string) => {
    const map = mapRef.current?.getMap();
    if (map) map.getCanvas().style.cursor = cursor;
  }, []);

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
      interactiveLayerIds={["inactive-zones-fill"]}
      cursor={editing ? "crosshair" : "grab"}
    >
      <NavigationControl position="bottom-right" showCompass={false} />
      <AttributionControl customAttribution={GOONG_ATTRIBUTION} compact />

      {/* Saved zones — không active (xanh dương nhạt) */}
      <Source id="inactive-zones" type="geojson" data={inactiveZones}>
        <Layer
          id="inactive-zones-fill"
          type="fill"
          paint={{
            "fill-color": "#38bdf8",
            "fill-opacity": 0.08,
          }}
        />
        <Layer
          id="inactive-zones-line"
          type="line"
          paint={{
            "line-color": "#0ea5e9",
            "line-width": 2,
            "line-opacity": 0.9,
          }}
        />
      </Source>

      {/* Saved zone — active (xanh lá đậm) */}
      <Source id="active-zone" type="geojson" data={activeZoneRing}>
        <Layer
          id="active-zone-fill"
          type="fill"
          paint={{
            "fill-color": "#10b981",
            "fill-opacity": 0.18,
          }}
        />
        <Layer
          id="active-zone-line"
          type="line"
          paint={{
            "line-color": "#059669",
            "line-width": 3,
            "line-opacity": 0.9,
          }}
        />
      </Source>

      {/* Draft zone — cam đứt nét */}
      <Source id="draft-zone" type="geojson" data={draftRing}>
        <Layer
          id="draft-zone-fill"
          type="fill"
          paint={{
            "fill-color": "#fbbf24",
            "fill-opacity": 0.15,
          }}
        />
        <Layer
          id="draft-zone-line"
          type="line"
          paint={{
            "line-color": "#f59e0b",
            "line-width": 3,
            "line-dasharray": [6, 4],
            "line-opacity": 0.95,
          }}
        />
      </Source>

      {/* Center markers — saved zones (click để select; drag chỉ khi active+editing) */}
      {geofences.map((g) => {
        const isActive = g.id === activeId;
        const draggable = isActive && editing && !draft;
        return (
          <MapMarker
            key={g.id}
            longitude={g.lon}
            latitude={g.lat}
            anchor="center"
            draggable={draggable}
            onDragEnd={draggable ? handleMarkerDrag : undefined}
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              onSelect(g.id);
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: isActive ? "#059669" : "#94a3b8",
                border: "3px solid white",
                boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
                cursor: draggable ? "grab" : "pointer",
              }}
            />
          </MapMarker>
        );
      })}

      {draft && (
        <MapMarker
          longitude={draft.lon}
          latitude={draft.lat}
          anchor="center"
          draggable={editing}
          onDragEnd={editing ? handleMarkerDrag : undefined}
        >
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: "#059669",
              border: "3px solid white",
              boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
              cursor: editing ? "grab" : "default",
            }}
          />
        </MapMarker>
      )}
    </MapGL>
  );
}
