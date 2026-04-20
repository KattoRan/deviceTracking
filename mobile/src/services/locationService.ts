import * as Location from 'expo-location';
import type { LocationData } from '../models/types';

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
  const { coords } = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  return { latitude: coords.latitude, longitude: coords.longitude };
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
        distanceInterval: 10, // metres
        timeInterval: 10_000, // Android only
      },
      ({ coords }) => {
        onLocation({ latitude: coords.latitude, longitude: coords.longitude });
      },
    );
    return { remove: () => subscription.remove() };
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
    return { remove: () => {} };
  }
}
