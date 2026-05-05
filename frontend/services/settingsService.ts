import { apiClient } from "@/lib/api";
import type {
  TrackingIntervalSec,
  TrackingIntervalSettings,
} from "@/types/command";

export const settingsService = {
  getTrackingInterval: async (): Promise<TrackingIntervalSettings> => {
    const { data } = await apiClient.get<TrackingIntervalSettings>(
      "api/v1/settings/tracking-interval",
    );
    return data;
  },

  setTrackingInterval: async (
    intervalSec: TrackingIntervalSec,
  ): Promise<TrackingIntervalSettings> => {
    const { data } = await apiClient.put<TrackingIntervalSettings>(
      "api/v1/settings/tracking-interval",
      { intervalSec },
    );
    return data;
  },
};

export default settingsService;
