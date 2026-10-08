"use client";

import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Plus, Paperclip, Link, UserPlus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCreateTask, useCreateTaskBatch } from "@/hooks/useProjects";
import { FileUploader } from "@/components/shared/FileUploader";
import { useAllTeams, useTeam, useTeams, useAssignableUsers } from "@/hooks/useTeams";
import { VerifierPicker } from "@/components/projects/VerifierPicker";
import { UserPicker } from "@/components/teams/UserPicker";
import { RepeatField, REPEAT_DEFAULT, type RepeatValue } from "@/components/projects/RepeatField";
import { TaskNameCombobox } from "@/components/projects/TaskNameCombobox";
import type { Suggestion } from "@/lib/taskPresets";
import { istTodayKey } from "@/lib/datetime";
import { useCanApprove } from "@/hooks/useCanApprove";
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
  const createBatch = useCreateTaskBatch();

  const [title, setTitle]           = useState("");
  const [description, setDesc]      = useState("");
  const [priority, setPriority]     = useState<TaskPriority>("medium");
  // What a saved task just filled in (and what was there before), for "Undo".
  const [filled, setFilled] = useState<null | { fields: string[]; prev: { description: string; priority: TaskPriority; teamId: string } }>(null);
  const [teamId, setTeamId]         = useState(defaultTeamId);
  // Several people may be picked; each gets their own copy (see POST /projects/batch).
  const [assignees, setAssignees]   = useState<string[]>([]);
  // The rules below (approver warning, default verifier, self-assign) were
  // written for one assignee; they read the first, which is exact for the
  // common single-person case. The server applies them per copy regardless.
  const assignedTo = assignees[0] ?? "";
  // "first": open until the first pick, then collapses — one click for the
  // usual single assignee. "multi": opened via "Add more", stays open.
  const [pickerMode, setPickerMode] = useState<"first" | "multi" | "closed">("first");
  const [repeat, setRepeat]         = useState<RepeatValue>(REPEAT_DEFAULT);
  const repeating = repeat.frequency !== "once";
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

  // Every team, for everyone. Work is raised across team lines, so showing
  // only your own left people asking a colleague to type it in for them.
  // /teams/all is open to any authenticated user — team names aren't sensitive.
  const { data: teams = [] } = useAllTeams();
  const { data: teamDetail } = useTeam(teamId);
  // The company directory, also open to any authenticated user. useUsersList
  // hits /users, which needs the users:view permission and 403s for an
  // Employee — that is why the assignee list used to come up empty for them.
  const { data: directory = [] } = useAssignableUsers();
  const canApprove = useCanApprove();

  // Whoever raises the work checks the result — unless they could approve it
  // themselves, in which case they would only be signing the same task twice.
  // Mirrors the server rule in add_task; the server is the real gate.
  const creatorWouldApprove = canApprove({
    team_id: teamId || null,
    assigned_to: assignedTo,
    approver_id: approverId,
  });
  const [verifyUsers, setVerifyUsers] = useState<string[]>([]);
  const [verifyTeams, setVerifyTeams] = useState<string[]>([]);
  // Touched once the user adds or removes anybody, so their choice — including
  // the choice of nobody — is sent as-is rather than re-defaulted server-side.
  const [verifyTouched, setVerifyTouched] = useState(false);

  // The default follows the form: change the team or the assignee and whether
  // you could approve it changes with them.
  useEffect(() => {
    if (verifyTouched) return;
    setVerifyUsers(!creatorWouldApprove && me?.id ? [me.id] : []);
  }, [creatorWouldApprove, me?.id, verifyTouched]);

  const isLeaderOfTeam = !!teamId && (teamDetail?.my_role === "leader" || teamDetail?.my_role === "admin");

  // Choosing the approver stays leader/admin only (workflow.can_assign_to_others):
  // it grants approval rights, so an employee must not be able to name
  // themselves and sign off their own work.
  const canSetApprover = isElevated || isLeaderOfTeam;

  // Scoped to the chosen team once there is one — that is almost always who
  // you mean, and picking from 4 names beats picking from 24. With no team
  // chosen there is nothing to scope by, so the whole company is offered.
  //
  // Cross-team assignment is still allowed by the server; this only decides
  // what the list defaults to showing.
  const assigneeOptions = useMemo(() => {
    const all = directory.map((u) => ({
      id: u.id,
      name: u.name || u.email,
      designation: u.designation,
    }));
    if (!teamId || !teamDetail?.members) return all;
    const inTeam = new Set(teamDetail.members.map((m) => m.user_id));
    const scoped = all.filter((u) => inTeam.has(u.id));
    // An empty team would otherwise leave nobody to assign to at all.
    return scoped.length > 0 ? scoped : all;
  }, [directory, teamId, teamDetail]);

  // Same list as assigneeOptions, but as full user records for UserPicker.
  const assigneeUsers = useMemo(() => {
    if (!teamId || !teamDetail?.members) return directory;
    const inTeam = new Set(teamDetail.members.map((m) => m.user_id));
    const scoped = directory.filter((u) => inTeam.has(u.id));
    return scoped.length > 0 ? scoped : directory;
  }, [directory, teamId, teamDetail]);

  const nameOf = (id: string) => {
    const u = directory.find((x) => x.id === id);
    return u?.name || u?.email || "Unknown";
  };

  function toggleAssignee(id: string) {
    setAssignees((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    if (pickerMode === "first") setPickerMode("closed");
  }

  // Repeating keeps assigning work on someone's behalf, so — like naming an
  // approver — it's for team leaders and admin roles. Mirrors the server rule
  // (recurrence.can_create_series → workflow.can_assign_to_others).
  const canRepeat = isElevated || isLeaderOfTeam;
  const { data: myTeams = [] } = useTeams();
  const leadsAnyTeam = myTeams.some((t) => t.my_role === "leader");
  useEffect(() => {
    // e.g. switching to a team you don't lead: drop back to a one-off task
    // rather than submit something the server will refuse.
    if (!canRepeat && repeating) setRepeat((r) => ({ ...r, frequency: "once" }));
  }, [canRepeat, repeating]);

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
    setTitle(""); setDesc(""); setPriority("medium"); setFilled(null);
    setTeamId(defaultTeamId);
    setAssignees([]); setPickerMode("first"); setRepeat(REPEAT_DEFAULT);
    setApproverId(""); setDueDate(""); setAttachments([]);
    setShowLinkForm(false); setLinkUrl(""); setLinkLabel("");
    setVerifyUsers([]); setVerifyTeams([]); setVerifyTouched(false);
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

  // A task is only actionable with a name, an owner and a due date. A team is
  // needed only when the work is for someone else — it is the board their
  // leader reviews. Taking something on yourself needs no team, so an employee
  // on no team can still raise their own work. Mirrors POST /projects.
  // "Just me": no team needed. Anyone else in the list makes a team required —
  // the same rule the server applies (raise_task, and up front in /batch).
  const isSelfAssigned = assignees.length === 1 && assignees[0] === me?.id;
  const missing: string[] = [];
  if (!title.trim())                    missing.push("a task name");
  if (!teamId && !isSelfAssigned)       missing.push("a team");
  if (assignees.length === 0)           missing.push("an assignee");
  // A repeating task's due dates come from the schedule ("each copy due…").
  if (!repeating && !dueDate)           missing.push("a due date");
  const canSubmit = missing.length === 0;
  const pending = create.isPending || createBatch.isPending;
  const useBatch = assignees.length > 1 || repeating;

  const submitLabel = pending
    ? "Creating…"
    : repeating
    ? "Start repeating"
    : assignees.length > 1
    ? `Create ${assignees.length} tasks`
    : "Create Task";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) {
      toast.error(`Please add ${missing.join(", ")}.`);
      return;
    }

    // Shared by both paths.
    const common = {
      title: title.trim(),
      description,
      priority,
      status: "pending" as const,
      team_id: teamId || null,
      attachments,
      verify_users: verifyUsers,
      verify_teams: verifyTeams,
      ...(canSetApprover && approverId
        ? {
            approver_id: approverId,
            approver_name: approverOptions.find((o) => o.id === approverId)?.name ?? "",
          }
        : {}),
    };

    // Several people, or a repeat → the batch endpoint. Every copy still goes
    // through the same server-side factory as a single task.
    if (useBatch) {
      await createBatch.mutateAsync({
        ...common,
        assignees,
        // Ignored by the server when repeating — each copy's due date comes from the schedule.
        due_date: repeating ? null : dueDate || null,
        repeat: repeating
          ? {
              frequency: repeat.frequency as Exclude<RepeatValue["frequency"], "once">,
              count: repeat.untilStopped ? null : repeat.count,
              due_offset_days: repeat.dueOffset,
              ...(repeat.frequency === "weekly" && repeat.weekday != null ? { weekday: repeat.weekday } : {}),
              ...(repeat.frequency === "monthly" && repeat.monthDay != null ? { month_day: repeat.monthDay } : {}),
            }
          : null,
      });
      close();
      return;
    }

    // One person, once → the original path, untouched.
    const finalAssignee = assignedTo;
    const finalAssigneeName = assigneeOptions.find(o => o.id === assignedTo)?.name ?? "";
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
      // Sent explicitly — including as an empty list, which is how "nobody"
      // reaches the server as a decision rather than as silence it would fill
      // in with the creator again.
      verify_users: verifyUsers,
      verify_teams: verifyTeams,
      // Only send when the user may actually set it; the server enforces the
      // same rule and would 403 otherwise.
      ...(canSetApprover && approverId
        ? {
            approver_id: approverId,
            approver_name: approverOptions.find((o) => o.id === approverId)?.name ?? "",
          }
        : {}),
    });
    close();
  }

  /**
   * A suggestion fills the name — and the description, priority and team only
   * when they're still empty/untouched, so it never overwrites what was typed.
   */
  function pickSuggestion(sug: Suggestion) {
    setTitle(sug.title);
    const prev = { description, priority, teamId };
    const fields: string[] = [];
    if (sug.description && !description.trim()) { setDesc(sug.description); fields.push("description"); }
    if (sug.priority && priority === "medium" && sug.priority !== "medium") { setPriority(sug.priority); fields.push("priority"); }
    if (sug.teamId && !teamId && teams.some((t) => t.id === sug.teamId)) {
      setTeamId(sug.teamId); setAssignees([]); setPickerMode("first"); fields.push("team");
    }
    setFilled(fields.length ? { fields, prev } : null);
  }

  function undoFill() {
    if (!filled) return;
    setDesc(filled.prev.description);
    setPriority(filled.prev.priority);
    if (filled.fields.includes("team")) { setTeamId(filled.prev.teamId); setAssignees([]); setPickerMode("first"); }
    setFilled(null);
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
                <TaskNameCombobox
                  autoFocus
                  value={title}
                  onChange={(v) => { setTitle(v); if (filled) setFilled(null); }}
                  onPick={pickSuggestion}
                  teamId={teamId}
                  teamName={teams.find((t) => t.id === teamId)?.name}
                />
                {filled && (
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    Filled {filled.fields.length > 1 ? `${filled.fields.slice(0, -1).join(", ")} & ${filled.fields[filled.fields.length - 1]}` : filled.fields[0]} from the saved task ·
                    <button type="button" className="font-medium text-primary hover:underline" onClick={undoFill}>Undo</button>
                  </p>
                )}
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

              {/* Team. Required when the work is for someone else — it is the
                  board their leader reviews — but optional on a task you take
                  on yourself, so it stops being required the moment you pick
                  your own name. */}
              {teams.length > 0 && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    {isSelfAssigned ? "Team" : "Team *"}
                  </label>
                  <select
                    value={teamId}
                    onChange={e => {
                      setTeamId(e.target.value);
                      // Whoever was picked may not be on the newly chosen team.
                      setAssignees([]);
                      setPickerMode("first");
                    }}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition"
                  >
                    <option value="">
                      {isSelfAssigned ? "No team — just for me" : "Select a team…"}
                    </option>
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

              {/* Assign to — one or several people. Chips show who's picked;
                  the picker opens until the first pick (one click for the
                  usual single assignee) and "Add more" reopens it for several. */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Assign to *</label>
                {assignees.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {assignees.map((id) => (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 py-0.5 pl-1 pr-1.5 text-xs font-medium"
                      >
                        <span className="flex size-5 items-center justify-center rounded-full bg-primary/15 text-[9px] font-bold text-primary">
                          {nameOf(id).split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                        </span>
                        {nameOf(id)}{id === me?.id && <span className="text-muted-foreground">(you)</span>}
                        <button
                          type="button"
                          onClick={() => {
                            setAssignees((p) => p.filter((x) => x !== id));
                            if (assignees.length === 1) setPickerMode("first");
                          }}
                          className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label={`Remove ${nameOf(id)}`}
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                    {pickerMode === "closed" && (
                      <button
                        type="button"
                        onClick={() => setPickerMode("multi")}
                        className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/5 transition-colors"
                      >
                        <UserPlus className="size-3" /> Add more
                      </button>
                    )}
                  </div>
                )}
                {(pickerMode !== "closed" || assignees.length === 0) && (
                  <div className="space-y-1.5">
                    <UserPicker
                      users={assigneeUsers}
                      selectedIds={assignees}
                      onToggle={toggleAssignee}
                      placeholder="Search people…"
                      maxHeightClass="max-h-44"
                    />
                    {pickerMode === "multi" && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => setPickerMode("closed")}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5"
                        >
                          <Check className="size-3" /> Done
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {assignees.length > 1 && (
                  <p className="text-[11px] text-muted-foreground">
                    Each person gets their own copy of this task — with their own timer, status and approval.
                  </p>
                )}
              </div>

              {/* Due date — a one-off task's own date. A repeating task's copies
                  take theirs from the schedule ("Each copy due…" below). */}
              {!repeating && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Due Date *</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={e => setDueDate(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition"
                  />
                </div>
              )}

              {/* Repeat — right under the date, where repetition belongs. Only
                  for those allowed to set it up, so nobody meets a refusal. */}
              {canRepeat ? (
                <RepeatField
                  value={repeat}
                  onChange={setRepeat}
                  anchorISO={istTodayKey()}
                  assigneeCount={assignees.length}
                />
              ) : leadsAnyTeam && (
                // A leader who hasn't picked one of their teams yet: say where
                // the option is rather than hide it — otherwise they may never
                // learn tasks can repeat.
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Repeat</label>
                  <p className="rounded-lg border border-dashed px-3 py-2 text-[11px] text-muted-foreground">
                    Choose a team you lead above to make this task repeat daily, weekly or monthly.
                  </p>
                </div>
              )}

              {/* Approver — leader/admin only, matching the server gate */}
              {canSetApprover && teamId && (
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
                  {approverId && assignees.includes(approverId) && (
                    <p className="text-[11px] text-amber-600">
                      This person would approve their own work.
                    </p>
                  )}
                </div>
              )}

              {/* Verification — the creator is pre-filled, and can be removed.
                  Shown rather than applied silently: a task that will not reach
                  approved until somebody signs it should say who, at the moment
                  it is raised. */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Verified by
                </label>
                <VerifierPicker
                  teams={teams.map((t) => ({ id: t.id, name: t.name }))}
                  people={directory.map((u) => ({
                    id: u.id,
                    name: u.name || u.email,
                    designation: u.designation,
                  }))}
                  selectedTeams={verifyTeams}
                  selectedPeople={verifyUsers}
                  excludePersonId={assignees.length === 1 ? assignedTo : undefined}
                  onToggleTeam={(id) => {
                    setVerifyTouched(true);
                    setVerifyTeams((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
                  }}
                  onTogglePerson={(id) => {
                    setVerifyTouched(true);
                    setVerifyUsers((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
                  }}
                />
                <p className="text-[11px] text-muted-foreground">
                  {verifyUsers.length === 0 && verifyTeams.length === 0
                    ? "Nobody has to sign this off before it can be approved."
                    : creatorWouldApprove
                    ? "They are asked to check the work when it goes for review."
                    : "You raised it, so you check the result — remove yourself if somebody else should."}
                </p>
                {isSelfAssigned && verifyUsers.includes(me?.id ?? "") && (
                  <p className="text-[11px] text-amber-600">
                    This is your own task, so you won&apos;t be asked to verify it.
                  </p>
                )}
              </div>

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
                  disabled={!canSubmit || pending}
                  title={canSubmit ? undefined : `Please add ${missing.join(", ")}`}
                >
                  {submitLabel}
                </Button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
