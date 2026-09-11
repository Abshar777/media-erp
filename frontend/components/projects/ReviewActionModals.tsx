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
import { CheckCircle2, RotateCcw, Loader2, X, ChevronDown, Crown, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUpdateTask } from "@/hooks/useProjects";
import { useAllTeams, useTeam } from "@/hooks/useTeams";
import type { Task, UpdateTaskPayload } from "@/types/project";
import { toast } from "sonner";

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
        className={`w-full ${wide ? "max-w-md" : "max-w-sm"} rounded-2xl border bg-card shadow-2xl overflow-hidden`}
      >
        <Panel onSubmit={onSubmit}>
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div className="flex items-center gap-2">
              {icon}
              <h2 className="text-sm font-semibold">{title}</h2>
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
              <X className="size-4" />
            </button>
          </div>
          <div className="p-5 space-y-4">{children}</div>
          <div className="flex justify-end gap-3 border-t px-5 py-4">{footer}</div>
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
            disabled={update.isPending}
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
      <p className="text-xs text-muted-foreground">
        Task: <span className="font-medium text-foreground">{task.title}</span>
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
            <p className="flex items-center gap-1 text-[11px] text-amber-600">
              <AlertTriangle className="size-3" />
              This person would approve their own work.
            </p>
          )}
        </div>
      )}
    </Shell>
  );
}

// ── Send to reedit (reason required) ──────────────────────────────────────────

export function ReeditModal({
  task, onClose, onDone,
}: {
  task: Task;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [reason, setReason] = useState("");
  const update = useUpdateTask();

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
        <p className="text-xs text-muted-foreground">
          Task: <span className="font-medium text-foreground">{task.title}</span>
        </p>
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
