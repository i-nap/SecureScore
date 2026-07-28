"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { login as apiLogin, getMe, logout as apiLogout, getToken, setToken, type LoginResponse } from "./api";

export type UserRole = "admin" | "branch_manager" | "customer" | "cashier" | "it_admin" | "ceo" | "viewer";

export interface User {
  username: string;
  role: UserRole;
  branch_id: string;
  full_name: string;
  branch_type: string;
  customer_id?: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string, branch_id?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  login: async () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Try to restore session on mount
  useEffect(() => {
    const token = getToken();
    if (token) {
      getMe()
        .then((u) => setUser(u as User))
        .catch(() => {
          setToken(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (username: string, password: string, branch_id?: string) => {
    const res: LoginResponse = await apiLogin(username, password, branch_id);
    setUser(res.user as User);
  }, []);

  const logout = useCallback(() => {
    apiLogout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
