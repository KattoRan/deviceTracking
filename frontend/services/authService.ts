import { apiClient, AUTH_TOKEN_KEY } from "@/lib/api";
import type {
  LoginInput,
  LoginResponse,
  ManagerAccount,
  RegisterInput,
  UpdateProfileInput,
} from "@/types/admin";

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
  register: async (input: RegisterInput): Promise<LoginResponse> => {
    const { data } = await apiClient.post<LoginResponse>(
      "api/v1/auth/register",
      input,
    );
    return data;
  },

  login: async (input: LoginInput): Promise<LoginResponse> => {
    const { data } = await apiClient.post<LoginResponse>(
      "api/v1/auth/login",
      input,
    );
    return data;
  },

  me: async (): Promise<ManagerAccount> => {
    const { data } = await apiClient.get<ManagerAccount>("api/v1/auth/me");
    return data;
  },

  updateProfile: async (input: UpdateProfileInput): Promise<ManagerAccount> => {
    const { data } = await apiClient.patch<ManagerAccount>(
      "api/v1/auth/me",
      input,
    );
    return data;
  },
};

export default authService;
