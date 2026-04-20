import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { useCallback, useEffect, useState } from 'react';
import type { RegistrationStatus, StoredDeviceData } from '../models/types';

const STORAGE_KEY_DEVICE = '@deviceTracking/device';

const DEVICE_TYPE_LABEL: Record<number, string> = {
  [Device.DeviceType.PHONE]: 'smartphone',
  [Device.DeviceType.TABLET]: 'tablet',
  [Device.DeviceType.DESKTOP]: 'desktop',
  [Device.DeviceType.TV]: 'tv',
  [Device.DeviceType.UNKNOWN]: 'unknown',
};

interface UseDeviceInfoResult {
  registrationStatus: RegistrationStatus;
  storedData: StoredDeviceData | null;
  deviceModel: string;
  deviceOS: string;
  deviceType: string;
  saveDeviceData: (data: StoredDeviceData) => Promise<void>;
  clearDeviceData: () => Promise<void>;
}

export function useDeviceInfo(): UseDeviceInfoResult {
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
      const os = [Device.osName, Device.osVersion].filter(Boolean).join(' ') || 'Unknown';
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

  return {
    registrationStatus,
    storedData,
    deviceModel,
    deviceOS,
    deviceType,
    saveDeviceData,
    clearDeviceData,
  };
}
