"use client";

import { useEffect, useRef, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import api, { refreshAccessToken } from "@/lib/axios";
import type {
  ChatAttachment,
  ChatGroup,
  ChatMessage,
  ChatUser,
  ConversationPair,
  GroupMessage,
  TaskRef,
  WsIncoming,
} from "@/types/chat";
import type { NotificationsData } from "@/types/notification";

export interface SendExtras {
  attachments?: ChatAttachment[];
  taskIds?: string[];
  /** Ids of people @mentioned — the server notifies each of them. */
  mentionUserIds?: string[];
  /** Id of the message being replied to. The server snapshots it; the quote
      shown to everyone is built there, not from anything sent here. */
  replyToId?: string;
  /** Local-only preview so the optimistic bubble can show the quote before
      the server echo arrives. Never sent. */
  replyTo?: import("@/types/chat").ReplyRef | null;
}

function newClientId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface Mergeable {
  id: string;
  content: string;
  from_user_id: string;
  created_at: string;
  client_id?: string;
  status?: "sending" | "sent";
}

/**
 * Merge a fresh REST snapshot with whatever's already cached, instead of
 * overwriting it outright. A GET can resolve *after* the WebSocket has
 * already pushed a newer message into the cache (e.g. the request was in
 * flight when a message arrived, or fired again on refocus/remount while
 * one was mid-send) — a plain replace would silently wipe that message
 * until some later fetch happens to include it again. Real messages are
 * never deleted server-side; this was purely a client-side render race.
 */
function mergeMessages<T extends Mergeable>(prev: T[], fresh: T[]): T[] {
  const byId = new Map<string, T>();
  for (const m of prev) byId.set(m.id, m);

  for (const m of fresh) {
    // A still-"sending" optimistic entry has no counterpart in `fresh`
    // (REST never echoes a client_id) — reconcile it by sender + content
    // so the confirmed message doesn't show up as a duplicate alongside
    // its own optimistic placeholder while waiting for the WS echo.
    for (const [k, v] of byId) {
      if (
        v.status === "sending" &&
        v.from_user_id === m.from_user_id &&
        v.content === m.content &&
        k !== m.id
      ) {
        byId.delete(k);
        break;
      }
    }
    byId.set(m.id, m);
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  );
}

// ── REST queries ──────────────────────────────────────────────────────────────

export function useChatUsers() {
  return useQuery<ChatUser[]>({
    queryKey: ["chat", "users"],
    queryFn: () => api.get("/chat/users").then((r) => r.data),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

/** Tasks the current user can reference (@mention) in chat. */
export function useMentionableTasks(search: string) {
  return useQuery<TaskRef[]>({
    queryKey: ["chat", "mention-tasks", search],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: Array<{ id: string; title: string; status: string; priority: string }> }>(
        "/projects",
        { params: search ? { search } : {} }
      );
      return (data.data ?? []).map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
      }));
    },
    staleTime: 15_000,
  });
}

export function useChatMessages(otherId: string | null) {
  const qc = useQueryClient();
  const queryKey = ["chat", "messages", otherId] as const;
  return useQuery<ChatMessage[]>({
    queryKey,
    queryFn: async () => {
      const { data } = await api.get<ChatMessage[]>(`/chat/messages/${otherId}`);
      const prev = qc.getQueryData<ChatMessage[]>(queryKey) ?? [];
      return mergeMessages(prev, data);
    },
    enabled: !!otherId,
    staleTime: 0,
  });
}

export function useUnreadCounts() {
  return useQuery<Record<string, number>>({
    queryKey: ["chat", "unread"],
    queryFn: () => api.get("/chat/unread").then((r) => r.data),
    refetchInterval: 20_000,
    staleTime: 5_000,
  });
}

// ── Group chat ────────────────────────────────────────────────────────────────

export function useGroups() {
  return useQuery<ChatGroup[]>({
    queryKey: ["chat", "groups"],
    queryFn: () => api.get("/chat/groups").then((r) => r.data),
    refetchInterval: 20_000,
    staleTime: 10_000,
  });
}

