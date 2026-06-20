/**
 * Khoảng cách great-circle giữa 2 toạ độ (mét) — công thức Haversine.
 * Earth mean radius = 6_371_000m. Sai số < 0.5% cho distance < 1000km,
 * đủ chính xác cho mọi case tracking realtime (geofence, spoofing detect,
 * polyline distance).
 */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * 5 phút (ms) — ngưỡng device được coi là "online" (last_seen trong cửa sổ
 * này) hoặc trigger offline alert (last_seen vượt cửa sổ này).
 */
export const ONLINE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Pin yếu — ARM alert khi < threshold + chưa armed.
 * Hysteresis: DISARM khi ≥ reset_threshold (5% buffer để pin dao động quanh
 * 20% không ping liên tục).
 */
export const LOW_BATTERY_THRESHOLD = 20;
export const LOW_BATTERY_RESET_THRESHOLD = 25;

/**
 * Spoofing detection — GPS fix được coi là khả nghi nếu cách BTS đang kết
 * nối quá `range * SPOOF_RANGE_MULTIPLIER`. Multiplier 2x cho buffer vì
 * range BTS từ Combain là estimate, có thể lệch.
 */
export const SPOOF_RANGE_MULTIPLIER = 2;
export const DEFAULT_BTS_RANGE_M = 2_000;

/**
 * Geofence eval — trả về zone gần nhất + có nằm trong zone nào không.
 * Dùng chung giữa ingest path (mỗi fix mới) và geofences re-evaluate
 * (khi assign/remove device vào zone).
 */
export interface GeofenceCenter {
  id: string;
  name: string;
  lat: { toString(): string } | number;
  lon: { toString(): string } | number;
  radius_m: number;
}

export interface NearestZone {
  id: string;
  name: string;
  centerLat: number;
  centerLon: number;
  radiusM: number;
  distanceM: number;
}

export function evaluateGeofences(
  lat: number,
  lon: number,
  zones: GeofenceCenter[],
): { anyInside: boolean; nearest: NearestZone | null } {
  let nearest: NearestZone | null = null;
  let anyInside = false;
  for (const g of zones) {
    const centerLat = Number(g.lat);
    const centerLon = Number(g.lon);
    const distanceM = haversineMeters(lat, lon, centerLat, centerLon);
    if (distanceM <= g.radius_m) anyInside = true;
    if (nearest === null || distanceM < nearest.distanceM) {
      nearest = {
        id: g.id,
        name: g.name,
        centerLat,
        centerLon,
        radiusM: g.radius_m,
        distanceM,
      };
    }
  }
  return { anyInside, nearest };
}
