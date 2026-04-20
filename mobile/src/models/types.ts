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

export type RootStackParamList = {
  Register: undefined;
  Home: undefined;
};

export const PHONE_REGEX = /^(0|\+84)[0-9]{9}$/;
export const CITIZEN_ID_REGEX = /^[0-9]{9,12}$/;
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
