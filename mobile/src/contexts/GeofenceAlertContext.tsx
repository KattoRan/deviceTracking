import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Vibration } from 'react-native';
import type { GeofenceBreachEvent } from '../models/types';
import { fetchActiveBreach } from '../services/apiService';
import { onGeofenceBreach } from '../services/socketService';

const REPEAT_VIBRATION_MS = 30_000;
const RETURNED_TOAST_MS = 4_000;
const BREACH_VIBRATION = [0, 400, 200, 400, 200, 400] as const;

interface GeofenceAlertContextValue {
  /** Persistent: set while device is outside the zone, null otherwise. */
  activeBreach: GeofenceBreachEvent | null;
  /** Short-lived: holds a 'returned' confirmation for a few seconds. */
  returnedToast: GeofenceBreachEvent | null;
  dismissReturnedToast: () => void;
}

const GeofenceAlertContext =
  createContext<GeofenceAlertContextValue | null>(null);

/**
 * Owns the device's geofence presence state. Mounted at the app root so a
 * bell button rendered inside the navigation header (and any other screen
 * that wants to show breach UI) can read the same state without each
 * subscribing its own socket listener.
 *
 * Bootstraps from /devices/:id/active-breach so a relaunched app re-shows
 * the alert immediately rather than waiting for the next inside→outside
 * transition. Re-vibrates every 30s while outside so a pocketed phone keeps
 * getting a haptic nudge.
 */
export function GeofenceAlertProvider({
  deviceId,
  children,
}: {
  deviceId: string | null;
  children: ReactNode;
}) {
  const [activeBreach, setActiveBreach] =
    useState<GeofenceBreachEvent | null>(null);
  const [returnedToast, setReturnedToast] =
    useState<GeofenceBreachEvent | null>(null);

  useEffect(() => {
    if (!deviceId) {
      setActiveBreach(null);
      return;
    }
    let cancelled = false;
    fetchActiveBreach(deviceId)
      .then((breach) => {
        if (cancelled) return;
        if (breach && breach.status === 'outside') {
          setActiveBreach(breach);
          // No vibration on bootstrap — the user just opened the app.
        }
      })
      .catch(() => {
        // Non-fatal; socket events fill in as they fire.
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  useEffect(() => {
    if (!deviceId) return;
    let returnedTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = onGeofenceBreach((event) => {
      if (event.deviceId !== deviceId) return;
      if (event.status === 'outside') {
        setActiveBreach(event);
        Vibration.vibrate([...BREACH_VIBRATION], false);
      } else {
        setActiveBreach(null);
        setReturnedToast(event);
        if (returnedTimer) clearTimeout(returnedTimer);
        returnedTimer = setTimeout(
          () => setReturnedToast(null),
          RETURNED_TOAST_MS,
        );
      }
    });
    return () => {
      unsubscribe();
      if (returnedTimer) clearTimeout(returnedTimer);
    };
  }, [deviceId]);

  // Repeat haptic cue while outside. Depend on the boolean (not the event
  // object) so each ingest-driven refresh of activeBreach doesn't reset
  // the timer halfway through its cycle.
  const isOutside = activeBreach != null;
  useEffect(() => {
    if (!isOutside) return;
    const interval = setInterval(() => {
      Vibration.vibrate([...BREACH_VIBRATION], false);
    }, REPEAT_VIBRATION_MS);
    return () => clearInterval(interval);
  }, [isOutside]);

  const value: GeofenceAlertContextValue = {
    activeBreach,
    returnedToast,
    dismissReturnedToast: () => setReturnedToast(null),
  };

  return (
    <GeofenceAlertContext.Provider value={value}>
      {children}
    </GeofenceAlertContext.Provider>
  );
}

export function useGeofenceAlert(): GeofenceAlertContextValue {
  const ctx = useContext(GeofenceAlertContext);
  if (!ctx) {
    throw new Error(
      'useGeofenceAlert must be used inside <GeofenceAlertProvider>',
    );
  }
  return ctx;
}
