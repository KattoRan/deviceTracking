import { requireOptionalNativeModule } from 'expo-modules-core';

export type CellRadio = 'GSM' | 'WCDMA' | 'LTE' | 'NR';

export interface NativeCellInfo {
  type: CellRadio;
  mcc: number | null;
  mnc: number | null;
  lac: number | null;
  cid: number | null;
  pci: number | null;
  rssi: number | null;
  signalDbm: number | null;
  /** `CellInfo.isRegistered` — true iff the modem is registered on this cell. */
  isRegistered: boolean;
  /**
   * `CellInfo.getCellConnectionStatus() === CONNECTION_PRIMARY_SERVING`.
   * Đáng tin hơn `isRegistered` (chỉ một cell duy nhất là PRIMARY tại một
   * thời điểm). Null trên API < 28 hoặc khi modem không báo.
   */
  isPrimary: boolean | null;
}

interface CellInfoNativeModule {
  getCellInfo(): Promise<NativeCellInfo[]>;
}

/**
 * Returns `null` when the native module isn't linked — i.e. running under
 * Expo Go or before `expo prebuild`. Consumers should check for null and
 * fall back to a mock or empty payload.
 */
const CellInfoModule =
  requireOptionalNativeModule<CellInfoNativeModule>('CellInfoModule');

export default CellInfoModule;
