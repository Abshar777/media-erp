"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  AtSign,
  Check,
  CheckCheck,
  ChevronDown,
  Clock,
  Eye,
  FileText,
  Loader2,
  MessageSquare,
  Paperclip,
  Search,
  Send,
  ShieldAlert,
  Users,
  UsersRound,
  Megaphone,
  X,
  Reply,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import {
  useAdminConversations,
  useAdminMessages,
  useChatMessages,
  useChatSocket,
  useChatUsers,
  useGroups,
  useGroupMessages,
  useExportGroupReportPdf,
  useMentionableTasks,
  useSendGroupReportNow,
  useUnreadCounts,
  REPORT_PERIOD_OPTIONS,
  type ReportPeriod,
  type SendExtras,
} from "@/hooks/useChat";
import { useQueryClient } from "@tanstack/react-query";
import { useUploadAttachments } from "@/hooks/useUpload";
import { useTaskDetail } from "@/hooks/useProjects";
import { TaskDetailModal } from "@/components/projects/TaskDetailModal";
import { SignedImg } from "@/components/shared/SignedImg";
import type { ChatAttachment, ChatGroup, ChatMessage, ChatUser, ConversationPair, GroupMessage, ReplyRef, TaskRef } from "@/types/chat";
import { fmtDate as fmtDateIST, fmtTime as fmtTimeIST, istDateKey, istTodayKey } from "@/lib/datetime";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
  return fmtTimeIST(iso, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }, "en-US");
}

