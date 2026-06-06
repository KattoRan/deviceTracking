export type PersonType = 'CHILD' | 'ELDERLY';

export interface PairDeviceRequest {
  pairingCode: string;
  personName: string;
  personType: PersonType;
  phoneNumber?: string;
  device?: {
    model?: string;
    type?: string;
    os?: string;
  };
}

export interface PairDeviceResponse {
  deviceId: string;
  personName: string;
  personType: PersonType;
}

export interface StoredDeviceData {
  deviceId: string;
  personName: string;
  personType: PersonType;
  pairedAt: string;
}

export interface SosRequest {
  lat: number;
  lon: number;
  accuracy?: number;
  batteryLevel?: number;
}

export interface SosResponse {
  sosEventId: string;
  triggeredAt: string;
}

export type RegistrationStatus = 'loading' | 'registered' | 'not_registered';

export type LocationQuality = 'gps' | 'approx' | 'network';

export interface LocationData {
  latitude: number;
  longitude: number;
  accuracy?: number;
  // Quality tier derived from `accuracy`. Producers tag every fix; consumers
  // (polyline render, geofence eval, …) decide which tiers to honour.
  quality?: LocationQuality;
  // Epoch ms when this fix was produced by the OS (or when refreshLocation
  // synthesised it). Preserved end-to-end so the server can rebuild the
  // intra-batch trajectory instead of stamping everything with `now`.
  timestamp: number;
}

export interface CellTower {
  type: string;
  mcc: number;
  mnc: number;
  lac: number;
  cid: number;
  /** null when the modem reports the cell's identity but no usable signal
   *  (e.g. WCDMA RSCP unavailable). The cell is still sent for BTS lookup. */
  signalDbm: number | null;
  rssi?: number;
  pci?: number;
  /**
   * From Android `CellInfo.isRegistered`. When available, the backend uses
   * this as the primary signal for choosing the serving cell instead of
   * guessing from signal strength.
   */
  isRegistered?: boolean;
}

export interface IngestPayload {
  // Trajectory of fixes accumulated during one send window, ordered oldest
  // → newest. Always at least one element — empty windows go through
  // `sendHeartbeat` instead so the server doesn't pollute location_history
  // with duplicate stationary fixes.
  locations: LocationData[];
  cellTowers: CellTower[];
  /** Pin thiết bị (0-100), nếu lấy được. */
  batteryLevel?: number;
}

export interface IngestResponse {
  success: boolean;
  message?: string;
}

/**
 * Tín hiệu "còn sống" khi watcher không emit fix mới trong cửa sổ gửi.
 * Server chỉ refresh `last_seen` + `last_battery`, không insert
 * `location_history` → bảng lịch sử không phình ra theo từng tick đứng yên.
 */
export interface HeartbeatPayload {
  batteryLevel?: number;
}

export interface CellTowerInfoRealtime extends CellTower {
  isServing: boolean;
}

export interface ConnectedBts {
  id: number;
  lat: number;
  lon: number;
  radio: string | null;
  range: number | null;
}

export interface DeviceMovedEvent {
  deviceId: string;
  lat: number;
  lon: number;
  accuracy: number | null;
  quality: LocationQuality | null;
  cid: number | null;
  lac: number | null;
  signalDbm: number | null;
  timestamp: string;
  cellTowers: CellTowerInfoRealtime[];
  connectedBts: ConnectedBts | null;
}

export type CommandName =
  | 'request_location_now'
  | 'ring_alarm'
  | 'toggle_tracking'
  | 'lock_device';

export interface CommandDispatchEvent {
  commandId: string;
  command: CommandName;
  payload: Record<string, unknown>;
}

export interface TrackingIntervalChangedEvent {
  intervalSec: number;
  updatedAt: string;
}

export interface GeofenceBreachEvent {
  deviceId: string;
  deviceName: string | null;
  geofenceId: string;
  geofenceName: string;
  status: 'outside' | 'returned';
  lat: number;
  lon: number;
  centerLat: number;
  centerLon: number;
  radiusM: number;
  distanceM: number;
  timestamp: string;
}

export interface DeviceDeletedEvent {
  deviceId: string;
}

export interface DeviceLockChangedEvent {
  deviceId: string;
  locked: boolean;
}

export interface CommandResultBody {
  commandId: string;
  success: boolean;
  error?: string | null;
  data?: Record<string, unknown>;
}

export interface TrackingIntervalResponse {
  intervalSec: number;
  updatedAt: string;
}

export type RootStackParamList = {
  Pair: undefined;
  Tracking: undefined;
};

export const PHONE_REGEX = /^(0|\+84)[0-9]{9}$/;
export const PAIRING_CODE_REGEX = /^[A-Z0-9]{3}-[A-Z0-9]{3}$/;
