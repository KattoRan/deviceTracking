export interface GeofenceListItem {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
  deviceCount: number;
  created_at: string;
  updated_at: string;
}

export interface GeofenceDetail extends GeofenceListItem {
  devices: Array<{
    id: string;
    owner_name: string;
    phone_number: string | null;
  }>;
}

export interface CreateGeofenceInput {
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
}

export type UpdateGeofenceInput = Partial<CreateGeofenceInput>;

export interface GeofenceBreachEvent {
  deviceId: string;
  deviceName: string | null;
  geofenceId: string;
  geofenceName: string;
  status: "outside" | "returned";
  lat: number;
  lon: number;
  centerLat: number;
  centerLon: number;
  radiusM: number;
  distanceM: number;
  timestamp: string;
}
