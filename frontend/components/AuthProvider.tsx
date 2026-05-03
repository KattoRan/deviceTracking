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
import type { Admin, LoginInput } from "@/types/admin";

interface AuthContextValue {
  admin: Admin | null;
  loading: boolean;
  login: (input: LoginInput) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = tokenStorage.get();
    if (!token) {
      setLoading(false);
      return;
    }
    let alive = true;
    authService
      .me()
      .then((me) => {
        if (alive) setAdmin(me);
      })
      .catch(() => {
        if (!alive) return;
        tokenStorage.clear();
        setAdmin(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const res = await authService.login(input);
    tokenStorage.set(res.token);
    setAdmin(res.admin);
  }, []);

  const logout = useCallback(() => {
    tokenStorage.clear();
    setAdmin(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ admin, loading, login, logout }),
    [admin, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
