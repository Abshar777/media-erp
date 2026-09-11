"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { refreshAccessToken } from "@/lib/axios";
import type { NotificationsData } from "@/types/notification";

/**
 * App-wide socket that listens for notification pushes only.
 *
 * Mounted in the dashboard layout so the bell updates on every screen, not
 * just on the chat page where useChatSocket lives. It deliberately ignores
 * every other frame type: the chat page keeps its own socket, and handling
 * messages in both places would double-apply them to the cache.
 *
 * The server keeps a set of sockets per user, so this one coexists with the
 * chat page's rather than evicting it.
 */
export function useNotificationSocket(currentUserId: string | null) {
  const qc = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    if (!currentUserId) return;

    function connect() {
      if (unmountedRef.current) return;
      const token = localStorage.getItem("access_token");
      if (!token) return;

      // Same origin unless NEXT_PUBLIC_WS_URL points at the backend directly —
      // matches useChat, since hosts that can't proxy a WebSocket upgrade
      // (Vercel) need the API's own origin.
      const origin =
        process.env.NEXT_PUBLIC_WS_URL?.replace(/\/+$/, "") || window.location.origin;
      const ws = new WebSocket(
        `${origin.replace(/^http/, "ws")}/api/v1/chat/ws?token=${encodeURIComponent(token)}`
      );
      wsRef.current = ws;

      ws.onmessage = (evt) => {
        let data: { type?: string; notification?: NotificationsData["items"][number] };
        try {
          data = JSON.parse(evt.data);
        } catch {
          return;
        }
        if (data.type !== "notification" || !data.notification) return;

        const incoming = data.notification;
        qc.setQueriesData<NotificationsData>(
          { queryKey: ["notifications"] },
          (prev) => {
            if (!prev) return prev;
            // The 60s poll may already have it — never count it twice.
            if (prev.items.some((n) => n.id === incoming.id)) return prev;
            return {
              ...prev,
              items: [incoming, ...prev.items],
              unread_count: prev.unread_count + 1,
            };
          }
        );
      };

      ws.onclose = (evt) => {
        if (unmountedRef.current) return;
        // 4001 = token rejected, almost always an expired access token. Refresh
        // once and reconnect; retrying the same token would just loop.
        if (evt.code === 4001) {
          refreshAccessToken().then((t) => {
            if (t && !unmountedRef.current) connect();
          });
          return;
        }
        retryRef.current = setTimeout(connect, 5000);
      };

      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      unmountedRef.current = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [currentUserId, qc]);
}
