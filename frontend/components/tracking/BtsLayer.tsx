"use client";

import L from "leaflet";
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import type { BtsFeature, BtsGeoJson } from "@/types/bts";

type Radio = "GSM" | "UMTS" | "WCDMA" | "LTE" | "NR" | "5G" | string | null;

function techColor(radio?: Radio): string {
  const tech = (radio || "").toUpperCase();
  if (tech.includes("GSM")) return "#059669";
  if (tech.includes("UMTS") || tech.includes("WCDMA")) return "#0284c7";
  if (tech.includes("LTE")) return "#d97706";
  if (tech.includes("NR") || tech.includes("5G")) return "#dc2626";
  return "#0284c7";
}

function coverageRadius(props: BtsFeature["properties"]): number {
  if (props.coverageRadius && props.coverageRadius > 0) return props.coverageRadius;
  const tech = (props.radio || "").toUpperCase();
  if (tech.includes("GSM")) return 3500;
  if (tech.includes("UMTS") || tech.includes("WCDMA")) return 1500;
  if (tech.includes("LTE")) return 800;
  if (tech.includes("NR") || tech.includes("5G")) return 500;
  return 800;
}

function clusterIcon(count: number) {
  const size = Math.min(40, 20 + count / 3);
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;background:#0284c7;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:${Math.max(10, size / 3)}px;border:2px solid #fff;box-shadow:0 2px 8px rgba(2,132,199,0.4),0 0 0 1px rgba(15,23,42,0.08);">${count}</div>`,
    className: "cluster-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function btsIcon(isConnected: boolean) {
  const size = isConnected ? 36 : 24;
  const color = isConnected ? "#d97706" : "#0284c7";
  const glow = isConnected
    ? `filter:drop-shadow(0 1px 2px rgba(15,23,42,0.25)) drop-shadow(0 0 4px ${color}AA);`
    : `filter:drop-shadow(0 1px 2px rgba(15,23,42,0.2));`;
  return L.divIcon({
    html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" style="${glow}"><path d="M4.5 8.5C4.5 5.46 7.46 3 12 3s7.5 2.46 7.5 5.5" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/><path d="M7 11c0-2.21 2.24-4 5-4s5 1.79 5 4" stroke="#fff" stroke-width="3" stroke-linecap="round"/><line x1="12" y1="13" x2="12" y2="21" stroke="#fff" stroke-width="3.5"/><line x1="8" y1="21" x2="16" y2="21" stroke="#fff" stroke-width="3.5"/><path d="M4.5 8.5C4.5 5.46 7.46 3 12 3s7.5 2.46 7.5 5.5" stroke="${color}" stroke-width="2" stroke-linecap="round"/><path d="M7 11c0-2.21 2.24-4 5-4s5 1.79 5 4" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/><line x1="12" y1="13" x2="12" y2="21" stroke="${color}" stroke-width="2"/><line x1="8" y1="21" x2="16" y2="21" stroke="${color}" stroke-width="2"/><circle cx="12" cy="13" r="1.5" fill="${color}"/></svg>`,
    className: isConnected ? "bts-marker bts-connected" : "bts-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

interface BtsLayerProps {
  geoJson: BtsGeoJson;
  showAll: boolean;
  showCoverage: boolean;
  connectedBtsIds: Set<number>;
}

export default function BtsLayer({
  geoJson,
  showAll,
  showCoverage,
  connectedBtsIds,
}: BtsLayerProps) {
  const map = useMap();
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
    }

    const layer = L.layerGroup();

    geoJson.features.forEach((feature) => {
      const [lonRaw, latRaw] = feature.geometry.coordinates;
      const lat = Number(latRaw);
      const lon = Number(lonRaw);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

      const props = feature.properties;

      if (props.type === "cluster" && props.count != null) {
        if (!showAll) return;
        L.marker([lat, lon], { icon: clusterIcon(props.count) })
          .bindTooltip(`${props.count} trạm BTS`, { sticky: true })
          .addTo(layer);
        return;
      }

      if (props.type === "bts" && props.id != null) {
        const isConnected = connectedBtsIds.has(props.id);
        if (!showAll && !isConnected) return;

        const radius = coverageRadius(props);
        const color = techColor(props.radio);

        const marker = L.marker([lat, lon], {
          icon: btsIcon(isConnected),
          zIndexOffset: isConnected ? 1000 : 0,
        });
        const label = isConnected
          ? `${props.radio || "BTS"} #${props.id} (đang kết nối)`
          : `${props.radio || "BTS"} #${props.id}`;
        marker.bindTooltip(label, { sticky: true });
        marker.bindPopup(`
          <div style="min-width:180px;color:#0f172a;font-size:12px;line-height:1.5;">
            <b>BTS #${props.id}</b>${isConnected ? ' <span style="color:#d97706;font-weight:600;">● Đang kết nối</span>' : ""}<br/>
            <span style="color:#475569;">Công nghệ:</span> <b>${props.radio || "Không rõ"}</b><br/>
            <span style="color:#475569;">Bán kính:</span> ${(radius / 1000).toFixed(1)} km<br/>
            <span style="color:#475569;">Tọa độ:</span> ${lat.toFixed(4)}, ${lon.toFixed(4)}
          </div>`);
        marker.addTo(layer);

        if (showCoverage && radius > 50) {
          L.circle([lat, lon], {
            radius,
            color,
            fillColor: color,
            fillOpacity: 0.08,
            weight: 1.5,
            opacity: 0.7,
            dashArray: "6 6",
          })
            .bindTooltip(
              `${props.radio || "BTS"} | ${(radius / 1000).toFixed(1)} km`,
              { sticky: true, direction: "top" },
            )
            .addTo(layer);
        }
      }
    });

    layer.addTo(map);
    layerRef.current = layer;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [geoJson, map, showAll, showCoverage, connectedBtsIds]);

  return null;
}