export function useGroupMessages(groupId: string | null) {
  const qc = useQueryClient();
  const queryKey = ["chat", "group-messages", groupId] as const;
  return useQuery<GroupMessage[]>({
    queryKey,
    queryFn: async () => {
      const { data } = await api.get<GroupMessage[]>(`/chat/groups/${groupId}/messages`);
      const prev = qc.getQueryData<GroupMessage[]>(queryKey) ?? [];
      return mergeMessages(prev, data);
    },
    enabled: !!groupId,
    // Poll so the automated 9 PM IST report (posted by the backend daemon) shows up
    refetchInterval: 12_000,
    staleTime: 0,
  });
}

export type ReportPeriod = "daily" | "weekly" | "monthly";

export const REPORT_PERIOD_OPTIONS: { value: ReportPeriod; label: string }[] = [
  { value: "daily",   label: "Daily report" },
  { value: "weekly",  label: "Weekly report" },
  { value: "monthly", label: "Monthly report" },
];

export function useSendGroupReportNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, period }: { groupId: string; period: ReportPeriod }) =>
      api
        .post(`/chat/groups/${groupId}/report/send-now`, null, { params: { period } })
        .then((r) => r.data),
    onSuccess: (_data, { groupId, period }) => {
      qc.invalidateQueries({ queryKey: ["chat", "group-messages", groupId] });
      qc.invalidateQueries({ queryKey: ["chat", "groups"] });
      const label = REPORT_PERIOD_OPTIONS.find((o) => o.value === period)?.label ?? "Report";
      toast.success(`${label} posted to the group`);
    },
    onError: () => toast.error("Failed to post report"),
  });
}

