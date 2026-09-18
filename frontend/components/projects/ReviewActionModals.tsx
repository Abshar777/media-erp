"use client";

/**
 * Shared pending-review action modals.
 *
 * A task leaving `pending_review` is a decision, not a drag: approving may
 * hand the work to another team, and a reedit needs a reason the member can
 * act on. Both the Leader Desk and the Projects board therefore route those
 * two transitions through these modals instead of firing a bare status PUT.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  RotateCcw,
  Loader2,
  X,
  ChevronDown,
  Crown,
  AlertTriangle,
  Users,
  UserPlus,
  Send,
  CalendarDays,
  ShieldCheck,
  Paperclip,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useUpdateTask } from "@/hooks/useProjects";
import { FileUploader } from "@/components/shared/FileUploader";
import { GrowTextarea } from "@/components/shared/GrowTextarea";
import { useRemindVerifiers } from "@/hooks/useVerify";
import { useAllTeams, useTeam } from "@/hooks/useTeams";
import type { Attachment, Task, UpdateTaskPayload } from "@/types/project";
import { PRIORITY_META, assigneeLabel, pendingVerifiers } from "@/types/project";
import { fmtDateOnly } from "@/lib/datetime";
import { toast } from "sonner";

// ── Task context ──────────────────────────────────────────────────────────────

/**
 * The facts a reviewer needs before deciding, without leaving the modal:
 * who raised it, who did the work and what they said about it, how urgent it
 * is, where it currently sits, and who is allowed to sign it off.
 */
function TaskContext({ task, teamName }: { task: Task; teamName?: string }) {
  const [noteOpen, setNoteOpen] = useState(false);
  const priority = PRIORITY_META[task.priority] ?? PRIORITY_META.medium;
  // The creator is stored as an id; its display name only exists on the
  // "created" history entry, which every task gets at insert time.
  const creator = task.history?.find((h) => h.action === "created")?.actor_name;
  const submitter = assigneeLabel(task);

  return (
    <div className="rounded-xl border bg-muted/30 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0", priority.color)}>
          {priority.label}
        </span>
        <p className="text-sm font-medium leading-snug">{task.title}</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {teamName && (
          <span className="flex items-center gap-1">
            <Users className="size-3" />
            {teamName}
            {task.former_team_name && (
              <span className="text-amber-600"> · routed from {task.former_team_name}</span>
            )}
          </span>
        )}
        {creator && (
          <span className="flex items-center gap-1">
            <UserPlus className="size-3" /> Created by {creator}
            {task.created_at && <> · {fmtDateOnly(task.created_at)}</>}
          </span>
        )}
        {submitter && (
          <span className="flex items-center gap-1">
            <Send className="size-3" /> Submitted by {submitter}
          </span>
        )}
        {task.due_date && (
          <span className="flex items-center gap-1">
            <CalendarDays className="size-3" /> Due {fmtDateOnly(task.due_date)}
          </span>
        )}
      </div>

      {/* The note and screenshots are the case being made for approval, so
          they belong in front of whoever is about to decide — not one tab away
          in the task panel. */}
      {task.caption && (
        <div className="rounded-lg border-l-2 border-primary/40 bg-background/60 px-2.5 py-1.5">
          <p className={cn(
            "whitespace-pre-wrap text-xs italic leading-relaxed text-foreground/80",
            !noteOpen && "line-clamp-3"
          )}>
            &ldquo;{task.caption}&rdquo;
          </p>
          {task.caption.length > 180 && (
            <button
              type="button"
              onClick={() => setNoteOpen((v) => !v)}
              className="mt-1 text-[11px] font-medium text-primary hover:underline"
            >
              {noteOpen ? "Show less" : "Show full note"}
            </button>
          )}
        </div>
      )}

      {(task.submission_attachments?.length ?? 0) > 0 && (
        <div className="space-y-1">
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Paperclip className="size-3" /> Submitted screenshots
          </p>
          <FileUploader value={task.submission_attachments ?? []} readOnly compact />
        </div>
      )}
    </div>
  );
}

