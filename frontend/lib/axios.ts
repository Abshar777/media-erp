import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { clearAuthCookie } from "@/lib/authCookie";

// The browser ALWAYS calls same-origin `/api/v1` — never the backend's real
// domain. next.config.ts rewrites that path to the backend server-side (see
// BACKEND_API_URL there), so the backend's host/IP never appears in the
// browser's Network tab, page source, or DNS lookups — this is what stops the
// deployed app from being blockable by domain/IP filtering.
//
// IMPORTANT: this module is used only by client ("use client") hooks — there is
// no server-side caller. Do NOT add a `process.env.NEXT_PUBLIC_API_URL` fallback
// "for SSR" here: Next.js inlines a NEXT_PUBLIC_ var's literal value into the
// client JS bundle at build time for every reference, even one guarded by
// `typeof window` and never actually reached in the browser. That would put the
// backend's real URL back into view-source/Sources — the exact leak this file
// exists to close. If a genuine server-side caller is ever added, it must read
// a server-only env var directly in its own (server-only) file, not here.
const baseURL = "/api/v1";

const api = axios.create({
  baseURL,
  headers: { "Content-Type": "application/json" },
  withCredentials: false,
  timeout: 30_000,
});

// Attach bearer token from localStorage on every request
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("access_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Token refresh state — prevents concurrent 401s (and WebSocket reconnects,
// see useChatSocket in hooks/useChat.ts) from firing multiple refresh calls.
// The backend rotates the refresh token on every use, so two independent
// refresh calls racing on the same stored refresh_token would have the
// second one fail — everything MUST funnel through this single-flight guard.
let _isRefreshing = false;
let _refreshQueue: Array<(token: string | null) => void> = [];

function _flushQueue(token: string | null) {
  _refreshQueue.forEach((cb) => cb(token));
  _refreshQueue = [];
}

function _clearAuth() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
  clearAuthCookie();
  // Clear Zustand store without importing the hook (avoids hook rules)
  try {
    const { useAuthStore } = require("@/stores/authStore");
    useAuthStore.getState().clearAuth();
  } catch {
    // store not yet initialised — tokens already removed above
  }
  window.location.href = "/login";
}

/**
 * Refresh the access token using the stored refresh token. Single-flight —
 * concurrent callers (a REST 401, a WebSocket reconnect) share one in-flight
 * refresh instead of racing to rotate the same refresh token.
 *
 * Returns the new access token, or null if refresh failed (auth is cleared
 * and the browser redirected to /login in that case — same as before).
 */
export async function refreshAccessToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;

  if (_isRefreshing) {
    return new Promise((resolve) => {
      _refreshQueue.push(resolve);
    });
  }

  const refreshToken = localStorage.getItem("refresh_token");
  if (!refreshToken) {
    _clearAuth();
    return null;
  }

  _isRefreshing = true;
  try {
    const { data } = await axios.post(
      `${baseURL}/auth/refresh`,
      { refresh_token: refreshToken },
      { headers: { "Content-Type": "application/json" } },
    );

    const newAccess: string = data.data.access_token;
    const newRefresh: string = data.data.refresh_token;
    const user = data.data.user;

    // Persist new tokens
    localStorage.setItem("access_token", newAccess);
    localStorage.setItem("refresh_token", newRefresh);

    // Update Zustand store so UI reflects any user changes
    try {
      const { useAuthStore } = require("@/stores/authStore");
      useAuthStore.getState().setAuth(user, newAccess, newRefresh);
    } catch {
      // store not yet initialised — tokens already persisted above
    }

    _flushQueue(newAccess);
    return newAccess;
  } catch {
    // Refresh failed — session truly expired
    _flushQueue(null);
    _clearAuth();
    return null;
  } finally {
    _isRefreshing = false;
  }
}

// 401 → attempt token refresh, then retry original request
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    const url = originalRequest?.url ?? "";

    // Don't intercept auth endpoints or already-retried requests
    const isAuthEndpoint = /\/auth\/(login|register|refresh)/.test(url);
    if (
      error.response?.status !== 401 ||
      isAuthEndpoint ||
      originalRequest._retry ||
      typeof window === "undefined"
    ) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;
    const newAccess = await refreshAccessToken();
    if (!newAccess) return Promise.reject(error);

    originalRequest.headers.Authorization = `Bearer ${newAccess}`;
    return api(originalRequest);
  },
);

export default api;
