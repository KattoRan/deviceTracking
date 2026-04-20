"use client";

import "leaflet/dist/leaflet.css";

import { useEffect, useMemo, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  ZoomControl,
  useMap,
  useMapEvents,
} from "react-leaflet";
import type { MapBounds } from "@/services/btsService";
import type { BtsGeoJson } from "@/types/bts";
import type { Device } from "@/types/device";
import BtsLayer from "./BtsLayer";
import DeviceMarker, { type BtsMapStation } from "./DeviceMarker";

const MOVE_DEBOUNCE_MS = 300;
const HANOI_CENTER: [number, number] = [21.0285, 105.8542];
const CARTO_LIGHT_TILES =
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

function FlyToDevice({ device }: { device: Device }) {
  const map = useMap();
  useEffect(() => {
    if (device.latitude == null || device.longitude == null) return;
    const btsLat = device.connectedBts?.lat;
    const btsLon = device.connectedBts?.lon;
    if (btsLat != null && btsLon != null) {
      map.flyToBounds(
        [
          [device.latitude, device.longitude],
          [btsLat, btsLon],
        ],
        { padding: [80, 80], maxZoom: 17, duration: 1 },
      );
    } else {
      map.flyTo([device.latitude, device.longitude], 17, { duration: 1 });
    }
  }, [
    device.id,
    device.latitude,
    device.longitude,
    device.connectedBts,
    map,
  ]);
  return null;
}

function FitBoundsOnce({ devices }: { devices: Device[] }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current) return;
    const valid = devices.filter(
      (d): d is Device & { latitude: number; longitude: number } =>
        d.latitude != null && d.longitude != null,
    );
    if (valid.length === 0) return;
    map.fitBounds(
      valid.map((d) => [d.latitude, d.longitude]),
      { padding: [60, 60], maxZoom: 14 },
    );
    fitted.current = true;
  }, [devices, map]);

  return null;
}

interface BoundsReporterProps {
  onMapMove: (bounds: MapBounds, zoom: number) => void;
}

function BoundsReporter({ onMapMove }: BoundsReporterProps) {
  const map = useMap();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const report = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
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
  };

  useMapEvents({ moveend: report, zoomend: report });

  useEffect(() => {
    report();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

interface MapViewProps {
  devices: Device[];
  geoJsonData: BtsGeoJson | null;
  selectedDevice: Device | null;
  onDeviceClick: (device: Device) => void;
  onMapMove: (bounds: MapBounds, zoom: number) => void;
  showBts: boolean;
  showCoverage: boolean;
  showBtsLines: boolean;
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
}: MapViewProps) {
  const btsStations = useMemo<BtsMapStation[]>(() => {
    if (!geoJsonData) return [];
    return geoJsonData.features
      .filter((f) => f.properties.type === "bts" && f.properties.id != null)
      .map((f) => ({
        id: f.properties.id!,
        latitude: Number(f.geometry.coordinates[1]),
        longitude: Number(f.geometry.coordinates[0]),
      }));
  }, [geoJsonData]);

  const connectedBtsIds = useMemo(() => {
    const ids = new Set<number>();
    devices.forEach((d) => {
      if (d.connectedBts?.id != null) ids.add(d.connectedBts.id);
      else if (d.bts_id != null) ids.add(d.bts_id);
    });
    return ids;
  }, [devices]);

  return (
    <MapContainer
      center={HANOI_CENTER}
      zoom={12}
      className="h-full w-full"
      zoomControl={false}
    >
      <TileLayer
        url={CARTO_LIGHT_TILES}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        maxZoom={19}
      />
      <ZoomControl position="bottomright" />
      <InvalidateOnResize />
      <FitBoundsOnce devices={devices} />
      {selectedDevice && <FlyToDevice device={selectedDevice} />}
      <BoundsReporter onMapMove={onMapMove} />

      {geoJsonData && (
        <BtsLayer
          geoJson={geoJsonData}
          showAll={showBts}
          showCoverage={showCoverage}
          connectedBtsIds={connectedBtsIds}
        />
      )}

      {devices.map((device) => (
        <DeviceMarker
          key={device.id}
          device={device}
          btsStations={btsStations}
          showBtsLine={showBtsLines}
          onClick={onDeviceClick}
        />
      ))}
    </MapContainer>
  );
}