function Shell({
  title, icon, onClose, children, footer, wide, onSubmit,
}: {
  title: string;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
  wide?: boolean;
  /** When given, the panel is a <form> and this runs on submit (Enter included). */
  onSubmit?: (e: React.FormEvent) => void;
}) {
  // The panel is a <form> only when a submit handler is supplied. It must live
  // INSIDE the portal: a submit button rendered through a portal is no longer a
  // DOM descendant of a <form> left behind in the original tree, so native
  // submission would never fire.
  const Panel = onSubmit ? "form" : "div";

  const overlay = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className={`w-full ${wide ? "max-w-md" : "max-w-sm"} max-h-[90vh] flex flex-col rounded-2xl border bg-card shadow-2xl overflow-hidden`}
      >
        {/* Header and footer stay pinned; only the body scrolls, so a tall task
            context can never push the Approve button off a short screen. */}
        <Panel onSubmit={onSubmit} className="flex flex-col min-h-0 flex-1">
          <div className="flex items-center justify-between border-b px-5 py-4 shrink-0">
            <div className="flex items-center gap-2">
              {icon}
              <h2 className="text-sm font-semibold">{title}</h2>
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
              <X className="size-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-4">{children}</div>
          <div className="flex justify-end gap-3 border-t px-5 py-4 shrink-0">{footer}</div>
        </Panel>
      </motion.div>
    </div>
  );

  // Portal to <body>. KanbanCard sets `transform` / `will-change: transform`
  // (dnd-kit), and either one makes the card a containing block for
  // position:fixed descendants — which pinned this overlay inside the card
  // instead of covering the viewport.
  return typeof document === "undefined"
    ? overlay
    : createPortal(overlay, document.body);
}

// ── Approve (+ optional routing) ──────────────────────────────────────────────

