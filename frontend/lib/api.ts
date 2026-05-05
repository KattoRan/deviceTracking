import axios, { type AxiosInstance } from "axios";

/**
 * Quy ước:
 *   - URL trong env LUÔN kết thúc bằng `/`
 *   - Endpoint paths trong code KHÔNG có `/` ở đầu
 *   → axios `baseURL + path` ra đúng URL, Socket.IO nhận URL có `/` cuối OK.
 */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001/";

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
  timeout: 15_000,
});

const AUTH_TOKEN_KEY = "deviceTracking.adminToken";

apiClient.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) {
      config.headers.set("Authorization", `Bearer ${token}`);
    }
  }
  return config;
});
