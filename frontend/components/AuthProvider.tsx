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
import type { LoginInput, ParentAccount, RegisterInput } from "@/types/admin";

interface AuthContextValue {
  parentAccount: ParentAccount | null;
  loading: boolean;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<ParentAccount>;
  refresh: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [parentAccount, setParentAccount] = useState<ParentAccount | null>(
    null,
  );
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await authService.me();
      setParentAccount(me);
    } catch {
      tokenStorage.clear();
      setParentAccount(null);
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
    setParentAccount(res.parentAccount);
  }, []);

  const register = useCallback(
    async (input: RegisterInput): Promise<ParentAccount> => {
      const res = await authService.register(input);
      tokenStorage.set(res.token);
      setParentAccount(res.parentAccount);
      return res.parentAccount;
    },
    [],
  );

  const logout = useCallback(() => {
    tokenStorage.clear();
    setParentAccount(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ parentAccount, loading, login, register, refresh, logout }),
    [parentAccount, loading, login, register, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