export function ApproveRouteModal({
  task, onClose, onDone,
}: {
  task: Task;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [destTeamId, setDestTeamId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [approverId, setApproverId] = useState("");
  const update = useUpdateTask();
  const { data: allTeams = [] } = useAllTeams();

  // Members load only once a destination team is chosen — useTeam is disabled
  // on an empty id, so picking "no routing" costs no request.
  const { data: destTeam, isLoading: membersLoading } = useTeam(destTeamId);
  const members = destTeam?.members ?? [];
  const ownTeamName = allTeams.find((t) => t.id === task.team_id)?.name;
  const outstanding = pendingVerifiers(task);
  const remind = useRemindVerifiers(task.id);

  function pickTeam(id: string) {
    setDestTeamId(id);
    // Stale people from the previous team must not survive the switch — the
    // server would reject them anyway, since both must be members of the
    // destination team.
    setAssigneeId("");
    setApproverId("");
  }

  async function confirm() {
    const payload: UpdateTaskPayload = { status: "approved" };
    if (destTeamId) {
      payload.destination_team_id = destTeamId;
      const m = members.find((x) => x.user_id === assigneeId);
      if (m) {
        payload.next_leader_id = m.user_id;
        payload.next_leader_name = m.name;
      }
      const ap = members.find((x) => x.user_id === approverId);
      if (ap) {
        payload.next_approver_id = ap.user_id;
        payload.next_approver_name = ap.name;
      }
    }
    await update.mutateAsync({ id: task.id, payload });

    if (destTeamId) {
      const teamName = allTeams.find((t) => t.id === destTeamId)?.name ?? "the selected team";
      const who = members.find((x) => x.user_id === assigneeId)?.name;
      toast.success(
        who ? `Approved — sent to ${who} (${teamName})` : `Approved — sent to ${teamName}'s Leader Desk`
      );
    } else {
      toast.success("Task approved");
    }
    onDone?.();
    onClose();
  }

  return (
    <Shell
      title="Approve Task"
      icon={<CheckCircle2 className="size-4 text-green-600" />}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={confirm}
            disabled={update.isPending || outstanding.length > 0}
            title={outstanding.length > 0 ? "Every verifier must sign off first" : undefined}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {update.isPending
              ? <Loader2 className="size-4 animate-spin mr-1.5" />
              : <CheckCircle2 className="size-4 mr-1.5" />}
            {destTeamId ? "Approve & Route" : "Approve"}
          </Button>
        </>
      }
    >
      <TaskContext task={task} teamName={ownTeamName} />

      {/* Verification gate. The server refuses the approval anyway; showing it
          here means the button doesn't fail after the fact. */}
      {outstanding.length > 0 && (
        <div className="space-y-2 rounded-xl border border-amber-400/30 bg-amber-500/5 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="size-4 shrink-0 text-amber-600 mt-0.5" />
            <div className="space-y-1">
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                Waiting on {outstanding.length} of {(task.verifications ?? []).length} verifiers
              </p>
              <p className="text-[11px] text-muted-foreground">
                {outstanding.map((v) => v.name).join(", ")} still to sign off.
              </p>
            </div>
          </div>
          {/* Chasing is the useful thing to do from here — otherwise you close
              the modal and go hunting for them yourself. */}
          <Button
            size="sm" variant="outline"
            disabled={remind.isPending}
            onClick={() => remind.mutate()}
            className="w-full"
          >
            {remind.isPending
              ? <Loader2 className="size-4 animate-spin mr-1.5" />
              : <Send className="size-4 mr-1.5" />}
            Send them a reminder now
          </Button>
        </div>
      )}

      {/* Who may sign THIS task off. Read-only: you are approving it in this
          same click, so its approver can never be used afterwards — showing the
          rule is useful, offering a control here would be a no-op. */}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 shrink-0 text-green-600" />
        Approval by{" "}
        <span className="font-medium text-foreground">
          {task.approver_name
            ? `${task.approver_name} (named approver)`
            : "this team's leaders"}
        </span>
      </p>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">
          Route to team <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <p className="text-xs text-muted-foreground">
          A copy of this task will appear in the selected team&apos;s incoming queue.
        </p>
        <div className="relative">
          <select
            value={destTeamId}
            onChange={(e) => pickTeam(e.target.value)}
            className="w-full appearance-none rounded-lg border bg-background px-3 py-2 pr-8 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          >
            <option value="">No routing — approve only</option>
            {allTeams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
        </div>
      </div>

      {destTeamId && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            Assign to <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <p className="text-xs text-muted-foreground">
            Leave unset to drop it in the team&apos;s queue for any leader to pick up.
          </p>
          <div className="relative">
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              disabled={membersLoading || members.length === 0}
              className="w-full appearance-none rounded-lg border bg-background px-3 py-2 pr-8 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
            >
              <option value="">
                {membersLoading
                  ? "Loading members…"
                  : members.length === 0
                    ? "No members in this team"
                    : "Unassigned — whole team"}
              </option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}{m.role === "leader" ? " · Leader" : ""}
                  {m.designation ? ` — ${m.designation}` : ""}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          </div>
          {assigneeId && members.find((m) => m.user_id === assigneeId)?.role === "leader" && (
            <p className="flex items-center gap-1 text-[11px] text-amber-600">
              <Crown className="size-3" /> Team leader
            </p>
          )}
        </div>
      )}

      {destTeamId && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            Approved by <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <p className="text-xs text-muted-foreground">
            This person may approve the routed task even if they are not a team
            leader. Leave unset and only the destination team&apos;s leaders can.
          </p>
          <div className="relative">
            <select
              value={approverId}
              onChange={(e) => setApproverId(e.target.value)}
              disabled={membersLoading || members.length === 0}
              className="w-full appearance-none rounded-lg border bg-background px-3 py-2 pr-8 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
            >
              <option value="">
                {membersLoading ? "Loading members…" : "Team leaders only (default)"}
              </option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}{m.role === "leader" ? " · Leader" : ""}
                  {m.designation ? ` — ${m.designation}` : ""}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          </div>
          {approverId && approverId === assigneeId && (
            <p className="flex items-start gap-1 text-[11px] text-amber-600">
              <AlertTriangle className="size-3 mt-0.5 shrink-0" />
              <span>
                This is the same person doing the work. Unless they lead the
                destination team, they won&apos;t be able to approve it —
                a team leader will have to.
              </span>
            </p>
          )}
        </div>
      )}
    </Shell>
  );
}

