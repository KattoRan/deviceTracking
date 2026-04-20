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

function deviceIcon(status: Device["status"]) {
  const color = STATUS_COLOR[status];
  return L.divIcon({
    html: `
      <div style="
        width:36px;height:36px;border-radius:50%;background:${color};
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 2px 6px rgba(15,23,42,0.25),0 0 0 2px #ffffff;
        border:2px solid #ffffff;
      ">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
          <rect x="7" y="2" width="10" height="20" rx="2" stroke="white" stroke-width="2"/>
          <circle cx="12" cy="18" r="1" fill="white"/>
        </svg>
      </div>`,
    className: "device-marker",
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18],
  });
}

interface DeviceMarkerProps {
  device: Device;
  btsStations?: BtsMapStation[];
  showBtsLine?: boolean;
  onClick?: (device: Device) => void;
}

export default function DeviceMarker({
  device,
  btsStations = [],
  showBtsLine = false,
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
        icon={deviceIcon(device.status)}
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
