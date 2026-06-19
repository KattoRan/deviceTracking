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
  owner_name: string;
  phone_number: string | null;
  model: string | null;
  device_os: string | null;
  type: string | null;
  latitude: number | null;
  longitude: number | null;
  bts_id: number | null;
  last_seen: string | null;
  last_battery: number | null;
  status: "online" | "offline";
  /** Populated in-memory from `device_moved` — not returned by list API. */
  cellTowers?: CellTowerInfo[];
  connectedBts?: ConnectedBts | null;
  /** Latest fix accuracy in metres, populated in-memory from `device_moved`. */
  accuracy?: number | null;
  /** Latest fix quality tier, populated in-memory from `device_moved`. */
  quality?: LocationQuality | null;
  /** GPS position is suspiciously far from connected BTS. */
  spoofingSuspected?: boolean;
  /** Distance (m) between GPS fix and connected BTS. */
  gpsBtsDistanceM?: number | null;
  /** Activity Recognition từ Google ML (STILL/WALKING/RUNNING/ON_BICYCLE/IN_VEHICLE). */
  activity?: Activity | null;
  /** Confidence 0-100 của activity. */
  activityConfidence?: number | null;
  /** Device is locked by admin. */
  is_locked?: boolean;
  /**
   * Timestamp (ISO) của fix GPS quality `gps`/`approx` gần nhất. Populated
   * in-memory từ `device_moved`. KHÔNG cập nhật khi nhận `device_heartbeat`
   * (chính nó là tín hiệu "không có GPS"). FE so với `last_seen` để hiện
   * badge "GPS mất N phút".
   */
  lastGpsAt?: string | null;
}

/** GET /api/v1/devices/:id */
export interface DeviceDetail {
  id: string;
  owner_name: string;
  phone_number: string | null;
  model: string | null;
  device_os: string | null;
  type: string | null;
  registered_at: string;
  status: "online" | "offline";
  last_seen: string | null;
  last_battery: number | null;
  is_locked: boolean;
  geofences: Array<{
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    radius_m: number;
  }>;
  location: {
    latitude: number;
    longitude: number;
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
  time: string;
}

export interface LocationHistory {
  device: {
    id: string;
    name: string;
    owner_name: string;
    phone_number: string | null;
  };
  from: string;
  to: string;
  total: number;
  distance_total_m: number;
  duration_ms: number;
  avg_speed_kmh: number;
  points: HistoryPoint[];
}

/**
 * Socket.IO `device_heartbeat` event — bắn khi mobile báo "còn sống" mà
 * không kèm fix GPS mới. UI dùng để:
 *   - Refresh `last_seen` + clear trạng thái offline (KHÔNG đụng lat/lon —
 *     tránh đè marker bằng dữ liệu cũ; marker giữ ở fix GPS gần nhất).
 *   - Cập nhật realtime "đang nối trạm nào" qua `cellTowers` + `connectedBts`
 *     → highlight vùng phủ sóng trên map dù marker đứng yên.
 *   - Đếm thời gian từ fix GPS cuối để hiện badge "GPS mất N phút".
 */
export interface DeviceHeartbeatEvent {
  deviceId: string;
  batteryLevel: number | null;
  timestamp: string;
  cellTowers: CellTowerInfo[];
  connectedBts: ConnectedBts | null;
  /**
   * Epoch ms của fix GPS gần nhất mobile có. Null khi mobile chưa có fix
   * (location off / airplane). FE dùng để đếm "GPS mất N phút" chính xác —
   * không bị false positive khi user đứng yên + mobile gate ingest.
   */
  lastFixAt: number | null;
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
  /** GPS position is suspiciously far from connected BTS. */
  spoofingSuspected: boolean;
  /** Distance (m) between GPS fix and connected BTS. */
  gpsBtsDistanceM: number | null;
  /** Epoch ms của fix GPS gần nhất mobile có (chính xác hơn `timestamp`). */
  lastFixAt: number | null;
  /** Activity Recognition state (Google ML). */
  activity: Activity | null;
  /** Confidence 0-100 của activity. */
  activityConfidence: number | null;
}

export type Activity =
  | "STILL"
  | "WALKING"
  | "RUNNING"
  | "ON_BICYCLE"
  | "IN_VEHICLE"
  | "UNKNOWN";
