import { API_BASE_URL, API_ENDPOINTS, REQUEST_TIMEOUT_MS } from '../config/api';
import type {
  GeofenceBreachEvent,
  IngestPayload,
  IngestResponse,
  RegisterDeviceRequest,
  RegisterDeviceResponse,
  TrackingIntervalResponse,
} from '../models/types';

export class ApiError extends Error {
  constructor(public readonly status: number | null, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

interface BackendErrorBody {
  message?: string | string[];
  error?: string;
  statusCode?: number;
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new ApiError(null, 'Yêu cầu quá thời gian chờ');
    }
    throw new ApiError(null, 'Không kết nối được máy chủ');
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let body: BackendErrorBody & Partial<T> = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // non-JSON response
    }
  }

  if (!res.ok) {
    const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    throw new ApiError(res.status, msg || `HTTP ${res.status}`);
  }

  return body as T;
}

export function registerDevice(
  data: RegisterDeviceRequest,
): Promise<RegisterDeviceResponse> {
  return request<RegisterDeviceResponse>(API_ENDPOINTS.REGISTER_DEVICE, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function sendIngestData(
  deviceId: string,
  payload: IngestPayload,
): Promise<IngestResponse> {
  return request<IngestResponse>(API_ENDPOINTS.INGEST, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'x-device-id': deviceId },
  });
}

export function fetchTrackingInterval(): Promise<TrackingIntervalResponse> {
  return request<TrackingIntervalResponse>('api/v1/settings/tracking-interval', {
    method: 'GET',
  });
}

/**
 * Returns the device's currently active geofence breach, or null when it's
 * inside the zone (or has no zone). Used on app launch to re-show the
 * persistent banner without waiting for the next ingest-driven transition.
 */
export function fetchActiveBreach(
  deviceId: string,
): Promise<GeofenceBreachEvent | null> {
  return request<GeofenceBreachEvent | null>(
    `api/v1/devices/${deviceId}/active-breach`,
    { method: 'GET' },
  );
}
