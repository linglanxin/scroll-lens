import { create } from "zustand";
import { authApi } from "../api/auth";
import { setStoredToken, setUnauthorizedHandler } from "../api/client";
import type { RegistrationStatus, User } from "../types/api";

interface AuthState {
  user: User | null;
  regStatus: RegistrationStatus | null;
  initializing: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  refreshRegStatus: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, inviteCode?: string) => Promise<void>;
  logout: () => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => {
  setUnauthorizedHandler(() => {
    setStoredToken(null);
    set({ user: null });
  });

  return {
    user: null,
    regStatus: null,
    initializing: true,
    error: null,

    refreshRegStatus: async () => {
      try {
        const regStatus = await authApi.registrationStatus();
        set({ regStatus });
      } catch {
        // non-fatal
      }
    },

    hydrate: async () => {
      set({ initializing: true });
      await get().refreshRegStatus();
      try {
        const user = await authApi.me();
        set({ user, initializing: false, error: null });
      } catch {
        setStoredToken(null);
        set({ user: null, initializing: false });
      }
    },

    login: async (username, password) => {
      set({ error: null });
      try {
        const res = await authApi.login(username, password);
        setStoredToken(res.access_token);
        set({ user: res.user, error: null });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "登录失败";
        set({ error: msg });
        throw err;
      }
    },

    register: async (username, password, inviteCode = "") => {
      set({ error: null });
      try {
        const res = await authApi.register(username, password, inviteCode);
        setStoredToken(res.access_token);
        set({ user: res.user, error: null });
        await get().refreshRegStatus();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "注册失败";
        set({ error: msg });
        throw err;
      }
    },

    logout: () => {
      setStoredToken(null);
      set({ user: null, error: null });
    },

    clearError: () => set({ error: null }),
  };
});
