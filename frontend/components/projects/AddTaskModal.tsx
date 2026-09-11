"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Plus, Paperclip, Link } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCreateTask } from "@/hooks/useProjects";
import { FileUploader } from "@/components/shared/FileUploader";
import { useTeams, useTeam } from "@/hooks/useTeams";
import { useUsersList } from "@/hooks/useUsers";
import { useAuthStore } from "@/stores/authStore";
import type { TaskPriority, TaskStatus, Attachment } from "@/types/project";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  defaultStatus?: TaskStatus;
  defaultTeamId?: string;
}

export function AddTaskModal({ open, onClose, defaultStatus = "pending", defaultTeamId = "" }: Props) {
  const create = useCreateTask();

  const [title, setTitle]           = useState("");
  const [description, setDesc]      = useState("");
  const [priority, setPriority]     = useState<TaskPriority>("medium");
  const [teamId, setTeamId]         = useState(defaultTeamId);
  const [assignedTo, setAssignedTo] = useState("");
  const [approverId, setApproverId] = useState("");
  const [dueDate, setDueDate]       = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // Link attachment state
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkUrl, setLinkUrl]           = useState("");
  const [linkLabel, setLinkLabel]       = useState("");

  const me = useAuthStore((s) => s.user);
  // Mirrors the server rule in workflow.can_assign_to_others: elevated roles may
  // assign to anyone, as may the leader of the selected team. Previously only
  // Super Admin counted here, so a Coordinator/Admin was silently forced to
  // self-assign — and since they often aren't a member of the target team, the
  // task ended up unassigned or unassignable.
  const ELEVATED_ROLES = ["Super Admin", "Admin", "Coordinator"];
  const isElevated = !!me?.role?.role_name && ELEVATED_ROLES.includes(me.role.role_name);

  const { data: allTeams = [] } = useTeams();
  // Elevated roles coordinate across the whole company, so they must be able to
  // create work for any team — not just teams they personally belong to.
  // (`my_role` is only set for teams the user is a member of.)
  const teams = isElevated ? allTeams : allTeams.filter((t) => !!t.my_role);
  const { data: teamDetail } = useTeam(teamId);
  const { data: usersData } = useUsersList({ limit: 100 });

  const isLeaderOfTeam = !!teamId && (teamDetail?.my_role === "leader" || teamDetail?.my_role === "admin");
  const canAssignOthers = isElevated || isLeaderOfTeam;

  const assigneeOptions = useMemo(() => {
    if (teamId && teamDetail?.members) {
      return teamDetail.members.map((m) => ({ id: m.user_id, name: m.name || m.email }));
    }
    return (usersData?.users ?? []).map((u) => ({ id: u.id, name: u.name || u.email }));
  }, [teamId, teamDetail, usersData]);

  // Approver candidates come from the team's own member list — the server
  // rejects anyone outside it (workflow.is_team_member).
  const approverOptions = useMemo(() => {
    if (!teamId || !teamDetail?.members) return [];
    return teamDetail.members.map((m) => ({
      id: m.user_id,
      name: m.name || m.email,
      role: m.role,
      designation: m.designation,
    }));
  }, [teamId, teamDetail]);

  function reset() {
    setTitle(""); setDesc(""); setPriority("medium");
    setTeamId(defaultTeamId);
    setAssignedTo(""); setApproverId(""); setDueDate(""); setAttachments([]);
    setShowLinkForm(false); setLinkUrl(""); setLinkLabel("");
  }

  function close() { reset(); onClose(); }

  function addLink() {
    let url = linkUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    const attachment: Attachment = {
      url,
      key: url,
      filename: linkLabel.trim() || url,
      size: 0,
      content_type: "url",
      backend: "url",
    };
    setAttachments((prev) => [...prev, attachment]);
    setLinkUrl(""); setLinkLabel(""); setShowLinkForm(false);
  }

  // A task is only actionable with a name, a team, an owner and a due date.
  // Mirrors the server-side rules in POST /projects.
  const finalAssigneeId = canAssignOthers ? assignedTo : (me?.id ?? "");
  const missing: string[] = [];
  if (!title.trim())     missing.push("a task name");
  if (!teamId)           missing.push("a team");
  if (!finalAssigneeId)  missing.push("an assignee");
  if (!dueDate)          missing.push("a due date");
  const canSubmit = missing.length === 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) {
      toast.error(`Please add ${missing.join(", ")}.`);
      return;
    }
    const finalAssignee = canAssignOthers ? assignedTo : (me?.id ?? "");
    const finalAssigneeName = canAssignOthers
      ? (assigneeOptions.find(o => o.id === assignedTo)?.name ?? "")
      : (me?.name ?? "");
    await create.mutateAsync({
      title: title.trim(),
      description,
      priority,
      status: "pending",
      team_id: teamId || null,
      assigned_to: finalAssignee,
      assigned_to_name: finalAssigneeName,
      due_date: dueDate || null,
      attachments,
      // Only send when the user may actually set it; the server enforces the
      // same rule and would 403 otherwise.
      ...(canAssignOthers && approverId
        ? {
            approver_id: approverId,
            approver_name: approverOptions.find((o) => o.id === approverId)?.name ?? "",
          }
        : {}),
    });
    close();
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={close}
          />

          <motion.div
            key="modal"
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
          >
            <form
              onSubmit={submit}
              className="pointer-events-auto w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border bg-card shadow-2xl flex flex-col gap-4 p-6"
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10">
                    <Plus className="size-4 text-primary" />
                  </div>
                  <h2 className="font-semibold text-base">Add Task</h2>
                </div>
                <button type="button" onClick={close} className="rounded-md p-1 hover:bg-muted transition-colors">
                  <X className="size-4 text-muted-foreground" />
                </button>
              </div>

              {/* Title */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Title *</label>
                <input
                  autoFocus
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Task title..."
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition"
                />
              </div>

              {/* Description */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Description</label>
                <textarea
                  value={description}
                  onChange={e => setDesc(e.target.value)}
                  placeholder="Optional details..."
                  rows={3}
                  className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition"
                />
              </div>

              {/* Team */}
              {teams.length > 0 && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Team *</label>
                  <select
                    value={teamId}
                    onChange={e => { setTeamId(e.target.value); setAssignedTo(""); }}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition"
                  >
                    <option value="">Select a team…</option>
                    {teams.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Priority */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Starts in</label>
                  <div className="w-full rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ background: "#f59e0b" }} />
                    Pending
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Priority</label>
                  <select
                    value={priority}
                    onChange={e => setPriority(e.target.value as TaskPriority)}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>

              {/* Assigned To + Due Date */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Assigned To *</label>
                  {canAssignOthers ? (
                    <select
                      value={assignedTo}
                      onChange={e => setAssignedTo(e.target.value)}
                      className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition"
                    >
                      <option value="">Unassigned</option>
                      {assigneeOptions.map(o => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                  ) : (
                    <div
                      className="w-full rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground truncate"
                      title="Only a team leader can assign tasks to others"
                    >
                      {me?.name ? `${me.name} (you)` : "You"}
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Due Date *</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={e => setDueDate(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition"
                  />
                </div>
              </div>

              {/* Approver — leader/admin only, matching the server gate */}
              {canAssignOthers && teamId && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Approved By
                  </label>
                  <select
                    value={approverId}
                    onChange={e => setApproverId(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition"
                  >
                    <option value="">Team leaders only (default)</option>
                    {approverOptions.map(o => (
                      <option key={o.id} value={o.id}>
                        {o.name}{o.role === "leader" ? " · Leader" : ""}
                        {o.designation ? ` — ${o.designation}` : ""}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground">
                    Lets a chosen member approve this task, not just team leaders.
                    Leaders keep their approval rights either way.
                  </p>
                  {approverId && approverId === assignedTo && (
                    <p className="text-[11px] text-amber-600">
                      This person would approve their own work.
                    </p>
                  )}
                </div>
              )}

              {/* Attachments */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Paperclip className="size-3" /> Attachments
                </label>

                {/* Direct-to-R2 uploader (files up to 1 GB) + combined file/link list */}
                <FileUploader value={attachments} onChange={setAttachments} label="Upload files" />

                <button
                  type="button"
                  onClick={() => setShowLinkForm(v => !v)}
                  className={cn(
                    "flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed py-2.5 transition-colors",
                    showLinkForm
                      ? "border-primary/60 bg-primary/5 text-primary"
                      : "border-border hover:border-primary/50 hover:bg-muted/30"
                  )}
                >
                  <Link className="size-4" />
                  <span className="text-xs font-medium">Add link</span>
                </button>

                {/* Inline link form */}
                <AnimatePresence>
                  {showLinkForm && (
                    <motion.div
                      key="link-form"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.18 }}
                      className="overflow-hidden"
                    >
                      <div className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-3">
                        <input
                          autoFocus
                          value={linkUrl}
                          onChange={e => setLinkUrl(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }}
                          placeholder="https://..."
                          className="w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition"
                        />
                        <input
                          value={linkLabel}
                          onChange={e => setLinkLabel(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }}
                          placeholder="Label (optional)"
                          className="w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => { setShowLinkForm(false); setLinkUrl(""); setLinkLabel(""); }}
                            className="rounded-md border px-3 py-1 text-xs hover:bg-muted transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={addLink}
                            disabled={!linkUrl.trim()}
                            className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Footer */}
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" size="sm" onClick={close}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!canSubmit || create.isPending}
                  title={canSubmit ? undefined : `Please add ${missing.join(", ")}`}
                >
                  {create.isPending ? "Creating…" : "Create Task"}
                </Button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
