import { apiClient } from "@/lib/api";
import type { BtsDetail, BtsGeoJson } from "@/types/bts";

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

  getDetail: async (id: number): Promise<BtsDetail> => {
    const { data } = await apiClient.get<BtsDetail>(`api/v1/bts/${id}`);
    return data;
  },
};

export default btsService;
