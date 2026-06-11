import { apiClient } from "@/lib/api";

export interface SosEvent {
  id: string;
  deviceId: string;
  personName: string;
  lat: number;
  lon: number;
  accuracy: number | null;
  batteryLevel: number | null;
  triggeredAt: string;
  acknowledgedAt: string | null;
}

export const sosService = {
  list: async (limit = 50): Promise<SosEvent[]> => {
    const { data } = await apiClient.get<SosEvent[]>("api/v1/sos", {
      params: { limit },
    });
    return data;
  },

  acknowledge: async (id: string): Promise<void> => {
    await apiClient.post(`api/v1/sos/${id}/ack`);
  },

  acknowledgeAll: async (): Promise<{ count: number }> => {
    const { data } = await apiClient.post<{ count: number }>(
      "api/v1/sos/ack-all",
    );
    return data;
  },

  deleteAcknowledged: async (): Promise<{ count: number }> => {
    const { data } = await apiClient.delete<{ count: number }>(
      "api/v1/sos/acknowledged",
    );
    return data;
  },
};