// ── Send to reedit (reason required) ──────────────────────────────────────────

/**
 * Submit for review, from wherever the move was made.
 *
 * Entering review requires a note saying what was done — enforced on the
 * server — so the quick paths that just set a status (the card's dropdown,
 * the table's, dragging onto the column) have to ask for one too. Without
 * this they simply failed, which read as the board being broken rather than
 * as a missing note.
 */
export function SubmitReviewModal({
  task, onClose, onDone,
}: {
  task: Task;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [note, setNote] = useState("");
  const [shots, setShots] = useState<Attachment[]>([]);
  const update = useUpdateTask();
  const { data: allTeams = [] } = useAllTeams();
  const teamName = allTeams.find((t) => t.id === task.team_id)?.name;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    await update.mutateAsync({
      id: task.id,
      payload: {
        status: "pending_review",
        caption: note.trim(),
        submission_attachments: shots,
      },
    });
    toast.success("Submitted for review");
    onDone?.();
    onClose();
  }

  return (
    <Shell
      wide
      onSubmit={submit}
      title="Submit for Review"
      icon={<Send className="size-4 text-purple-500" />}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            disabled={!note.trim() || update.isPending}
            className="bg-purple-600 text-white hover:bg-purple-700"
          >
            {update.isPending
              ? <Loader2 className="mr-1.5 size-4 animate-spin" />
              : <Send className="mr-1.5 size-4" />}
            Submit
          </Button>
        </>
      }
    >
      <TaskContext task={task} teamName={teamName} />

      <GrowTextarea
        autoFocus
        value={note}
        onChange={setNote}
        minRows={3}
        maxRows={8}
        placeholder="e.g. Completed design mockups and updated the colour scheme…"
        label={<label className="text-sm font-medium">Submission note *</label>}
        hint={
          <p className="text-xs text-muted-foreground">
            Briefly explain what you completed or updated. Required.
          </p>
        }
      />

      <div className="space-y-1.5">
        <p className="flex items-center gap-1 text-sm font-medium">
          <Paperclip className="size-3.5" /> Screenshots
          <span className="text-xs font-normal text-muted-foreground">(optional)</span>
        </p>
        <FileUploader
          value={shots}
          onChange={setShots}
          compact
          label="Add a screenshot"
        />
      </div>
    </Shell>
  );
}

export function ReeditModal({
  task, onClose, onDone,
}: {
  task: Task;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [reason, setReason] = useState("");
  const update = useUpdateTask();
  const { data: allTeams = [] } = useAllTeams();
  const teamName = allTeams.find((t) => t.id === task.team_id)?.name;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    await update.mutateAsync({
      id: task.id,
      payload: { status: "reedit", reedit_reason: reason.trim() },
    });
    toast.success("Task sent to reedit");
    onDone?.();
    onClose();
  }

  return (
      <Shell
        wide
        onSubmit={submit}
        title="Send to Reedit"
        icon={<RotateCcw className="size-4 text-rose-500" />}
        onClose={onClose}
        footer={
          <>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              type="submit"
              disabled={!reason.trim() || update.isPending}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {update.isPending
                ? <Loader2 className="size-4 animate-spin mr-1.5" />
                : <RotateCcw className="size-4 mr-1.5" />}
              Send to Reedit
            </Button>
          </>
        }
      >
        <TaskContext task={task} teamName={teamName} />
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Reason</label>
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            placeholder="Explain what needs to change so the original team knows how to fix it…"
            className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
        </div>
      </Shell>
  );
}
