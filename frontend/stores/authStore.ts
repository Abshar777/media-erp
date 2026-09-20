import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "@/types/user";
import { writeAuthCookie, clearAuthCookie } from "@/lib/authCookie";

interface OriginalAuth {
  user: User;
  accessToken: string;
  refreshToken: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  originalAuth: OriginalAuth | null;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  clearAuth: () => void;
  hasPermission: (module: string, action: string) => boolean;
  startImpersonation: (user: User, accessToken: string, refreshToken: string) => void;
  stopImpersonation: () => void;
}

const isBrowser = typeof window !== "undefined";

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      originalAuth: null,

      setAuth(user, accessToken, refreshToken) {
        if (isBrowser) {
          localStorage.setItem("access_token", accessToken);
          localStorage.setItem("refresh_token", refreshToken);
          // Cookie read by the route guard for SSR-safe protection.
          writeAuthCookie(accessToken);
        }
        set({ user, isAuthenticated: true });
      },

      clearAuth() {
        if (isBrowser) {
          localStorage.removeItem("access_token");
          localStorage.removeItem("refresh_token");
          clearAuthCookie();
        }
        set({ user: null, isAuthenticated: false, originalAuth: null });
      },

      hasPermission(module: string, action: string): boolean {
        const { user } = get();
        // No role assigned (legacy user) → treat as full access so the UI isn't blank
        if (!user?.role) return true;
        // Super Admin bypasses all checks
        if (user.role.is_system_role && user.role.role_name === "Super Admin") return true;
        return user.role.permissions?.[module]?.[action as keyof typeof user.role.permissions[string]] === true;
      },

      startImpersonation(user, accessToken, refreshToken) {
        const currentUser = get().user;
        if (!currentUser) return;
        const savedAccess  = isBrowser ? (localStorage.getItem("access_token")  ?? "") : "";
        const savedRefresh = isBrowser ? (localStorage.getItem("refresh_token") ?? "") : "";
        set({ originalAuth: { user: currentUser, accessToken: savedAccess, refreshToken: savedRefresh } });
        get().setAuth(user, accessToken, refreshToken);
      },

      stopImpersonation() {
        const { originalAuth } = get();
        if (!originalAuth) return;
        get().setAuth(originalAuth.user, originalAuth.accessToken, originalAuth.refreshToken);
        set({ originalAuth: null });
      },
    }),
    {
      name: "auth",
      // Persist display state + impersonation state — tokens stay in localStorage directly
      partialize: (s) => ({ user: s.user, isAuthenticated: s.isAuthenticated, originalAuth: s.originalAuth }),
    }
  )
);
