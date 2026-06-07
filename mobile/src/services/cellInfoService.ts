import { PermissionsAndroid, Platform } from 'react-native';
import CellInfoModule, { type NativeCellInfo } from '../../modules/cell-info';
import type { CellTower } from '../models/types';
import { isExpoGo } from '../config/runtime';

/**
 * Returns real cell-tower info from the local `cell-info` Expo Module.
 *
 * Availability matrix:
 *   - Android + dev client / prebuild'd app → real `TelephonyManager` data.
 *   - Android + Expo Go → native module absent → mock payload.
 *   - iOS (any) → native stub returns []; Apple does not expose cell info.
 *
 * Android needs both `ACCESS_FINE_LOCATION` (requested by expo-location
 * before tracking starts) and `READ_PHONE_STATE`. We only ask for
 * READ_PHONE_STATE here because expo-location owns FINE_LOCATION.
 */

export type CellInfoSource = 'real' | 'mock-expo-go' | 'unavailable';

export function getCellInfoSource(): CellInfoSource {
  if (Platform.OS !== 'android') return 'unavailable';
  if (CellInfoModule != null) return 'real';
  if (isExpoGo) return 'mock-expo-go';
  return 'unavailable';
}

const MOCK_TOWERS: CellTower[] = [
  {
    type: 'LTE',
    mcc: 452,
    mnc: 2,
    lac: 12345,
    cid: 67890,
    signalDbm: -85,
    rssi: -75,
    pci: 123,
    // Mark one mock tower as the registered cell so the backend's
    // "prefer isRegistered" path is exercised even without real modem data.
    isRegistered: true,
    isPrimary: true,
  },
  {
    type: 'LTE',
    mcc: 452,
    mnc: 2,
    lac: 12345,
    cid: 67891,
    signalDbm: -92,
    rssi: -82,
    pci: 456,
    isRegistered: false,
    isPrimary: false,
  },
];

let phoneStateGranted: boolean | null = null;

async function ensurePhoneStatePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (phoneStateGranted === true) return true;

  const already = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
  );
  if (already) {
    phoneStateGranted = true;
    return true;
  }

  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
    {
      title: 'Quyền đọc thông tin thiết bị',
      message: 'Ứng dụng cần quyền này để đọc thông tin trạm BTS đang kết nối.',
      buttonPositive: 'Đồng ý',
      buttonNegative: 'Từ chối',
    },
  );
  phoneStateGranted = result === PermissionsAndroid.RESULTS.GRANTED;
  return phoneStateGranted;
}

// Defence in depth: native module already filters Int.MAX_VALUE
// (CellInfo.UNAVAILABLE = 2147483647), but reject any out-of-range dBm here
// too in case a future native change leaks it through.
const isValidDbm = (v: number | null | undefined): v is number =>
  typeof v === 'number' && v < 0 && v >= -160;

function normalize(raw: NativeCellInfo): CellTower | null {
  if (!raw.mcc || !raw.mnc || !raw.lac || !raw.cid) return null;
  // Keep the cell when only its signal is missing/invalid — the identity is
  // still useful for BTS lookup. A null signal just means it can't win the
  // serving-cell pick by strength (handled server-side).
  return {
    type: raw.type,
    mcc: raw.mcc,
    mnc: raw.mnc,
    lac: raw.lac,
    cid: raw.cid,
    signalDbm: isValidDbm(raw.signalDbm) ? raw.signalDbm : null,
    rssi: isValidDbm(raw.rssi) ? raw.rssi : undefined,
    pci: raw.pci ?? undefined,
    isRegistered: raw.isRegistered,
    isPrimary: raw.isPrimary ?? undefined,
  };
}

export async function getCellTowerInfo(): Promise<CellTower[]> {
  const source = getCellInfoSource();

  if (source === 'mock-expo-go') return MOCK_TOWERS;
  if (source === 'unavailable') return [];

  if (Platform.OS === 'android') {
    const granted = await ensurePhoneStatePermission();
    if (!granted) return [];
  }

  try {
    const raw = await CellInfoModule!.getCellInfo();
    return raw.map(normalize).filter((c): c is CellTower => c !== null);
  } catch {
    return [];
  }
}

export function isRealCellInfoAvailable(): boolean {
  return getCellInfoSource() === 'real';
}

export function isUsingMockCellInfo(): boolean {
  return getCellInfoSource() === 'mock-expo-go';
}

export function isCellInfoUnavailable(): boolean {
  return getCellInfoSource() === 'unavailable';
}
