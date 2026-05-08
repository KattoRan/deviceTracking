"use client";

import L from "leaflet";
import { Marker, Polyline, Popup } from "react-leaflet";
import type { Device } from "@/types/device";

export interface BtsMapStation {
  id: number;
  latitude: number;
  longitude: number;
}

const STATUS_COLOR: Record<Device["status"], string> = {
  online: "#16a34a",
  offline: "#64748b",
};

function deviceIcon(status: Device["status"], selected: boolean) {
  const color = STATUS_COLOR[status];
  const size = selected ? 56 : 36;
  const iconSvg = selected ? 22 : 16;
  const ring = selected
    ? "box-shadow:0 4px 14px rgba(15,23,42,0.35),0 0 0 4px #ffffff,0 0 0 7px #f59e0b;"
    : "box-shadow:0 2px 6px rgba(15,23,42,0.25),0 0 0 2px #ffffff;";
  const pulse = selected
    ? `<span style="position:absolute;inset:-10px;border-radius:50%;border:2px solid ${color};opacity:0.6;animation:device-marker-pulse 1.6s ease-out infinite;"></span>`
    : "";
  return L.divIcon({
    html: `
      <div style="position:relative;width:${size}px;height:${size}px;">
        ${pulse}
        <div style="
          position:absolute;inset:0;width:${size}px;height:${size}px;border-radius:50%;background:${color};
          display:flex;align-items:center;justify-content:center;
          ${ring}
          border:2px solid #ffffff;
        ">
          <svg viewBox="0 0 24 24" width="${iconSvg}" height="${iconSvg}" fill="none">
            <rect x="7" y="2" width="10" height="20" rx="2" stroke="white" stroke-width="2"/>
            <circle cx="12" cy="18" r="1" fill="white"/>
          </svg>
        </div>
      </div>`,
    className: "device-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

interface DeviceMarkerProps {
  device: Device;
  btsStations?: BtsMapStation[];
  showBtsLine?: boolean;
  selected?: boolean;
  onClick?: (device: Device) => void;
}

export default function DeviceMarker({
  device,
  btsStations = [],
  showBtsLine = false,
  selected = false,
  onClick,
}: DeviceMarkerProps) {
  if (device.latitude == null || device.longitude == null) return null;

  // Prefer realtime BTS from socket; fall back to the list API's bts_id.
  const realtimeBts = device.connectedBts;
  const fallbackBts =
    device.bts_id != null
      ? btsStations.find((bts) => bts.id === device.bts_id)
      : undefined;
  const btsLat = realtimeBts?.lat ?? fallbackBts?.latitude;
  const btsLon = realtimeBts?.lon ?? fallbackBts?.longitude;

  return (
    <>
      {showBtsLine && btsLat != null && btsLon != null && (
        <Polyline
          positions={[
            [device.latitude, device.longitude],
            [btsLat, btsLon],
          ]}
          pathOptions={{
            color: realtimeBts ? "#2563eb" : "#94a3b8",
            weight: realtimeBts ? 2.5 : 1.5,
            opacity: 0.85,
            dashArray: "6 4",
          }}
        />
      )}

      <Marker
        position={[device.latitude, device.longitude]}
        icon={deviceIcon(device.status, selected)}
        zIndexOffset={selected ? 1000 : 0}
        eventHandlers={{
          click: (e) => {
            L.DomEvent.stopPropagation(e);
            onClick?.(device);
          },
        }}
      >
        <Popup>
          <div style={{ minWidth: 160, color: "#0f172a" }}>
            <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>
              {device.name || device.phone_number}
            </div>
            <div style={{ fontSize: 12, marginBottom: 4, color: "#475569" }}>
              Trạng thái:{" "}
              <span style={{ color: STATUS_COLOR[device.status], fontWeight: 600 }}>
                {device.status === "online" ? "online" : "offline"}
              </span>
            </div>
            {device.district && (
              <div style={{ fontSize: 11, color: "#64748b" }}>{device.district}</div>
            )}
          </div>
        </Popup>
      </Marker>
    </>
  );
}
