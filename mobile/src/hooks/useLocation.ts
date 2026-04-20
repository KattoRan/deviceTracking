import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LocationPermissionError,
  checkLocationPermission,
  getCurrentLocation,
  requestLocationPermission,
  watchLocation,
  type LocationWatcher,
} from '../services/locationService';
import type { LocationData } from '../models/types';

interface UseLocationResult {
  location: LocationData | null;
  error: string | null;
  hasPermission: boolean;
  isWatching: boolean;
  requestPermission: () => Promise<boolean>;
  startWatching: () => Promise<boolean>;
  stopWatching: () => void;
  refreshLocation: () => Promise<LocationData | null>;
}

function errorMessage(err: unknown): string {
  if (err instanceof LocationPermissionError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Lỗi vị trí không xác định';
}

export function useLocation(): UseLocationResult {
  const [location, setLocation] = useState<LocationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState(false);
  const [isWatching, setIsWatching] = useState(false);
  const watcherRef = useRef<LocationWatcher | null>(null);

  useEffect(() => {
    checkLocationPermission().then(setHasPermission);
  }, []);

  const requestPermission = useCallback(async () => {
    const granted = await requestLocationPermission();
    setHasPermission(granted);
    if (!granted) setError('Chưa được cấp quyền truy cập vị trí');
    return granted;
  }, []);

  const refreshLocation = useCallback(async () => {
    try {
      const current = await getCurrentLocation();
      setLocation(current);
      setError(null);
      return current;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    }
  }, []);

  const startWatching = useCallback(async () => {
    if (watcherRef.current) return true;
    const granted = hasPermission || (await requestPermission());
    if (!granted) return false;

    try {
      watcherRef.current = await watchLocation(
        (loc) => {
          setLocation(loc);
          setError(null);
        },
        (err) => setError(err.message),
      );
      setIsWatching(true);
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }, [hasPermission, requestPermission]);

  const stopWatching = useCallback(() => {
    if (watcherRef.current) {
      watcherRef.current.remove();
      watcherRef.current = null;
    }
    setIsWatching(false);
  }, []);

  useEffect(() => {
    return () => {
      if (watcherRef.current) {
        watcherRef.current.remove();
        watcherRef.current = null;
      }
    };
  }, []);

  return {
    location,
    error,
    hasPermission,
    isWatching,
    requestPermission,
    startWatching,
    stopWatching,
    refreshLocation,
  };
}
