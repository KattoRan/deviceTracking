export interface RegisterDeviceRequest {
  fullName: string;
  email: string;
  address?: string;
  citizenId: string;
  phoneNumber: string;
  device: {
    model?: string;
    type?: string;
    os?: string;
  };
}

export interface RegisterDeviceResponse {
  userId: string;
  deviceId: string;
}

export interface StoredDeviceData {
  deviceId: string;
  userId: string;
  fullName: string;
  email: string;
  registeredAt: string;
}

export type RegistrationStatus = 'loading' | 'registered' | 'not_registered';

export interface LocationData {
  latitude: number;
  longitude: number;
}

export interface CellTower {
  type: string;
  mcc: number;
  mnc: number;
  lac: number;
  cid: number;
  signalDbm: number;
  rssi?: number;
  pci?: number;
}

export interface IngestPayload {
  location: LocationData;
  cellTowers: CellTower[];
}

export interface IngestResponse {
  success: boolean;
  message?: string;
}

export interface CellTowerInfoRealtime extends CellTower {
  isServing: boolean;
}

export interface ConnectedBts {
  id: number;
  lat: number;
  lon: number;
  radio: string | null;
  range: number | null;
}

export interface DeviceMovedEvent {
  deviceId: string;
  lat: number;
  lon: number;
  cid: number | null;
  lac: number | null;
  signalDbm: number | null;
  timestamp: string;
  cellTowers: CellTowerInfoRealtime[];
  connectedBts: ConnectedBts | null;
}

export type RootStackParamList = {
  Register: undefined;
  Home: undefined;
  Tracking: undefined;
};

export const PHONE_REGEX = /^(0|\+84)[0-9]{9}$/;
export const CITIZEN_ID_REGEX = /^[0-9]{9,12}$/;
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