/** Download a team's report as a PDF (default: monthly) without posting it to chat. */
export function useExportGroupReportPdf() {
  return useMutation({
    mutationFn: async ({
      groupId,
      groupName,
      period = "monthly",
    }: {
      groupId: string;
      groupName: string;
      period?: ReportPeriod;
    }) => {
      const token = localStorage.getItem("access_token");
      const res = await fetch(`/api/v1/chat/groups/${groupId}/report/export/pdf?period=${period}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { detail?: string }).detail ?? "Export failed");
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${groupName.trim().toLowerCase().replace(/\s+/g, "_")}_${period}_report.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    },
    onSuccess: () => toast.success("Report PDF downloaded"),
    onError: (e: Error) => toast.error(e.message || "Failed to export PDF"),
  });
}

// ── Super Admin monitor ───────────────────────────────────────────────────────

export function useAdminConversations(enabled: boolean) {
  return useQuery<ConversationPair[]>({
    queryKey: ["chat", "admin", "conversations"],
    queryFn: () => api.get("/chat/admin/conversations").then((r) => r.data),
    enabled,
    refetchInterval: 10_000,
    staleTime: 0,
  });
}

export function useAdminMessages(userAId: string | null, userBId: string | null) {
  const qc = useQueryClient();
  const queryKey = ["chat", "admin", "messages", userAId, userBId] as const;
  return useQuery<ChatMessage[]>({
    queryKey,
    queryFn: async () => {
      const { data } = await api.get<ChatMessage[]>(`/chat/admin/messages/${userAId}/${userBId}`);
      const prev = qc.getQueryData<ChatMessage[]>(queryKey) ?? [];
      return mergeMessages(prev, data);
    },
    enabled: !!(userAId && userBId),
    refetchInterval: 8_000,   // live refresh for the admin view
    staleTime: 0,
  });
}

// ── WebSocket ─────────────────────────────────────────────────────────────────

export function useChatSocket(currentUserId: string | null) {
  const qc = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  const connect = useCallback(() => {
    if (!currentUserId || unmountedRef.current) return;

    const token =
      typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    if (!token) return;

    // Same-origin by default, like every other API call — the browser never
    // learns the backend's real host, because next.config.ts rewrites
    // /api/v1/* to the backend server-side.
    //
    // BUT: a rewrite can only proxy a WebSocket upgrade if the host running
    // Next.js actually supports it. Vercel's rewrite layer proxies plain HTTP
    // and NOT WebSocket upgrades, so on Vercel a same-origin wss:// URL never
    // reaches the backend — REST history loads while live delivery silently
    // never connects. Set NEXT_PUBLIC_WS_URL to the backend's own public
    // origin (e.g. https://api-mediaerp.deltainstitutions.com) on such hosts.
    // Leave it unset when Next.js sits behind a reverse proxy that does
    // forward upgrades (nginx with Upgrade/Connection headers).
    const wsOrigin =
      process.env.NEXT_PUBLIC_WS_URL?.replace(/\/+$/, "") ||
      window.location.origin;
    const wsBase = wsOrigin.replace(/^http/, "ws");
    const ws = new WebSocket(`${wsBase}/api/v1/chat/ws?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;

    ws.onmessage = (evt) => {
      let data: WsIncoming;
      try {
        data = JSON.parse(evt.data);
      } catch {
        return;
      }

      if (data.type === "notification") {
        // Splice it into every cached notifications page rather than refetching,
        // so the bell reacts instantly and we don't add a request per event.
        // Guard on id: the 60s poll may already have picked this one up.
        qc.setQueriesData<NotificationsData>(
          { queryKey: ["notifications"] },
          (prev) => {
            if (!prev) return prev;
            if (prev.items.some((n) => n.id === data.notification.id)) return prev;
            return {
              ...prev,
              items: [data.notification, ...prev.items],
              unread_count: prev.unread_count + 1,
            };
          }
        );
        return;
      }

      if (data.type === "online_users") {
        const ids = new Set(data.user_ids);
        qc.setQueryData<ChatUser[]>(["chat", "users"], (prev) =>
          prev?.map((u) => ({ ...u, online: ids.has(u.id) }))
        );
      } else if (data.type === "status") {
        qc.setQueryData<ChatUser[]>(["chat", "users"], (prev) =>
          prev?.map((u) =>
            u.id === data.user_id ? { ...u, online: data.online } : u
          )
        );
      } else if (data.type === "message") {
        const msg = { ...(data as ChatMessage & { type: "message" }), status: "sent" as const };
        const partnerId =
          msg.from_user_id === currentUserId
            ? msg.to_user_id
            : msg.from_user_id;

        // Reconcile an optimistic message (matched by client_id) or append
        qc.setQueryData<ChatMessage[]>(
          ["chat", "messages", partnerId],
          (prev = []) => {
            if (msg.client_id) {
              const idx = prev.findIndex(
                (m) => m.client_id === msg.client_id || m.id === msg.client_id
              );
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = msg;
                return next;
              }
            }
            return prev.some((m) => m.id === msg.id) ? prev : [...prev, msg];
          }
        );

        // Increment unread badge for incoming messages only
        if (msg.from_user_id !== currentUserId) {
          qc.setQueryData<Record<string, number>>(
            ["chat", "unread"],
            (prev = {}) => ({
              ...prev,
              [msg.from_user_id]: (prev[msg.from_user_id] ?? 0) + 1,
            })
          );
        }
      } else if (data.type === "read") {
        // The partner (data.by) read our messages → flip our ✓ to ✓✓
        qc.setQueryData<ChatMessage[]>(
          ["chat", "messages", data.by],
          (prev = []) =>
            prev.map((m) =>
              m.from_user_id === currentUserId ? { ...m, read: true } : m
            )
        );
      } else if (data.type === "group_message") {
        const gm = { ...(data as GroupMessage & { type: "group_message" }), status: "sent" as const };
        qc.setQueryData<GroupMessage[]>(
          ["chat", "group-messages", gm.group_id],
          (prev = []) => {
            if (gm.client_id) {
              const idx = prev.findIndex(
                (m) => m.client_id === gm.client_id || m.id === gm.client_id
              );
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = gm;
                return next;
              }
            }
            return prev.some((m) => m.id === gm.id) ? prev : [...prev, gm];
          }
        );
        // Refresh the group list preview
        qc.invalidateQueries({ queryKey: ["chat", "groups"] });
      }
    };

    ws.onclose = (evt) => {
      if (unmountedRef.current) return;

      // 4001 = the access token was rejected (most commonly: it expired
      // while the chat page was open — access tokens live 15 min, well
      // within a normal chat session). Retrying with the same stored token
      // would just get rejected again forever, silently leaving every future
      // send stuck in "sending" with no visible error. Refresh first — the
      // refresh call is single-flight-guarded in lib/axios.ts, so it's safe
      // even if a REST call is refreshing concurrently — then reconnect with
      // the new token. If refresh genuinely fails (session truly expired),
      // it redirects to /login on its own; don't loop.
      if (evt.code === 4001) {
        refreshAccessToken().then((newToken) => {
          if (newToken && !unmountedRef.current) connect();
        });
        return;
      }

      // Auto-reconnect after 3 s
      retryTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => ws.close();
  }, [currentUserId, qc]);

  useEffect(() => {
    unmountedRef.current = false;
    connect();
    return () => {
      unmountedRef.current = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const sendMessage = useCallback(
    (toUserId: string, content: string, extras?: SendExtras) => {
      const clientId = newClientId();
      // Optimistic: show the message instantly with a "sending" state
      if (currentUserId) {
        const optimistic: ChatMessage = {
          id: clientId,
          client_id: clientId,
          from_user_id: currentUserId,
          to_user_id: toUserId,
          content,
          read: false,
          attachments: extras?.attachments ?? [],
          task_ids: extras?.taskIds ?? [],
          tasks: [],
          reply_to: extras?.replyTo ?? null,
          status: "sending",
          created_at: new Date().toISOString(),
        };
        qc.setQueryData<ChatMessage[]>(["chat", "messages", toUserId], (prev = []) => [
          ...prev,
          optimistic,
        ]);
      }
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "message",
            to_user_id: toUserId,
            content,
            attachments: extras?.attachments ?? [],
            task_ids: extras?.taskIds ?? [],
            mention_user_ids: extras?.mentionUserIds ?? [],
            reply_to_id: extras?.replyToId ?? "",
            client_id: clientId,
          })
        );
      }
    },
    [currentUserId, qc]
  );

  const sendGroupMessage = useCallback(
    (groupId: string, content: string, extras?: SendExtras) => {
      const clientId = newClientId();
      if (currentUserId) {
        const optimistic: GroupMessage = {
          id: clientId,
          client_id: clientId,
          group_id: groupId,
          from_user_id: currentUserId,
          from_user_name: "",
          content,
          is_system: false,
          attachments: extras?.attachments ?? [],
          task_ids: extras?.taskIds ?? [],
          tasks: [],
          reply_to: extras?.replyTo ?? null,
          status: "sending",
          created_at: new Date().toISOString(),
        };
        qc.setQueryData<GroupMessage[]>(["chat", "group-messages", groupId], (prev = []) => [
          ...prev,
          optimistic,
        ]);
      }
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "group_message",
            group_id: groupId,
            content,
            attachments: extras?.attachments ?? [],
            task_ids: extras?.taskIds ?? [],
            mention_user_ids: extras?.mentionUserIds ?? [],
            reply_to_id: extras?.replyToId ?? "",
            client_id: clientId,
          })
        );
      }
    },
    [currentUserId, qc]
  );

  const sendRead = useCallback(
    (fromUserId: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({ type: "read", from_user_id: fromUserId })
        );
      }
      // Immediately clear the badge in cache
      qc.setQueryData<Record<string, number>>(["chat", "unread"], (prev = {}) => {
        const next = { ...prev };
        delete next[fromUserId];
        return next;
      });
    },
    [qc]
  );

  return { sendMessage, sendGroupMessage, sendRead };
}
