export interface PairDeviceRequest {
  pairingCode: string;
  ownerName: string;
  phoneNumber?: string;
  device?: {
    model?: string;
    type?: string;
    os?: string;
  };
}

export interface PairDeviceResponse {
  deviceId: string;
  ownerName: string;
}

export interface StoredDeviceData {
  deviceId: string;
  ownerName: string;
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
  /**
   * `CellInfo.getCellConnectionStatus() === CONNECTION_PRIMARY_SERVING` —
   * cell device đang chủ động dùng (data path). Đáng tin hơn `isRegistered`.
   * Optional vì API < 28 hoặc modem cũ không báo.
   */
  isPrimary?: boolean;
}

/**
 * Unified telemetry payload. Mobile gửi cùng endpoint cả khi có lẫn không
 * có fix GPS mới.
 *
 *   - `locations` non-empty → server lưu location_history + emit device_moved.
 *   - `locations` empty/omit → server chỉ refresh last_seen + emit device_heartbeat.
 *
 * `lastFixAt` ALWAYS gửi (epoch ms của fix GPS gần nhất từ OS, kể cả nếu fix
 * đó không vào `locations` do bị movement gate) → FE biết chính xác "GPS có
 * hoạt động không".
 */
export interface IngestPayload {
  locations?: LocationData[];
  cellTowers?: CellTower[];
  /** Pin thiết bị (0-100), nếu lấy được. */
  batteryLevel?: number;
  /** Epoch ms của fix GPS gần nhất mobile thấy (KHÔNG phải lần gửi cuối). */
  lastFixAt?: number;
}

export interface IngestResponse {
  success: boolean;
  message?: string;
}

export type CommandName =
  | 'request_location_now'
  | 'ring_alarm'
  | 'lock_device';

export interface CommandDispatchEvent {
  commandId: string;
  command: CommandName;
  payload: Record<string, unknown>;
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

export type RootStackParamList = {
  Pair: undefined;
  Tracking: undefined;
};

export const PHONE_REGEX = /^(0|\+84)[0-9]{9}$/;
export const PAIRING_CODE_REGEX = /^[A-Z0-9]{3}-[A-Z0-9]{3}$/;
