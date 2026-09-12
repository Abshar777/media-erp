"use client";

/**
 * Hand your own task to a teammate.
 *
 * Distinct from a leader reassigning work: this is the peer-level handover any
 * employee may do for a task assigned to them. The reason is mandatory — it is
 * what makes the handover accountable afterwards, and the server rejects a
 * blank one regardless of what this form allows.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { ArrowLeftRight, Loader2, X, ChevronDown, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUpdateTask } from "@/hooks/useProjects";
import { useTeam } from "@/hooks/useTeams";
import { useAuthStore } from "@/stores/authStore";
import type { Task } from "@/types/project";
import { assigneeLabel } from "@/types/project";
import { toast } from "sonner";

export function TransferTaskModal({
  task, onClose, onDone,
}: {
  task: Task;
  onClose: () => void;
  onDone?: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const [toId, setToId] = useState("");
  const [reason, setReason] = useState("");
  const update = useUpdateTask();

  const { data: team, isLoading: membersLoading } = useTeam(task.team_id ?? "");
  // The server keeps a transfer inside the task's team, and there is no point
  // offering the person who already holds it — or yourself.
  const candidates = (team?.members ?? []).filter(
    (m) => m.user_id !== task.assigned_to && m.user_id !== me?.id
  );

  const picked = candidates.find((m) => m.user_id === toId);
  const canSubmit = !!toId && !!reason.trim() && !update.isPending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    await update.mutateAsync({
      id: task.id,
      payload: {
        transfer_to_id: toId,
        transfer_to_name: picked?.name ?? "",
        transfer_reason: reason.trim(),
      },
    });
    toast.success(`Transferred to ${picked?.name ?? "your teammate"}`);
    onDone?.();
    onClose();
  }

  const overlay = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-md max-h-[90vh] flex flex-col rounded-2xl border bg-card shadow-2xl overflow-hidden"
      >
        <form onSubmit={submit} className="flex flex-col min-h-0 flex-1">
          <div className="flex items-center justify-between border-b px-5 py-4 shrink-0">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="size-4 text-sky-500" />
              <h2 className="text-sm font-semibold">Transfer Task</h2>
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
              <X className="size-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div className="rounded-xl border bg-muted/30 p-3 space-y-1">
              <p className="text-sm font-medium leading-snug">{task.title}</p>
              <p className="text-[11px] text-muted-foreground">
                Currently with {assigneeLabel(task) || "nobody"}
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Transfer to *</label>
              <div className="relative">
                <select
                  value={toId}
                  onChange={(e) => setToId(e.target.value)}
                  disabled={membersLoading || candidates.length === 0}
                  className="w-full appearance-none rounded-lg border bg-background px-3 py-2 pr-8 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
                >
                  <option value="">
                    {membersLoading
                      ? "Loading teammates…"
                      : candidates.length === 0
                        ? "No one else on this team"
                        : "Choose a teammate…"}
                  </option>
                  {candidates.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.name}{m.role === "leader" ? " · Leader" : ""}
                      {m.designation ? ` — ${m.designation}` : ""}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              </div>
              {picked?.role === "leader" && (
                <p className="flex items-center gap-1 text-[11px] text-amber-600">
                  <Crown className="size-3" /> This person leads the team.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Reason *</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Why are you handing this over? Both of you get this in writing."
                className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
              />
            </div>

            <p className="text-[11px] text-muted-foreground">
              Both of you are notified by email, and the handover is recorded in
              the task history. The task keeps its current status.
            </p>
          </div>

          <div className="flex justify-end gap-3 border-t px-5 py-4 shrink-0">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="bg-sky-600 hover:bg-sky-700 text-white"
            >
              {update.isPending
                ? <Loader2 className="size-4 animate-spin mr-1.5" />
                : <ArrowLeftRight className="size-4 mr-1.5" />}
              Transfer
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  );

  // Portal for the same reason the review modals need one: a Kanban card sets
  // will-change:transform, which makes it a containing block for fixed children.
  return typeof document === "undefined" ? overlay : createPortal(overlay, document.body);
}
