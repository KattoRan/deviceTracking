"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { authService, tokenStorage } from "@/services/authService";
import type {
  LoginInput,
  ManagerAccount,
  RegisterInput,
  UpdateProfileInput,
} from "@/types/admin";

interface AuthContextValue {
  managerAccount: ManagerAccount | null;
  loading: boolean;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<ManagerAccount>;
  refresh: () => Promise<void>;
  updateProfile: (input: UpdateProfileInput) => Promise<ManagerAccount>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [managerAccount, setManagerAccount] = useState<ManagerAccount | null>(
    null,
  );
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await authService.me();
      setManagerAccount(me);
    } catch {
      tokenStorage.clear();
      setManagerAccount(null);
    }
  }, []);

  useEffect(() => {
    const token = tokenStorage.get();
    if (!token) {
      setLoading(false);
      return;
    }
    let alive = true;
    void refresh().finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [refresh]);

  const login = useCallback(async (input: LoginInput) => {
    const res = await authService.login(input);
    tokenStorage.set(res.token);
    setManagerAccount(res.managerAccount);
  }, []);

  const register = useCallback(
    async (input: RegisterInput): Promise<ManagerAccount> => {
      const res = await authService.register(input);
      tokenStorage.set(res.token);
      setManagerAccount(res.managerAccount);
      return res.managerAccount;
    },
    [],
  );

  const updateProfile = useCallback(
    async (input: UpdateProfileInput): Promise<ManagerAccount> => {
      const updated = await authService.updateProfile(input);
      setManagerAccount(updated);
      return updated;
    },
    [],
  );

  const logout = useCallback(() => {
    tokenStorage.clear();
    setManagerAccount(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      managerAccount,
      loading,
      login,
      register,
      refresh,
      updateProfile,
      logout,
    }),
    [managerAccount, loading, login, register, refresh, updateProfile, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
