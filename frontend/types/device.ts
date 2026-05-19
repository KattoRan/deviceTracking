export interface CellTowerInfo {
  type: string;
  mcc: number;
  mnc: number;
  lac: number;
  cid: number;
  pci: number | null;
  rssi: number | null;
  signalDbm: number;
  isServing: boolean;
}

export interface ConnectedBts {
  id: number;
  lat: number;
  lon: number;
  radio: string | null;
  range: number | null;
}

/** Row in GET /api/v1/devices. */
export interface Device {
  id: string;
  name: string;
  phone_number: string;
  model: string | null;
  device_os: string | null;
  type: string | null;
  latitude: number | null;
  longitude: number | null;
  district: string | null;
  bts_id: number | null;
  last_seen: string | null;
  status: "online" | "offline";
  /** Populated in-memory from `device_moved` — not returned by list API. */
  cellTowers?: CellTowerInfo[];
  connectedBts?: ConnectedBts | null;
  /** Latest fix accuracy in metres, populated in-memory from `device_moved`. */
  accuracy?: number | null;
  /** Latest fix quality tier, populated in-memory from `device_moved`. */
  quality?: LocationQuality | null;
}

/** GET /api/v1/devices/:id */
export interface DeviceDetail {
  id: string;
  phone_number: string;
  model: string | null;
  device_os: string | null;
  type: string | null;
  registered_at: string;
  status: "online" | "offline";
  last_seen: string | null;
  owner: {
    full_name: string;
    email: string;
    address: string | null;
    citizen_id: string;
  } | null;
  location: {
    latitude: number;
    longitude: number;
    district: string | null;
    recorded_at: string;
  } | null;
  cell: {
    mcc: number | null;
    mnc: number | null;
    lac: number | null;
    cid: number | null;
    pci: number | null;
    type: string | null;
    rssi: number | null;
    signal_dbm: number | null;
    recorded_at: string;
  } | null;
  bts: {
    id: number;
    radio: string | null;
    range: number | null;
    latitude: number | null;
    longitude: number | null;
    distance_m: number | null;
  } | null;
}

export type LocationQuality = "gps" | "approx" | "network";

/**
 * Caller-selectable quality filter for `GET /devices/:id/history`. Server
 * default is `gps` — the cleanest polyline. `gps_approx` adds degraded GPS
 * fixes (≤80m); `all` includes WiFi/cell-based fixes (≤200m) too.
 */
export type HistoryQualityMode = "gps" | "gps_approx" | "all";

/** GET /api/v1/devices/:id/history */
export interface HistoryPoint {
  lat: number;
  lon: number;
  /** Horizontal accuracy radius in metres reported by the OS. */
  accuracy: number | null;
  /** Tier assigned on ingest. NULL = rows persisted before the column existed. */
  quality: LocationQuality | null;
  district: string | null;
  time: string;
}

export interface LocationHistory {
  device: {
    id: string;
    name: string;
    phone_number: string;
  };
  from: string;
  to: string;
  total: number;
  distance_total_m: number;
  duration_ms: number;
  avg_speed_kmh: number;
  points: HistoryPoint[];
}

/** Socket.IO `device_moved` event payload (from backend EventsGateway). */
export interface DeviceMovedEvent {
  deviceId: string;
  lat: number;
  lon: number;
  /** Horizontal accuracy in metres, null if device didn't report it. */
  accuracy: number | null;
  /** Tier the device assigned to this fix. Drives marker opacity / confidence ring. */
  quality: LocationQuality | null;
  cid: number | null;
  lac: number | null;
  signalDbm: number | null;
  timestamp: string;
  cellTowers: CellTowerInfo[];
  connectedBts: ConnectedBts | null;
}