// Day grouping uses the IST calendar day, not the browser's.
function fmtDate(iso: string) {
  const key = istDateKey(iso);
  if (key === istTodayKey()) return "Today";
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  if (key === istDateKey(yest)) return "Yesterday";
  return fmtDateIST(iso, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtRelative(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return fmtDateIST(iso, { day: "numeric", month: "short" });
}

function initials(name: string) {
  return name.split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

function groupByDate(msgs: ChatMessage[]) {
  const groups: { date: string; msgs: ChatMessage[] }[] = [];
  for (const m of msgs) {
    const d = fmtDate(m.created_at);
    if (!groups.length || groups[groups.length - 1].date !== d)
      groups.push({ date: d, msgs: [m] });
    else groups[groups.length - 1].msgs.push(m);
  }
  return groups;
}

// ── Attachments + task refs + composer ────────────────────────────────────────

const TASK_STATUS_META: Record<string, { label: string; color: string }> = {
  pending:        { label: "Pending",   color: "#6366f1" },
  started:        { label: "Started",   color: "#3b82f6" },
  break:          { label: "Break",     color: "#f97316" },
  reedit:         { label: "Reedit",    color: "#ef4444" },
  pending_review: { label: "In Review", color: "#8b5cf6" },
  approved:       { label: "Approved",  color: "#22c55e" },
};

function isImage(ct: string) {
  return (ct || "").startsWith("image/");
}

function ChatTaskModal({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { data: task, isLoading, isError } = useTaskDetail(taskId);

  if (isLoading || (!task && !isError)) {
    return createPortal(
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <Loader2 className="size-6 animate-spin text-white" />
      </div>,
      document.body
    );
  }

  if (isError || !task) {
    return createPortal(
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <div className="rounded-2xl border bg-card p-6 text-center" onClick={(e) => e.stopPropagation()}>
          <p className="text-sm text-muted-foreground">Task not found or access denied.</p>
          <button onClick={onClose} className="mt-3 text-xs font-medium text-primary">Close</button>
        </div>
      </div>,
      document.body
    );
  }

  return <TaskDetailModal task={task} readOnly onClose={onClose} />;
}

function MessageExtras({ attachments, tasks }: { attachments?: ChatAttachment[]; tasks?: TaskRef[] }) {
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const qc = useQueryClient();
  const hasAny = (attachments && attachments.length) || (tasks && tasks.length);
  if (!hasAny) return null;
  // Attachment URLs are signed and expire (1 h). If one fails to load, refetch
  // the chat queries so the backend re-signs and the image recovers itself.
  const refreshSignedUrls = () => qc.invalidateQueries({ queryKey: ["chat"] });
  return (
    <div className="mt-1.5 space-y-1.5">
      {attachments?.map((a, i) =>
        isImage(a.content_type) ? (
          <a key={i} href={a.url} target="_blank" rel="noreferrer" className="block">
            <SignedImg
              src={a.url}
              alt={a.filename}
              className="max-h-52 max-w-full rounded-lg border object-cover"
              onExpired={refreshSignedUrls}
            />
          </a>
        ) : (
          <a
            key={i}
            href={a.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-lg border bg-background/70 px-3 py-2 text-xs hover:bg-muted transition-colors"
          >
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{a.filename}</span>
          </a>
        )
      )}
      {tasks?.map((t) => {
        const meta = TASK_STATUS_META[t.status] ?? { label: t.status, color: "#6366f1" };
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setOpenTaskId(t.id)}
            className="flex w-full items-center gap-2 rounded-lg border bg-background/70 px-3 py-1.5 text-left text-xs hover:bg-muted transition-colors"
          >
            <AtSign className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate font-medium">{t.title}</span>
            <span
              className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white"
              style={{ background: meta.color }}
            >
              {meta.label}
            </span>
          </button>
        );
      })}
      {openTaskId && <ChatTaskModal taskId={openTaskId} onClose={() => setOpenTaskId(null)} />}
    </div>
  );
}

function ChatComposer({
  placeholder,
  onSend,
  replyTo,
  onCancelReply,
}: {
  placeholder: string;
  onSend: (content: string, extras: SendExtras) => void;
  replyTo?: ReplyRef | null;
  onCancelReply?: () => void;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [tasks, setTasks] = useState<TaskRef[]>([]);
  const [showMention, setShowMention] = useState(false);
  const [mentionSearch, setMentionSearch] = useState("");
  const [mentionTab, setMentionTab] = useState<"people" | "tasks">("people");
  // Who was @mentioned. Kept as ids alongside the text, so the server can
  // notify them without having to parse names back out of the message body.
  const [mentionedPeople, setMentionedPeople] = useState<ChatUser[]>([]);
  const upload = useUploadAttachments();
  const { data: mentionTasks = [], isLoading: tasksLoading } = useMentionableTasks(mentionSearch);
  const { data: allChatUsers = [] } = useChatUsers();

  const mentionPeople = allChatUsers.filter((u) =>
    !mentionSearch.trim() || u.name.toLowerCase().includes(mentionSearch.trim().toLowerCase())
  );

  function togglePerson(u: ChatUser) {
    setMentionedPeople((prev) => {
      if (prev.some((p) => p.id === u.id)) return prev.filter((p) => p.id !== u.id);
      // Drop the handle into the message so the mention reads naturally.
      setText((t) => (t.endsWith(" ") || !t ? t : t + " ") + `@${u.name} `);
      return [...prev, u];
    });
  }
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const canSend = !!(text.trim() || attachments.length || tasks.length);

  function doSend() {
    if (!canSend) return;
    onSend(text.trim(), {
      attachments,
      taskIds: tasks.map((t) => t.id),
      replyToId: replyTo?.id,
      // Local echo only — the authoritative quote comes back from the server.
      replyTo: replyTo ?? null,
      // Only people still named in the text — deleting the handle should
      // withdraw the mention rather than silently notifying them anyway.
      mentionUserIds: mentionedPeople
        .filter((p) => text.includes(`@${p.name}`))
        .map((p) => p.id),
    });
    setText("");
    setAttachments([]);
    setTasks([]);
    onCancelReply?.();
    setMentionedPeople([]);
    setShowMention(false);
    if (taRef.current) taRef.current.style.height = "auto";
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  }

  function onInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setText(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const uploaded = await upload.mutateAsync(files);
    setAttachments((prev) => [
      ...prev,
      ...uploaded.map((u) => ({
        url: u.url,
        filename: u.filename,
        content_type: u.content_type,
        size: u.size,
      })),
    ]);
    if (fileRef.current) fileRef.current.value = "";
  }

  function toggleTask(t: TaskRef) {
    setTasks((prev) => (prev.some((x) => x.id === t.id) ? prev.filter((x) => x.id !== t.id) : [...prev, t]));
  }

  return (
    <div className="shrink-0 border-t bg-card/60 px-4 py-3">
      {/* Pending attachments / task chips */}
      {(attachments.length > 0 || tasks.length > 0) && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((a, i) => (
            <span key={`a-${i}`} className="flex items-center gap-1.5 rounded-lg border bg-background px-2 py-1 text-xs">
              {isImage(a.content_type) ? <Paperclip className="size-3" /> : <FileText className="size-3" />}
              <span className="max-w-[140px] truncate">{a.filename}</span>
              <button type="button" onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))}>
                <X className="size-3 text-muted-foreground hover:text-destructive" />
              </button>
            </span>
          ))}
          {tasks.map((t) => (
            <span key={`t-${t.id}`} className="flex items-center gap-1.5 rounded-lg border bg-primary/10 px-2 py-1 text-xs text-primary">
              <AtSign className="size-3" />
              <span className="max-w-[140px] truncate">{t.title}</span>
              <button type="button" onClick={() => toggleTask(t)}>
                <X className="size-3 hover:text-destructive" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Mention picker */}
      {showMention && (
        <div className="mb-2 rounded-xl border bg-card shadow-lg">
          <div className="flex gap-1 border-b p-1.5">
            {(["people", "tasks"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => { setMentionTab(tab); setMentionSearch(""); }}
                className={cn(
                  "flex-1 rounded-lg px-2 py-1 text-xs font-medium capitalize transition-colors",
                  mentionTab === tab ? "bg-primary/10 text-primary" : "hover:bg-muted text-muted-foreground"
                )}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="border-b p-2">
            <input
              autoFocus
              value={mentionSearch}
              onChange={(e) => setMentionSearch(e.target.value)}
              placeholder={mentionTab === "people" ? "Search people to mention…" : "Search tasks to mention…"}
              className="w-full rounded-lg bg-muted/50 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {mentionTab === "people" ? (
            <div className="max-h-48 overflow-y-auto p-1">
              {mentionPeople.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">No people found</p>
              ) : (
                mentionPeople.slice(0, 30).map((u) => {
                  const picked = mentionedPeople.some((p) => p.id === u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => togglePerson(u)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
                        picked ? "bg-primary/10" : "hover:bg-muted"
                      )}
                    >
                      <Avatar name={u.name} online={u.online} size="sm" />
                      <span className="flex-1 truncate">{u.name}</span>
                      {u.designation && (
                        <span className="shrink-0 text-[10px] text-muted-foreground truncate max-w-24">
                          {u.designation}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          ) : (
          <div className="max-h-48 overflow-y-auto p-1">
            {tasksLoading ? (
              <div className="flex justify-center py-4"><Loader2 className="size-4 animate-spin text-muted-foreground/50" /></div>
            ) : mentionTasks.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">No tasks found</p>
            ) : (
              mentionTasks.slice(0, 20).map((t) => {
                const meta = TASK_STATUS_META[t.status] ?? { label: t.status, color: "#6366f1" };
                const selected = tasks.some((x) => x.id === t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTask(t)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
                      selected ? "bg-primary/10" : "hover:bg-muted"
                    )}
                  >
                    <span className="flex-1 truncate">{t.title}</span>
                    <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ background: meta.color }}>
                      {meta.label}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          )}
        </div>
      )}

      {replyTo && (
        <div className="mb-2 flex items-start gap-2 rounded-xl border-l-[3px] border-primary bg-primary/5 px-3 py-2">
          <Reply className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-primary">
              Replying to {replyTo.name}
            </p>
            <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
              {replyTo.preview || "Attachment"}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Cancel reply"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <input ref={fileRef} type="file" multiple className="hidden" onChange={onPickFiles} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={upload.isPending}
          className="flex size-[42px] shrink-0 items-center justify-center rounded-2xl border hover:bg-muted transition-colors disabled:opacity-50"
          title="Attach file"
        >
          {upload.isPending ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
        </button>
        <button
          type="button"
          onClick={() => setShowMention((v) => !v)}
          className={cn(
            "flex size-[42px] shrink-0 items-center justify-center rounded-2xl border transition-colors",
            showMention ? "bg-primary/10 text-primary" : "hover:bg-muted"
          )}
          title="Mention a task"
        >
          <AtSign className="size-4" />
        </button>
        <textarea
          ref={taRef}
          value={text}
          onChange={onInput}
          onKeyDown={onKey}
          placeholder={placeholder}
          rows={1}
          className="flex-1 resize-none overflow-hidden rounded-2xl border bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/25 transition"
          style={{ minHeight: "42px", maxHeight: "120px" }}
        />
        <button
          type="button"
          onClick={doSend}
          disabled={!canSend}
          className={cn(
            "flex size-[42px] shrink-0 items-center justify-center rounded-2xl transition-all",
            canSend
              ? "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 shadow-sm"
              : "bg-muted text-muted-foreground/40 cursor-not-allowed"
          )}
        >
          <Send className="size-4" />
        </button>
      </div>
    </div>
  );
}

// ── Shared UI atoms ───────────────────────────────────────────────────────────

function Avatar({
  name,
  online,
  size = "md",
  active = false,
  color = "default",
}: {
  name: string;
  online?: boolean;
  size?: "sm" | "md";
  active?: boolean;
  color?: "default" | "amber";
}) {
  const sz = size === "sm" ? "size-8" : "size-10";
  const dot = size === "sm" ? "size-2 ring-1" : "size-2.5 ring-2";
  return (
    <div className="relative shrink-0">
      <div
        className={cn(
          sz,
          "flex items-center justify-center rounded-full text-xs font-bold select-none",
          color === "amber"
            ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
            : active
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground"
        )}
      >
        {initials(name)}
      </div>
      {online !== undefined && (
        <span
          className={cn(
            "absolute bottom-0 right-0 rounded-full ring-background",
            dot,
            online ? "bg-emerald-500" : "bg-muted-foreground/30"
          )}
        />
      )}
    </div>
  );
}

function DateSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 h-px bg-border" />
      <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        {label}
      </span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────

/**
 * Scroll the original into view and flash it, so a quote in a long thread
 * answers "what was that about?" without the reader hunting for it.
 */
function jumpToMessage(id: string) {
  const el = document.getElementById(`msg-${id}`);
  if (!el) return;                       // scrolled out of the loaded window
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("ring-2", "ring-primary/60");
  setTimeout(() => el.classList.remove("ring-2", "ring-primary/60"), 1400);
}

/** The quoted original, shown above the reply's own text. */
function QuotedMessage({ reply, isOwn }: { reply: ReplyRef; isOwn: boolean }) {
  return (
    <button
      type="button"
      onClick={() => jumpToMessage(reply.id)}
      className={cn(
        "mb-1.5 flex w-full flex-col gap-0.5 rounded-lg border-l-[3px] px-2 py-1 text-left transition-colors",
        isOwn
          ? "border-primary-foreground/60 bg-primary-foreground/10 hover:bg-primary-foreground/20"
          : "border-primary/60 bg-primary/5 hover:bg-primary/10"
      )}
      title="Go to the message this replies to"
    >
      <span className={cn("text-[10px] font-semibold", isOwn ? "text-primary-foreground/90" : "text-primary")}>
        {reply.name}
      </span>
      <span className={cn(
        "line-clamp-2 text-[11px] leading-snug",
        isOwn ? "text-primary-foreground/70" : "text-muted-foreground"
      )}>
        {reply.preview || "Attachment"}
      </span>
    </button>
  );
}

/** Appears beside a bubble on hover. */
function ReplyButton({ onClick, isOwn }: { onClick: () => void; isOwn: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex size-7 shrink-0 items-center justify-center self-center rounded-full text-muted-foreground",
        "opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 group-hover:opacity-100",
        isOwn ? "order-first mr-1" : "ml-1"
      )}
      title="Reply"
      aria-label="Reply to this message"
    >
      <Reply className="size-3.5" />
    </button>
  );
}

function Bubble({
  msg,
  isOwn,
  monitorMode = false,
  allUsers,
  onReply,
}: {
  msg: ChatMessage;
  isOwn: boolean;
  monitorMode?: boolean;
  allUsers?: Record<string, string>; // id → name map for monitor mode
  onReply?: (m: ChatMessage) => void;
}) {
  const senderLabel = monitorMode && allUsers
    ? (allUsers[msg.from_user_id] ?? "Unknown")
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 36 }}
      className={cn("group flex flex-col", isOwn ? "items-end" : "items-start")}
    >
      {senderLabel && (
        <span className="mb-0.5 text-[10px] font-medium text-muted-foreground px-1">
          {senderLabel}
        </span>
      )}
      <div className={cn("flex w-full items-stretch", isOwn ? "justify-end" : "justify-start")}>
      {onReply && <ReplyButton isOwn={isOwn} onClick={() => onReply(msg)} />}
      <div
        id={`msg-${msg.id}`}
        className={cn(
          "max-w-[72%] rounded-2xl px-4 py-2.5 transition-shadow",
          isOwn
            ? "bg-primary text-primary-foreground rounded-br-[5px] shadow-sm"
            : "bg-card border text-foreground rounded-bl-[5px] shadow-sm"
        )}
      >
        {msg.reply_to && <QuotedMessage reply={msg.reply_to} isOwn={isOwn} />}
        {msg.content && (
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
            {msg.content}
          </p>
        )}
        <MessageExtras attachments={msg.attachments} tasks={msg.tasks} />
        <p
          className={cn(
            "mt-0.5 text-right text-[10px]",
            isOwn ? "text-primary-foreground/60" : "text-muted-foreground"
          )}
        >
          {fmtTime(msg.created_at)}
          {isOwn && !monitorMode && (
            <span className="ml-1 inline-flex items-center align-middle">
              {msg.status === "sending" ? (
                <Clock className="size-3 opacity-70" />
              ) : msg.read ? (
                <CheckCheck className="size-3.5 text-sky-300" />
              ) : (
                <Check className="size-3.5" />
              )}
            </span>
          )}
        </p>
      </div>
      </div>
    </motion.div>
  );
}

// ── My-chat window ────────────────────────────────────────────────────────────

function MyChatWindow({
  partner,
  myId,
  sendMessage,
  onBack,
}: {
  partner: ChatUser;
  myId: string;
  sendMessage: (to: string, text: string, extras?: SendExtras) => void;
  onBack?: () => void;
}) {
  const { data: messages = [], isLoading } = useChatMessages(partner.id);
  const endRef = useRef<HTMLDivElement>(null);
  const [replyTo, setReplyTo] = useState<ReplyRef | null>(null);

  // Quoting across conversations makes no sense, and the server rejects it
  // anyway — drop a half-written reply when the partner changes.
  useEffect(() => { setReplyTo(null); }, [partner.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0 border-b bg-card/60 px-4 py-3 lg:px-5 lg:py-3.5">
        {onBack && (
          <button
            onClick={onBack}
            className="-ml-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted lg:hidden"
            aria-label="Back to conversations"
          >
            <ArrowLeft className="size-5" />
          </button>
        )}
        <Avatar name={partner.name} online={partner.online} size="sm" />
        <div>
          <p className="text-sm font-semibold leading-tight">{partner.name}</p>
          <p className={cn("text-[11px]", partner.online ? "text-emerald-500 font-medium" : "text-muted-foreground")}>
            {partner.online ? "Online" : partner.designation || partner.email}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground/50" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground/40">
            <MessageSquare className="size-10" />
            <div className="text-center">
              <p className="text-sm font-medium">No messages yet</p>
              <p className="text-xs mt-0.5">Say hi to {partner.name.split(" ")[0]}! 👋</p>
            </div>
          </div>
        ) : (
          groupByDate(messages).map((g) => (
            <div key={g.date}>
              <DateSeparator label={g.date} />
              <div className="space-y-1.5">
                {g.msgs.map((m) => (
                  <Bubble
                    key={m.id}
                    msg={m}
                    isOwn={m.from_user_id === myId}
                    onReply={(x) =>
                      setReplyTo({
                        id: x.id,
                        from_user_id: x.from_user_id,
                        name: x.from_user_id === myId ? "You" : partner.name,
                        preview: x.content || (x.attachments?.length ? "Attachment" : ""),
                      })
                    }
                  />
                ))}
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <ChatComposer
        placeholder={`Message ${partner.name.split(" ")[0]}…`}
        onSend={(content, extras) => sendMessage(partner.id, content, extras)}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
      />
    </div>
  );
}

// ── Group chat ────────────────────────────────────────────────────────────────

function GroupAvatar({ name, color, size = "md" }: { name: string; color: string; size?: "sm" | "md" }) {
  const sz = size === "sm" ? "size-8" : "size-10";
  return (
    <div
      className={cn(sz, "flex items-center justify-center rounded-xl text-xs font-bold text-white shrink-0 select-none")}
      style={{ background: color || "#6366f1" }}
    >
      {(name || "?").charAt(0).toUpperCase()}
    </div>
  );
}

function groupMsgsByDate(msgs: GroupMessage[]) {
  const groups: { date: string; msgs: GroupMessage[] }[] = [];
  for (const m of msgs) {
    const d = fmtDate(m.created_at);
    if (!groups.length || groups[groups.length - 1].date !== d) groups.push({ date: d, msgs: [m] });
    else groups[groups.length - 1].msgs.push(m);
  }
  return groups;
}

function GroupBubble({ msg, isOwn, onReply }: {
  msg: GroupMessage; isOwn: boolean; onReply?: (m: GroupMessage) => void;
}) {
  if (msg.is_system) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-center"
      >
        <div className="max-w-[85%] rounded-2xl border border-primary/20 bg-primary/5 px-4 py-2.5">
          <div className="flex items-center gap-1.5 mb-1 text-primary">
            <Megaphone className="size-3.5" />
            <span className="text-[11px] font-semibold">{msg.from_user_name}</span>
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground">{msg.content}</p>
          <MessageExtras attachments={msg.attachments} tasks={msg.tasks} />
          <p className="mt-1 text-right text-[10px] text-muted-foreground">{fmtTime(msg.created_at)}</p>
        </div>
      </motion.div>
    );
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 36 }}
      className={cn("group flex flex-col", isOwn ? "items-end" : "items-start")}
    >
      {!isOwn && (
        <span className="mb-0.5 px-1 text-[10px] font-medium text-muted-foreground">{msg.from_user_name}</span>
      )}
      <div className={cn("flex w-full items-stretch", isOwn ? "justify-end" : "justify-start")}>
      {onReply && <ReplyButton isOwn={isOwn} onClick={() => onReply(msg)} />}
      <div
        id={`msg-${msg.id}`}
        className={cn(
          "max-w-[72%] rounded-2xl px-4 py-2.5 transition-shadow",
          isOwn
            ? "bg-primary text-primary-foreground rounded-br-[5px] shadow-sm"
            : "bg-card border text-foreground rounded-bl-[5px] shadow-sm"
        )}
      >
        {msg.reply_to && <QuotedMessage reply={msg.reply_to} isOwn={isOwn} />}
        {msg.content && (
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
        )}
        <MessageExtras attachments={msg.attachments} tasks={msg.tasks} />
        <p className={cn("mt-0.5 flex items-center justify-end gap-1 text-[10px]", isOwn ? "text-primary-foreground/60" : "text-muted-foreground")}>
          {fmtTime(msg.created_at)}
          {isOwn && (
            msg.status === "sending"
              ? <Clock className="size-3 opacity-70" />
              : <Check className="size-3.5" />
          )}
        </p>
      </div>
      </div>
    </motion.div>
  );
}

// ── "Send report now" dropdown (daily / weekly / monthly) ────────────────────

function SendReportMenu({ groupId, groupName }: { groupId: string; groupName: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const sendReport = useSendGroupReportNow();
  const exportPdf = useExportGroupReportPdf();
  const busy = sendReport.isPending || exportPdf.isPending;

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  function choose(period: ReportPeriod) {
    setOpen(false);
    sendReport.mutate({ groupId, period });
  }

  function exportMonthlyPdf() {
    setOpen(false);
    exportPdf.mutate({ groupId, groupName, period: "monthly" });
  }

  return (
    <div ref={ref} className="relative ml-auto shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
        title="Post a report now"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Megaphone className="size-3.5" />}
        <span className="hidden sm:inline">Send report now</span>
        <ChevronDown className={cn("size-3 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-48 overflow-hidden rounded-xl border bg-card shadow-lg">
          <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            Post to chat
          </p>
          {REPORT_PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => choose(opt.value)}
              className="flex w-full items-center px-3 py-2 text-left text-xs font-medium hover:bg-muted transition-colors"
            >
              {opt.label}
            </button>
          ))}
          <div className="my-1 border-t" />
          <button
            type="button"
            onClick={exportMonthlyPdf}
            className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium hover:bg-muted transition-colors"
          >
            <FileText className="size-3.5 text-muted-foreground" />
            Export monthly report (PDF)
          </button>
        </div>
      )}
    </div>
  );
}

function GroupChatWindow({
  group,
  myId,
  isPrivileged,
  sendGroupMessage,
  onBack,
}: {
  group: ChatGroup;
  myId: string;
  isPrivileged: boolean;
  sendGroupMessage: (groupId: string, text: string, extras?: SendExtras) => void;
  onBack?: () => void;
}) {
  const { data: messages = [], isLoading } = useGroupMessages(group.id);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const [replyTo, setReplyTo] = useState<ReplyRef | null>(null);
  // Switching groups abandons a half-written reply; the server would refuse a
  // quote from another conversation anyway.
  useEffect(() => { setReplyTo(null); }, [group.id]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0 border-b bg-card/60 px-4 py-3 lg:px-5">
        {onBack && (
          <button
            onClick={onBack}
            className="-ml-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted lg:hidden"
            aria-label="Back to conversations"
          >
            <ArrowLeft className="size-5" />
          </button>
        )}
        <GroupAvatar name={group.name} color={group.color} size="sm" />
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight truncate">{group.name}</p>
          <p className="text-[11px] text-muted-foreground truncate">
            {group.member_count} member{group.member_count !== 1 ? "s" : ""}
            {/* The company-wide group carries no scheduled report, so the
                report-group subtitle would be a plain lie there. */}
            {!group.is_common && " · Daily report at 9 PM IST"}
          </p>
        </div>
        {/* Reports are per-team; the company-wide group has no team to report on. */}
        {isPrivileged && !group.is_common && (
          <SendReportMenu groupId={group.id} groupName={group.name} />
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground/50" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground/40">
            <UsersRound className="size-10" />
            <div className="text-center">
              <p className="text-sm font-medium">No messages yet</p>
              <p className="text-xs mt-0.5">
                {group.is_common
                  ? "Say something to the whole company."
                  : "The daily report posts here at 9 PM IST."}
              </p>
            </div>
          </div>
        ) : (
          groupMsgsByDate(messages).map((g) => (
            <div key={g.date}>
              <DateSeparator label={g.date} />
              <div className="space-y-1.5">
                {g.msgs.map((m) => (
                  <GroupBubble
                    key={m.id}
                    msg={m}
                    isOwn={m.from_user_id === myId}
                    onReply={(x) =>
                      setReplyTo({
                        id: x.id,
                        from_user_id: x.from_user_id,
                        name: x.from_user_id === myId ? "You" : x.from_user_name,
                        preview: x.content || (x.attachments?.length ? "Attachment" : ""),
                      })
                    }
                  />
                ))}
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <ChatComposer
        placeholder={`Message ${group.name}…`}
        onSend={(content, extras) => sendGroupMessage(group.id, content, extras)}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
      />
    </div>
  );
}

function GroupRow({ group, selected, onClick }: { group: ChatGroup; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left cursor-pointer transition-all duration-150 outline-none",
        selected ? "bg-primary/10 shadow-sm" : "hover:bg-muted/70 active:bg-muted"
      )}
    >
      <GroupAvatar name={group.name} color={group.color} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={cn("text-sm font-medium truncate", selected ? "text-primary" : "text-foreground")}>
            {group.name}
          </span>
          {group.last_at && (
            <span className="shrink-0 text-[10px] text-muted-foreground">{fmtRelative(group.last_at)}</span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
          {group.last_message
            ? `${group.last_sender_name ? group.last_sender_name + ": " : ""}${group.last_message}`
            : `${group.member_count} member${group.member_count !== 1 ? "s" : ""}`}
        </p>
      </div>
    </button>
  );
}

// ── Monitor: conversation row ─────────────────────────────────────────────────

function ConvRow({
  conv,
  selected,
  onClick,
}: {
  conv: ConversationPair;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group w-full flex items-start gap-3 rounded-xl px-3 py-2.5 text-left",
        "cursor-pointer transition-all duration-150 outline-none",
        "focus-visible:ring-2 focus-visible:ring-primary/40",
        selected ? "bg-amber-500/10" : "hover:bg-muted/70 active:bg-muted"
      )}
    >
      {/* Overlapping avatars */}
      <div className="relative shrink-0 h-10 w-12">
        <div className="absolute left-0 top-0">
          <Avatar name={conv.user_a_name} size="sm" color="amber" />
        </div>
        <div className="absolute left-4 top-0 ring-2 ring-background rounded-full">
          <Avatar name={conv.user_b_name} size="sm" color="amber" />
        </div>
      </div>

      <div className="flex-1 min-w-0 pt-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className={cn("text-xs font-semibold truncate", selected ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>
            {conv.user_a_name}
            <span className="mx-1 opacity-50">↔</span>
            {conv.user_b_name}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {fmtRelative(conv.last_at)}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
          {conv.last_message || "No messages"}
        </p>
        <span className="text-[10px] text-muted-foreground/50">
          {conv.msg_count} message{conv.msg_count !== 1 ? "s" : ""}
        </span>
      </div>
    </button>
  );
}

// ── Monitor: read-only thread ─────────────────────────────────────────────────

function MonitorThread({ conv, onBack }: { conv: ConversationPair; onBack?: () => void }) {
  const { data: messages = [], isLoading } = useAdminMessages(conv.user_a_id, conv.user_b_id);
  const endRef = useRef<HTMLDivElement>(null);
  const userNames: Record<string, string> = {
    [conv.user_a_id]: conv.user_a_name,
    [conv.user_b_id]: conv.user_b_name,
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Monitoring banner */}
      <div className="shrink-0 flex items-center gap-3 border-b bg-amber-500/5 px-4 py-3 lg:px-5">
        {onBack && (
          <button
            onClick={onBack}
            className="-ml-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted lg:hidden"
            aria-label="Back to conversations"
          >
            <ArrowLeft className="size-5" />
          </button>
        )}
        <div className="flex items-center gap-2">
          <div className="relative h-8 w-10 shrink-0">
            <div className="absolute left-0"><Avatar name={conv.user_a_name} size="sm" color="amber" /></div>
            <div className="absolute left-4 ring-2 ring-background rounded-full"><Avatar name={conv.user_b_name} size="sm" color="amber" /></div>
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">
              {conv.user_a_name}
              <span className="mx-1.5 text-muted-foreground font-normal">↔</span>
              {conv.user_b_name}
            </p>
            <p className="text-[11px] text-muted-foreground">{conv.msg_count} messages total</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
          <Eye className="size-3" />
          Monitoring
        </div>
      </div>

      {/* Messages (read-only) */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground/50" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground/40">
            <MessageSquare className="size-8" />
            <p className="text-sm">No messages in this conversation</p>
          </div>
        ) : (
          groupByDate(messages).map((g) => (
            <div key={g.date}>
              <DateSeparator label={g.date} />
              <div className="space-y-2">
                {g.msgs.map((m) => (
                  <Bubble
                    key={m.id}
                    msg={m}
                    isOwn={m.from_user_id === conv.user_a_id}
                    monitorMode
                    allUsers={userNames}
                  />
                ))}
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {/* Read-only footer */}
      <div className="shrink-0 border-t bg-amber-500/5 px-5 py-3">
        <div className="flex items-center justify-center gap-2 text-[11px] text-amber-600/70 dark:text-amber-400/70">
          <ShieldAlert className="size-3.5" />
          Read-only monitoring · Messages refresh every 8 seconds
        </div>
      </div>
    </div>
  );
}

// ── Monitor panel (left list for Super Admin) ─────────────────────────────────

function MonitorPanel({
  selected,
  onSelect,
  hideOnMobile = false,
}: {
  selected: ConversationPair | null;
  onSelect: (c: ConversationPair) => void;
  hideOnMobile?: boolean;
}) {
  const [search, setSearch] = useState("");
  const { data: convs = [], isLoading, isError } = useAdminConversations(true);

  const filtered = convs.filter(
    (c) =>
      c.user_a_name.toLowerCase().includes(search.toLowerCase()) ||
      c.user_b_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className={cn("flex-col w-full lg:w-72 shrink-0 border-r", hideOnMobile ? "hidden lg:flex" : "flex")}>
      {/* Header */}
      <div className="shrink-0 px-4 py-4 border-b bg-amber-500/5">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1.5">
              <Eye className="size-3.5 text-amber-500" />
              <h2 className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                Monitor All Chats
              </h2>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isLoading ? "Loading…" : `${convs.length} conversation${convs.length !== 1 ? "s" : ""}`}
            </p>
          </div>
          <div className="flex size-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <ShieldAlert className="size-4" />
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="shrink-0 px-3 pt-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/60" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users…"
            className="w-full rounded-lg bg-muted/50 pl-8 pr-8 py-1.5 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition"
          />
          <AnimatePresence>
            {search && (
              <motion.button
                type="button"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2"
              >
                <X className="size-3 text-muted-foreground" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3 space-y-0.5">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-muted-foreground/50" />
          </div>
        ) : isError ? (
          <p className="py-10 text-center text-xs text-red-500/70">Failed to load conversations.</p>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">
            {search ? `No results for "${search}"` : "No conversations yet"}
          </p>
        ) : (
          filtered.map((c) => (
            <ConvRow
              key={`${c.user_a_id}___${c.user_b_id}`}
              conv={c}
              selected={
                selected?.user_a_id === c.user_a_id &&
                selected?.user_b_id === c.user_b_id
              }
              onClick={() => onSelect(c)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── People panel (left list for normal chat) ──────────────────────────────────

function PeoplePanel({
  selectedId,
  onSelect,
  selectedGroupId,
  onSelectGroup,
  hideOnMobile = false,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  selectedGroupId: string | null;
  onSelectGroup: (id: string) => void;
  hideOnMobile?: boolean;
}) {
  const [search, setSearch] = useState("");
  const { data: users = [], isLoading, isError } = useChatUsers();
  const { data: unread = {} } = useUnreadCounts();
  const { data: groups = [] } = useGroups();

  const filteredGroups = groups.filter((g) =>
    g.name.toLowerCase().includes(search.toLowerCase())
  );

  const sorted = [...users]
    .filter(
      (u) =>
        u.name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const onlineCount = users.filter((u) => u.online).length;

  return (
    <div className={cn("flex-col w-full lg:w-72 shrink-0 border-r bg-card/30", hideOnMobile ? "hidden lg:flex" : "flex")}>
      <div className="shrink-0 px-4 py-4 border-b">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">People</h2>
            {!isLoading && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {users.length} teammate{users.length !== 1 ? "s" : ""}
                {onlineCount > 0 && (
                  <span className="text-emerald-500 font-medium">
                    {" · "}{onlineCount} online
                  </span>
                )}
              </p>
            )}
          </div>
          <div className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Users className="size-4" />
          </div>
        </div>
      </div>

      <div className="shrink-0 px-3 pt-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/60" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search teammates…"
            className="w-full rounded-lg bg-muted/50 pl-8 pr-8 py-1.5 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 transition"
          />
          <AnimatePresence>
            {search && (
              <motion.button
                type="button"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2"
              >
                <X className="size-3 text-muted-foreground" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3 space-y-0.5">
        {/* Team groups */}
        {filteredGroups.length > 0 && (
          <>
            <p className="px-2 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Groups
            </p>
            {filteredGroups.map((g) => (
              <GroupRow
                key={g.id}
                group={g}
                selected={selectedGroupId === g.id}
                onClick={() => onSelectGroup(g.id)}
              />
            ))}
            <div className="my-2 border-t" />
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Direct Messages
            </p>
          </>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-muted-foreground/50" />
          </div>
        ) : isError ? (
          <p className="py-10 text-center text-xs text-red-500/70">
            Could not load teammates. Try refreshing.
          </p>
        ) : sorted.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">
            {search ? `No results for "${search}"` : "No other teammates"}
          </p>
        ) : (
          sorted.map((u) => (
            <PersonRow
              key={u.id}
              user={u}
              selected={selectedId === u.id}
              unread={unread[u.id] ?? 0}
              onClick={() => onSelect(u.id)}
            />
          ))
        )}
      </div>

      {!selectedId && sorted.length > 0 && (
        <div className="shrink-0 border-t px-4 py-3">
          <p className="text-[11px] text-center text-muted-foreground/50">
            👆 Click a person to start chatting
          </p>
        </div>
      )}
    </div>
  );
}

// ── PersonRow (used inside PeoplePanel) ───────────────────────────────────────

function PersonRow({
  user,
  selected,
  unread,
  onClick,
}: {
  user: ChatUser;
  selected: boolean;
  unread: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left",
        "cursor-pointer transition-all duration-150 outline-none",
        "focus-visible:ring-2 focus-visible:ring-primary/40",
        selected ? "bg-primary/10 shadow-sm" : "hover:bg-muted/70 active:bg-muted"
      )}
    >
      <Avatar name={user.name} online={user.online} active={selected} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={cn("text-sm font-medium truncate", selected ? "text-primary" : "text-foreground")}>
            {user.name}
          </span>
          {unread > 0 && (
            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className={cn("text-xs", user.online ? "text-emerald-500 font-medium" : "text-muted-foreground")}>
            {user.online ? "Online" : "Offline"}
          </span>
          {!user.online && user.designation && (
            <>
              <span className="text-muted-foreground/40 text-xs">·</span>
              <span className="text-xs text-muted-foreground truncate">{user.designation}</span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const me = useAuthStore((s) => s.user);
  const myId = me?.id ?? null;

  // Super Admin check — mirrors authStore.hasPermission logic
  const isSuperAdmin =
    !!me?.role?.is_system_role && me?.role?.role_name === "Super Admin";

  // Mode: "chat" = normal,  "monitor" = Super Admin surveillance
  const [mode, setMode] = useState<"chat" | "monitor">("chat");

  // Normal chat state
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const { data: users = [] } = useChatUsers();
  const { data: groups = [] } = useGroups();
  const { sendMessage, sendGroupMessage, sendRead } = useChatSocket(myId);

  const isPrivileged =
    !!me?.role && ["Super Admin", "Admin", "Coordinator"].includes(me.role.role_name);

  function selectUser(id: string) {
    setSelectedGroupId(null);
    setSelectedUserId(id);
  }
  function selectGroup(id: string) {
    setSelectedUserId(null);
    setSelectedGroupId(id);
  }
  function clearSelection() {
    setSelectedUserId(null);
    setSelectedGroupId(null);
  }

  // Monitor state
  const [selectedConv, setSelectedConv] = useState<ConversationPair | null>(null);

  // Mark as read when switching conversation
  useEffect(() => {
    if (selectedUserId) sendRead(selectedUserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserId]);

  // Reset selections when switching modes
  function switchMode(m: "chat" | "monitor") {
    setMode(m);
    setSelectedUserId(null);
    setSelectedGroupId(null);
    setSelectedConv(null);
  }

  const selectedUser = users.find((u) => u.id === selectedUserId) ?? null;
  const selectedGroup = groups.find((g) => g.id === selectedGroupId) ?? null;
  const hasSelection = !!(selectedUser || selectedGroup);

  return (
    <div
      className="-m-6 flex flex-col overflow-hidden"
      style={{ height: "calc(100vh - 56px)" }}
    >
      {/* ── Mode toggle bar (Super Admin only) ─────────────────────────── */}
      {isSuperAdmin && (
        <div className="shrink-0 flex items-center gap-1 border-b bg-card/60 px-4 py-2">
          <button
            type="button"
            onClick={() => switchMode("chat")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
              mode === "chat"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <MessageSquare className="size-3.5" />
            My Chats
          </button>
          <button
            type="button"
            onClick={() => switchMode("monitor")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
              mode === "monitor"
                ? "bg-amber-500 text-white shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Eye className="size-3.5" />
            Monitor All Chats
          </button>
          {mode === "monitor" && (
            <span className="ml-auto text-[11px] text-amber-600/70 dark:text-amber-400/70 font-medium">
              Super Admin surveillance mode
            </span>
          )}
        </div>
      )}

      {/* ── Main content ────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          {mode === "monitor" ? (
            <motion.div
              key="monitor"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex flex-1 min-h-0"
            >
              {/* Monitor left panel */}
              <MonitorPanel selected={selectedConv} onSelect={setSelectedConv} hideOnMobile={!!selectedConv} />

              {/* Monitor right panel */}
              <div className={cn("flex-1 min-w-0 min-h-0 bg-muted/10", selectedConv ? "flex" : "hidden lg:flex")}>
                <AnimatePresence mode="wait">
                  {selectedConv ? (
                    <motion.div
                      key={`${selectedConv.user_a_id}___${selectedConv.user_b_id}`}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="flex flex-1 min-h-0"
                    >
                      <MonitorThread conv={selectedConv} onBack={() => setSelectedConv(null)} />
                    </motion.div>
                  ) : (
                    <motion.div
                      key="monitor-empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground/40"
                    >
                      <div className="flex size-20 items-center justify-center rounded-3xl bg-amber-500/10">
                        <Eye className="size-9 text-amber-500/50" />
                      </div>
                      <div className="text-center space-y-1">
                        <p className="text-sm font-medium text-muted-foreground/60">
                          Select a conversation to monitor
                        </p>
                        <p className="text-xs text-muted-foreground/40">
                          All messages between teammates are visible here
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="chat"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex flex-1 min-h-0"
            >
              {/* Normal chat left panel */}
              <PeoplePanel
                selectedId={selectedUserId}
                onSelect={selectUser}
                selectedGroupId={selectedGroupId}
                onSelectGroup={selectGroup}
                hideOnMobile={hasSelection}
              />

              {/* Normal chat right panel */}
              <div className={cn("flex-1 min-w-0 min-h-0 bg-muted/10", hasSelection ? "flex" : "hidden lg:flex")}>
                <AnimatePresence mode="wait">
                  {selectedGroup && myId ? (
                    <motion.div
                      key={`group-${selectedGroup.id}`}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="flex flex-1 min-h-0"
                    >
                      <GroupChatWindow
                        group={selectedGroup}
                        myId={myId}
                        isPrivileged={isPrivileged}
                        sendGroupMessage={sendGroupMessage}
                        onBack={clearSelection}
                      />
                    </motion.div>
                  ) : selectedUser && myId ? (
                    <motion.div
                      key={selectedUser.id}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="flex flex-1 min-h-0"
                    >
                      <MyChatWindow
                        partner={selectedUser}
                        myId={myId}
                        sendMessage={sendMessage}
                        onBack={clearSelection}
                      />
                    </motion.div>
                  ) : (
                    <motion.div
                      key="chat-empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground/40"
                    >
                      <div className="flex size-20 items-center justify-center rounded-3xl bg-muted/50">
                        <MessageSquare className="size-9" />
                      </div>
                      <div className="text-center space-y-1">
                        <p className="text-sm font-medium text-muted-foreground/60">No conversation open</p>
                        <p className="text-xs text-muted-foreground/40">
                          Select a person from the left to start chatting
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
