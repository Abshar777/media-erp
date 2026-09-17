export interface ChatUser {
  id: string;
  name: string;
  email: string;
  designation: string;
  status: "active" | "inactive";
  online: boolean;
}

export interface ChatAttachment {
  url: string;
  filename: string;
  content_type: string;
  size?: number;
}

/** Snapshot of the message being replied to, taken by the server at send time. */
export interface ReplyRef {
  id: string;
  from_user_id: string;
  name: string;
  preview: string;
}

export interface TaskRef {
  id: string;
  title: string;
  status: string;
  priority: string;
}

export interface ChatMessage {
  id: string;
  from_user_id: string;
  to_user_id: string;
  content: string;
  read: boolean;
  attachments?: ChatAttachment[];
  task_ids?: string[];
  tasks?: TaskRef[];
  reply_to?: ReplyRef | null;
  created_at: string; // ISO 8601
  client_id?: string;                 // optimistic-send correlation id
  status?: "sending" | "sent";        // client-side delivery state
}

export interface ChatGroup {
  id: string;
  name: string;
  team_id: string;
  color: string;
  members: string[];
  member_count: number;
  is_report_group: boolean;
  /** The single company-wide group everyone belongs to. */
  is_common?: boolean;
  last_message: string;
  last_sender_name: string;
  last_at: string | null;
}

export interface GroupMessage {
  id: string;
  group_id: string;
  from_user_id: string;
  from_user_name: string;
  content: string;
  is_system: boolean;
  attachments?: ChatAttachment[];
  task_ids?: string[];
  tasks?: TaskRef[];
  reply_to?: ReplyRef | null;
  created_at: string; // ISO 8601
  client_id?: string;
  status?: "sending" | "sent";
}

export type WsIncoming =
  | ({ type: "message" } & ChatMessage)
  | ({ type: "group_message" } & GroupMessage)
  | { type: "status"; user_id: string; online: boolean }
  | { type: "online_users"; user_ids: string[] }
  | { type: "read"; by: string }
  // Pushed by the server when a notification is created, so the bell updates
  // immediately rather than on the next 60s poll.
  | { type: "notification"; notification: import("./notification").Notification };

// ── Super Admin monitor ───────────────────────────────────────────────────────

export interface ConversationPair {
  user_a_id: string;
  user_a_name: string;
  user_b_id: string;
  user_b_name: string;
  last_message: string;
  last_sender_id: string;
  last_at: string | null;
  msg_count: number;
}
