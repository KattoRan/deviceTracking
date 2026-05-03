import { apiClient } from "@/lib/api";
import type { Admin, LoginInput, LoginResponse } from "@/types/admin";

export const AUTH_TOKEN_KEY = "deviceTracking.adminToken";

export const tokenStorage = {
  get(): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(AUTH_TOKEN_KEY);
  },
  set(token: string): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(AUTH_TOKEN_KEY, token);
  },
  clear(): void {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
  },
};

export const authService = {
  login: async (input: LoginInput): Promise<LoginResponse> => {
    const { data } = await apiClient.post<LoginResponse>(
      "/api/v1/auth/login",
      input,
    );
    return data;
  },

  me: async (): Promise<Admin> => {
    const { data } = await apiClient.get<Admin>("/api/v1/auth/me");
    return data;
  },
};

export default authService;
