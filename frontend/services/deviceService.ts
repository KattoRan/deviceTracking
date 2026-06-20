import { apiClient } from "@/lib/api";
import type {
  Device,
  DeviceDetail,
  HistoryQualityMode,
  LocationHistory,
} from "@/types/device";

// Pairing flow chạy ở mobile (POST /devices/pair). Web dashboard chỉ tạo
// pairing code lúc đăng ký tài khoản, không gọi pair trực tiếp.

export const deviceService = {
  getAll: async (): Promise<Device[]> => {
    const { data } = await apiClient.get<Device[]>("api/v1/devices");
    return data;
  },

  getOne: async (id: string): Promise<DeviceDetail> => {
    const { data } = await apiClient.get<DeviceDetail>(`api/v1/devices/${id}`);
    return data;
  },

  getHistory: async (
    id: string,
    from: string,
    to: string,
    quality?: HistoryQualityMode,
  ): Promise<LocationHistory> => {
    const { data } = await apiClient.get<LocationHistory>(
      `api/v1/devices/${id}/history`,
      { params: { from, to, ...(quality ? { quality } : {}) } },
    );
    return data;
  },

  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`api/v1/devices/${id}`);
  },

  setLockStatus: async (
    id: string,
    locked: boolean,
  ): Promise<{ locked: boolean }> => {
    const { data } = await apiClient.patch<{ locked: boolean }>(
      `api/v1/devices/${id}/lock`,
      { locked },
    );
    return data;
  },
};

export default deviceService;
