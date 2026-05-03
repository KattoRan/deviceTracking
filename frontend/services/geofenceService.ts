import { apiClient } from "@/lib/api";
import type {
  CreateGeofenceInput,
  GeofenceBreachEvent,
  GeofenceDetail,
  GeofenceListItem,
  UpdateGeofenceInput,
} from "@/types/geofence";

export const geofenceService = {
  list: async (): Promise<GeofenceListItem[]> => {
    const { data } = await apiClient.get<GeofenceListItem[]>(
      "/api/v1/geofences",
    );
    return data;
  },

  listActiveBreaches: async (): Promise<GeofenceBreachEvent[]> => {
    const { data } = await apiClient.get<GeofenceBreachEvent[]>(
      "/api/v1/geofences/breaches/active",
    );
    return data;
  },

  get: async (id: string): Promise<GeofenceDetail> => {
    const { data } = await apiClient.get<GeofenceDetail>(
      `/api/v1/geofences/${id}`,
    );
    return data;
  },

  create: async (input: CreateGeofenceInput): Promise<GeofenceDetail> => {
    const { data } = await apiClient.post<GeofenceDetail>(
      "/api/v1/geofences",
      input,
    );
    return data;
  },

  update: async (
    id: string,
    input: UpdateGeofenceInput,
  ): Promise<GeofenceDetail> => {
    const { data } = await apiClient.patch<GeofenceDetail>(
      `/api/v1/geofences/${id}`,
      input,
    );
    return data;
  },

  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/v1/geofences/${id}`);
  },

  assignDevice: async (
    geofenceId: string,
    deviceId: string,
  ): Promise<GeofenceDetail> => {
    const { data } = await apiClient.post<GeofenceDetail>(
      `/api/v1/geofences/${geofenceId}/devices`,
      { deviceId },
    );
    return data;
  },

  detachDevice: async (
    geofenceId: string,
    deviceId: string,
  ): Promise<GeofenceDetail> => {
    const { data } = await apiClient.delete<GeofenceDetail>(
      `/api/v1/geofences/${geofenceId}/devices/${deviceId}`,
    );
    return data;
  },
};

export default geofenceService;
