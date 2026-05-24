import { apiClient } from "@/lib/api";
import type { PersonType } from "@/types/device";

export interface SosEvent {
  id: string;
  deviceId: string;
  personName: string;
  personType: PersonType;
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
};
