"use client";

import { useEffect } from "react";

const CHANNEL = "root-portal-history-v1";
const ROOT_ORIGINS = new Set([
  "https://root-sales-crm.deltainstitutions.com",
  "http://localhost:3100",
  "http://127.0.0.1:3100",
]);

function safePath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096 || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname === "/sso" || url.pathname.startsWith("/api/")) return null;
    for (const key of ["token", "ssoToken", "access_token", "refresh_token", "id_token", "code"]) url.searchParams.delete(key);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function rootOrigin(): string | null {
  try {
    const referrerOrigin = document.referrer ? new URL(document.referrer).origin : "";
    if (ROOT_ORIGINS.has(referrerOrigin)) {
      sessionStorage.setItem("root-portal-origin", referrerOrigin);
      return referrerOrigin;
    }
    const remembered = sessionStorage.getItem("root-portal-origin");
    return remembered && ROOT_ORIGINS.has(remembered) ? remembered : null;
  } catch {
    return null;
  }
}

export function RootPortalHistoryBridge() {
  useEffect(() => {
    if (window.parent === window) return;
    const targetOrigin = rootOrigin();
    if (!targetOrigin) return;

    let lastPath = "";
    const report = (type: "ready" | "route") => {
      const path = safePath(`${window.location.pathname}${window.location.search}${window.location.hash}`);
      if (!path || (type === "route" && path === lastPath)) return;
      lastPath = path;
      window.parent.postMessage({ channel: CHANNEL, type, path }, targetOrigin);
    };

    const receiveNavigation = (event: MessageEvent) => {
      if (event.origin !== targetOrigin || event.source !== window.parent) return;
      const message = event.data as { channel?: unknown; type?: unknown; path?: unknown } | null;
      if (!message || message.channel !== CHANNEL || message.type !== "navigate") return;
      const path = safePath(message.path);
      if (path && path !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
        window.location.assign(path);
      }
    };

    const onHistoryChange = () => report("route");
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    const pushState = function (this: History, ...args: Parameters<History["pushState"]>) {
      const result = originalPushState.apply(this, args);
      queueMicrotask(onHistoryChange);
      return result;
    };
    const replaceState = function (this: History, ...args: Parameters<History["replaceState"]>) {
      const result = originalReplaceState.apply(this, args);
      queueMicrotask(onHistoryChange);
      return result;
    };
    window.history.pushState = pushState;
    window.history.replaceState = replaceState;
    window.addEventListener("message", receiveNavigation);
    window.addEventListener("popstate", onHistoryChange);
    window.addEventListener("hashchange", onHistoryChange);
    window.addEventListener("pageshow", onHistoryChange);
    report("ready");

    return () => {
      window.removeEventListener("message", receiveNavigation);
      window.removeEventListener("popstate", onHistoryChange);
      window.removeEventListener("hashchange", onHistoryChange);
      window.removeEventListener("pageshow", onHistoryChange);
      if (window.history.pushState === pushState) window.history.pushState = originalPushState;
      if (window.history.replaceState === replaceState) window.history.replaceState = originalReplaceState;
    };
  }, []);

  return null;
}

