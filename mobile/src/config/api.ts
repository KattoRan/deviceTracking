import { SERVER_HOST } from './env';

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL || `http://${SERVER_HOST}:3001`;

export const API_ENDPOINTS = {
  REGISTER_DEVICE: '/api/v1/devices/register',
} as const;

export const REQUEST_TIMEOUT_MS = 15000;
