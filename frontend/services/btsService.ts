import { apiClient } from "@/lib/api";
import type { BtsGeoJson } from "@/types/bts";

export interface MapBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export const btsService = {
  getMapData: async (bounds: MapBounds, zoom: number): Promise<BtsGeoJson> => {
    const { data } = await apiClient.get<BtsGeoJson>("api/v1/bts/map", {
      params: { ...bounds, zoom },
    });
    return data;
  },
};

export default btsService;
