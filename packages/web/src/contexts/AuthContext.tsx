// ============================================================
// Authentication Context — manages user session state
// ============================================================

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { UserInfo, AuthResponse } from "@agentbox/shared";
import { apiPost, apiGet } from "../utils/api";

// ---------- Types ----------

interface AuthContextValue {
  user: UserInfo | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (
    username: string,
    password: string,
    displayName?: string,
  ) => Promise<void>;
  logout: () => void;
}

// ---------- Constants ----------

const TOKEN_KEY = "agentbox_token";

// ---------- Context ----------

const AuthContext = createContext<AuthContextValue | null>(null);

// ---------- Provider ----------

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(TOKEN_KEY),
  );
  const [initializing, setInitializing] = useState(true);

  /** Persist token to localStorage whenever it changes. */
  const persistToken = useCallback((newToken: string | null) => {
    setToken(newToken);
    if (newToken) {
      localStorage.setItem(TOKEN_KEY, newToken);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }, []);

  /** On mount, verify any existing token by calling GET /api/auth/me. */
  useEffect(() => {
    if (!token) {
      setInitializing(false);
      return;
    }

    let cancelled = false;

    apiGet<UserInfo>("/api/auth/me", token)
      .then((me) => {
        if (!cancelled) {
          setUser(me);
        }
      })
      .catch(() => {
        // Token is invalid / expired — clear it.
        if (!cancelled) {
          persistToken(null);
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setInitializing(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // Only run on mount (token read from localStorage).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (username: string, password: string): Promise<void> => {
      const res = await apiPost<AuthResponse>("/api/auth/login", {
        username,
        password,
      });
      persistToken(res.token);
      setUser(res.user);
    },
    [persistToken],
  );

  const register = useCallback(
    async (
      username: string,
      password: string,
      displayName?: string,
    ): Promise<void> => {
      const res = await apiPost<AuthResponse>("/api/auth/register", {
        username,
        password,
        displayName,
      });
      persistToken(res.token);
      setUser(res.user);
    },
    [persistToken],
  );

  const logout = useCallback(() => {
    persistToken(null);
    setUser(null);
  }, [persistToken]);

  const isAuthenticated = user !== null && token !== null;

  // Don't render children until we've verified (or cleared) the stored token.
  if (initializing) {
    return null;
  }

  return (
    <AuthContext.Provider
      value={{ user, token, isAuthenticated, login, register, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ---------- Hook ----------

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
