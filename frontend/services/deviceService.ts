import { apiClient } from "@/lib/api";
import type { Device, DeviceDetail, LocationHistory } from "@/types/device";

export interface RegisterDeviceDto {
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

export interface RegisterDeviceResult {
  userId: string;
  deviceId: string;
}

export const deviceService = {
  getAll: async (): Promise<Device[]> => {
    const { data } = await apiClient.get<Device[]>("/api/v1/devices");
    return data;
  },

  getOne: async (id: string): Promise<DeviceDetail> => {
    const { data } = await apiClient.get<DeviceDetail>(`/api/v1/devices/${id}`);
    return data;
  },

  getHistory: async (
    id: string,
    from: string,
    to: string,
  ): Promise<LocationHistory> => {
    const { data } = await apiClient.get<LocationHistory>(
      `/api/v1/devices/${id}/history`,
      { params: { from, to } },
    );
    return data;
  },

  register: async (dto: RegisterDeviceDto): Promise<RegisterDeviceResult> => {
    const { data } = await apiClient.post<RegisterDeviceResult>(
      "/api/v1/devices/register",
      dto,
    );
    return data;
  },
};

export default deviceService;
