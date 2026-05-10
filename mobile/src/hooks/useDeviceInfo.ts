import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';
import type { RegistrationStatus, StoredDeviceData } from '../models/types';

/**
 * `Device.osName` is unreliable on some Samsung ROMs (returns Build.FINGERPRINT
 * instead of "Android"). Prefer the platform constant and append the numeric
 * version from expo-device.
 */
function formatOs(): string {
  const name =
    Platform.OS === 'android'
      ? 'Android'
      : Platform.OS === 'ios'
        ? 'iOS'
        : Platform.OS;
  return Device.osVersion ? `${name} ${Device.osVersion}` : name;
}

const STORAGE_KEY_DEVICE = '@deviceTracking/device';

const DEVICE_TYPE_LABEL: Record<number, string> = {
  [Device.DeviceType.PHONE]: 'smartphone',
  [Device.DeviceType.TABLET]: 'tablet',
  [Device.DeviceType.DESKTOP]: 'desktop',
  [Device.DeviceType.TV]: 'tv',
  [Device.DeviceType.UNKNOWN]: 'unknown',
};

interface DeviceInfoContextValue {
  registrationStatus: RegistrationStatus;
  storedData: StoredDeviceData | null;
  deviceModel: string;
  deviceOS: string;
  deviceType: string;
  saveDeviceData: (data: StoredDeviceData) => Promise<void>;
  clearDeviceData: () => Promise<void>;
}

const DeviceInfoContext = createContext<DeviceInfoContextValue | null>(null);

/**
 * Owns the single source of truth for registration state. Must wrap the app
 * so that App, RegisterScreen, and TrackingScreen all read/write the same
 * `registrationStatus` — without the shared store, RegisterScreen's
 * `saveDeviceData` would only flip its local copy and the auth-state
 * navigator in App.tsx would never switch screens.
 */
export function DeviceInfoProvider({ children }: { children: ReactNode }) {
  const [registrationStatus, setRegistrationStatus] =
    useState<RegistrationStatus>('loading');
  const [storedData, setStoredData] = useState<StoredDeviceData | null>(null);
  const [deviceModel, setDeviceModel] = useState('Unknown');
  const [deviceOS, setDeviceOS] = useState('Unknown');
  const [deviceType, setDeviceType] = useState('unknown');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const model = Device.modelName ?? Device.deviceName ?? 'Unknown';
      const os = formatOs();
      const type = await Device.getDeviceTypeAsync();

      if (cancelled) return;
      setDeviceModel(model);
      setDeviceOS(os);
      setDeviceType(DEVICE_TYPE_LABEL[type] ?? 'unknown');

      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY_DEVICE);
        if (cancelled) return;
        if (raw) {
          setStoredData(JSON.parse(raw) as StoredDeviceData);
          setRegistrationStatus('registered');
        } else {
          setRegistrationStatus('not_registered');
        }
      } catch {
        if (!cancelled) setRegistrationStatus('not_registered');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveDeviceData = useCallback(async (data: StoredDeviceData) => {
    await AsyncStorage.setItem(STORAGE_KEY_DEVICE, JSON.stringify(data));
    setStoredData(data);
    setRegistrationStatus('registered');
  }, []);

  const clearDeviceData = useCallback(async () => {
    await AsyncStorage.removeItem(STORAGE_KEY_DEVICE);
    setStoredData(null);
    setRegistrationStatus('not_registered');
  }, []);

  const value: DeviceInfoContextValue = {
    registrationStatus,
    storedData,
    deviceModel,
    deviceOS,
    deviceType,
    saveDeviceData,
    clearDeviceData,
  };

  return createElement(DeviceInfoContext.Provider, { value }, children);
}

export function useDeviceInfo(): DeviceInfoContextValue {
  const ctx = useContext(DeviceInfoContext);
  if (!ctx) {
    throw new Error('useDeviceInfo must be used inside <DeviceInfoProvider>');
  }
  return ctx;
}
