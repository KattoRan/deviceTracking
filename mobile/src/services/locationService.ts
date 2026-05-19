import * as Location from 'expo-location';
import type { LocationData, LocationQuality } from '../models/types';

// Tiered acceptance instead of one hard cutoff:
//   ≤ 20m  → 'gps'     real GNSS fix, fed into polyline + geofence
//   ≤ 80m  → 'approx'  degraded GPS / fused, kept for last_seen + map dot
//   ≤ 200m → 'network' WiFi/cell positioning, heartbeat only
//   > 200m → dropped entirely (no longer trustworthy as "near user")
const ACCURACY_GPS_GRADE_M = 20;
const ACCURACY_APPROX_M = 80;
const MAX_ACCEPTABLE_ACCURACY_M = 200;

function classifyQuality(accuracy: number | null | undefined): LocationQuality {
  if (accuracy == null) return 'network';
  if (accuracy <= ACCURACY_GPS_GRADE_M) return 'gps';
  if (accuracy <= ACCURACY_APPROX_M) return 'approx';
  return 'network';
}

export class LocationPermissionError extends Error {
  constructor() {
    super('Chưa được cấp quyền truy cập vị trí');
    this.name = 'LocationPermissionError';
  }
}

/**
 * Asks the user for foreground location permission. `expo-location`
 * already handles the Android/iOS difference — no PermissionsAndroid
 * plumbing needed.
 */
export async function requestLocationPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

export async function checkLocationPermission(): Promise<boolean> {
  const { status } = await Location.getForegroundPermissionsAsync();
  return status === 'granted';
}

export async function getCurrentLocation(): Promise<LocationData> {
  const granted = await checkLocationPermission();
  if (!granted) throw new LocationPermissionError();
  const { coords, timestamp } = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: coords.accuracy ?? undefined,
    quality: classifyQuality(coords.accuracy),
    timestamp: timestamp ?? Date.now(),
  };
}

export interface LocationWatcher {
  remove(): void;
}

export async function watchLocation(
  onLocation: (location: LocationData) => void,
  onError: (error: Error) => void,
): Promise<LocationWatcher> {
  const granted = await checkLocationPermission();
  if (!granted) throw new LocationPermissionError();

  try {
    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        // Tighter than before (was 10m / 10s) so the polyline captures
        // turns and short walks. Combined with the tiered quality filter
        // this gives a smoother trail without re-introducing noise: only
        // gps-grade fixes are actually drawn server-side.
        distanceInterval: 5, // metres
        timeInterval: 5_000, // ms — Android only
      },
      ({ coords, timestamp }) => {
        // Hard cutoff: fixes worse than 200m are useless even as heartbeat.
        if (
          coords.accuracy != null &&
          coords.accuracy > MAX_ACCEPTABLE_ACCURACY_M
        ) {
          return;
        }
        onLocation({
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy ?? undefined,
          quality: classifyQuality(coords.accuracy),
          timestamp: timestamp ?? Date.now(),
        });
      },
    );
    return { remove: () => subscription.remove() };
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
    return { remove: () => {} };
  }
}
