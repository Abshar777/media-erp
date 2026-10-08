"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Crown, User, ArrowLeft, Plus, Trash2,
  X, Loader2, Search, Shield, ChevronRight,
  CheckCircle2, Clock, AlertCircle, BarChart3,
  MessageCircle, Settings, TrendingUp, Bell,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthStore } from "@/stores/authStore";
import {
  useTeam, useAddTeamMember, useRemoveTeamMember,
  useUpdateMemberRole, useUpdateTeam, useAssignableUsers, useTeamReport,
  type TeamMember, type ReportPeriod,
} from "@/hooks/useTeams";
import { UserPicker } from "@/components/teams/UserPicker";
import { useTeamEmailPrefs, useUpdateTeamEmailPrefs } from "@/hooks/useTeamEmailPrefs";
import { TEAM_EMAIL_TYPES } from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { fmtDateOnly } from "@/lib/datetime";
import { SavedTasksManager } from "@/components/projects/SavedTasksManager";

// ── Helpers ───────────────────────────────────────────────────────────────────

function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const s = size === "sm" ? "size-7" : size === "lg" ? "size-12" : "size-9";
  const colors = ["#6366f1","#8b5cf6","#ec4899","#ef4444","#f97316","#22c55e","#14b8a6","#3b82f6"];
  const color = colors[name.charCodeAt(0) % colors.length];
  return (
    <div className={`${s} rounded-full flex items-center justify-center text-white font-semibold shrink-0`}
      style={{ background: color }}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function RoleBadge({ role }: { role: "leader" | "member" | "admin" }) {
  if (role === "leader") return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400">
      <Crown className="size-2.5" /> Leader
    </span>
  );
  if (role === "admin") return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-purple-500/15 text-purple-600 dark:text-purple-400">
      <Shield className="size-2.5" /> Admin
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-muted text-muted-foreground">
      <User className="size-2.5" /> Member
    </span>
  );
}

// ── Add Member Modal ──────────────────────────────────────────────────────────

function AddMemberModal({ teamId, existingIds, onClose, isTeamLeaderCaller = false }: {
  teamId: string;
  existingIds: string[];
  onClose: () => void;
  isTeamLeaderCaller?: boolean;
}) {
  const [role, setRole]           = useState<"member" | "leader">("member");
  const [selectedIds, setSelected] = useState<string[]>([]);
  const add = useAddTeamMember(teamId);
  const { data: allUsers = [], isLoading } = useAssignableUsers();

  // Team Leaders can only add Employees — filter the picker list accordingly
  const users = isTeamLeaderCaller
    ? allUsers.filter((u) => u.role_name === "Employee")
    : allUsers;

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedIds.length === 0) return;
    // Add each selected user independently — one failure (e.g. already a
    // member) shouldn't abort the rest.
    let added = 0;
    let skipped = 0;
    for (const uid of selectedIds) {
      try {
        await add.mutateAsync({ user_id: uid, role });
        added++;
      } catch {
        skipped++;
      }
    }
    if (added > 0) toast.success(`${added} member${added !== 1 ? "s" : ""} added`);
    if (skipped > 0) toast.error(`${skipped} skipped (already in this team)`);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-md max-h-[90vh] flex flex-col rounded-2xl border bg-card shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between border-b px-5 py-4 shrink-0">
          <h2 className="text-sm font-semibold">Add Members</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
            <X className="size-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
          <div className="p-5 space-y-4 overflow-y-auto">
            {/* Role */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Add as</label>
              <div className="flex gap-2">
                {(["member", "leader"] as const)
                  // Team Leaders can only add as "member" — hide the Leader option
                  .filter((r) => !(isTeamLeaderCaller && r === "leader"))
                  .map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(r)}
                      className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-medium transition-all ${
                        role === r ? "border-primary bg-primary/5 text-primary" : "hover:border-muted-foreground/40"
                      }`}
                    >
                      {r === "leader" ? <Crown className="size-3.5" /> : <User className="size-3.5" />}
                      {r === "leader" ? "Team Leader" : "Team Member"}
                    </button>
                  ))}
              </div>
            </div>

            {/* User picker */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Select users</label>
              <UserPicker
                users={users}
                selectedIds={selectedIds}
                onToggle={toggle}
                excludeIds={existingIds}
                loading={isLoading}
                maxHeightClass="max-h-64"
                placeholder="Search users..."
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t px-5 py-4 shrink-0">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={selectedIds.length === 0 || add.isPending}>
              {add.isPending ? <Loader2 className="size-4 animate-spin mr-1.5" /> : <Plus className="size-4 mr-1.5" />}
              Add {selectedIds.length > 0 ? selectedIds.length : ""} {role === "leader" ? "Leader" : "Member"}{selectedIds.length !== 1 ? "s" : ""}
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ── Member row ────────────────────────────────────────────────────────────────

function MemberRow({ member, teamId, canManage, isTeamLeaderCaller = false }: {
  member: TeamMember;
  teamId: string;
  canManage: boolean;
  isTeamLeaderCaller?: boolean;
}) {
  const router       = useRouter();
  const remove       = useRemoveTeamMember(teamId);
  const updateRole   = useUpdateMemberRole(teamId);

  function toggleRole() {
    const newRole = member.role === "leader" ? "member" : "leader";
    updateRole.mutate({ userId: member.user_id, role: newRole });
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 hover:bg-muted/30 transition-colors group">
      <Avatar name={member.name || "?"} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{member.name || "Unknown"}</p>
          <RoleBadge role={member.role} />
        </div>
        <p className="text-xs text-muted-foreground truncate">{member.email}</p>
        {member.designation && (
          <p className="text-[11px] text-muted-foreground/70">{member.designation}</p>
        )}
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => router.push(`/teams/${teamId}/members/${member.user_id}`)}
        >
          <BarChart3 className="size-3.5 mr-1" /> Report
        </Button>
        {canManage && (
          <>
            {/* Team Leaders can demote existing leaders but cannot promote members */}
            {(member.role === "leader" || !isTeamLeaderCaller) && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={toggleRole}
                disabled={updateRole.isPending}
              >
                {member.role === "leader" ? <User className="size-3.5 mr-1" /> : <Crown className="size-3.5 mr-1" />}
                {member.role === "leader" ? "Demote" : "Promote"}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-destructive hover:text-destructive"
              onClick={() => {
                if (confirm(`Remove ${member.name} from this team?`)) remove.mutate(member.user_id);
              }}
              disabled={remove.isPending}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </>
        )}
      </div>

      <ChevronRight
        className="size-4 text-muted-foreground shrink-0 cursor-pointer"
        onClick={() => router.push(`/teams/${teamId}/members/${member.user_id}`)}
      />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = "members" | "tasks" | "report" | "settings";

export default function TeamDetailPage() {
  const params    = useParams<{ id: string }>();
  const router    = useRouter();
  const teamId    = params.id;
  const [tab, setTab]             = useState<Tab>("members");
  const [search, setSearch]       = useState("");
  const [showAdd, setShowAdd]     = useState(false);

  const { data: team, isLoading, isError } = useTeam(teamId);
  const { user: currentUser } = useAuthStore();
  const isTeamLeaderCaller = currentUser?.role?.role_name === "Team Leader";

  if (isLoading) return (
    <div className="flex items-center justify-center py-32">
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
    </div>
  );

  if (isError || !team) return (
    <div className="flex flex-col items-center justify-center py-32 gap-3">
      <AlertCircle className="size-8 text-destructive/60" />
      <p className="text-sm text-muted-foreground">Team not found or access denied.</p>
      <Button variant="outline" size="sm" onClick={() => router.push("/teams")}>
        <ArrowLeft className="size-4 mr-1.5" /> Back to Teams
      </Button>
    </div>
  );

  const canManage = team.my_role === "leader" || team.my_role === "admin";
  const members   = team.members ?? [];
  const leaders   = members.filter((m) => m.role === "leader");
  const regular   = members.filter((m) => m.role === "member");
  const filtered  = members.filter((m) =>
    (m.name || "").toLowerCase().includes(search.toLowerCase()) ||
    (m.email || "").toLowerCase().includes(search.toLowerCase())
  );

  const completionPct = team.task_count
    ? Math.round(((team.done_count ?? 0) / team.task_count) * 100)
    : 0;

  return (
    <div className="flex flex-col gap-6 pb-6">
      {/* Back nav */}
      <button
        onClick={() => router.push("/teams")}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        <ArrowLeft className="size-4" /> All Teams
      </button>

      {/* Team header */}
      <div className="rounded-2xl border bg-card overflow-hidden shadow-sm">
        <div className="h-3" style={{ background: team.color }} />
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div
                className="size-14 rounded-2xl flex items-center justify-center text-white font-bold text-2xl shadow-lg shrink-0"
                style={{ background: team.color }}
              >
                {team.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h1 className="text-xl font-bold">{team.name}</h1>
                {team.description && (
                  <p className="text-sm text-muted-foreground mt-0.5">{team.description}</p>
                )}
                {leaders.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <Crown className="size-3 text-amber-500" />
                    Led by {leaders.map((l) => l.name || "Leader").join(", ")}
                  </p>
                )}
              </div>
            </div>
            {canManage && (
              <Button size="sm" onClick={() => setShowAdd(true)}>
                <Plus className="size-4 mr-1.5" /> Add Member
              </Button>
            )}
          </div>

          {/* Stats */}
          <div className="mt-5 grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-muted/40 px-4 py-3 text-center">
              <p className="text-2xl font-bold">{members.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Members</p>
            </div>
            <div className="rounded-xl bg-muted/40 px-4 py-3 text-center">
              <p className="text-2xl font-bold">{team.task_count ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Tasks</p>
            </div>
            <div className="rounded-xl bg-muted/40 px-4 py-3 text-center">
              <p className="text-2xl font-bold">{completionPct}%</p>
              <p className="text-xs text-muted-foreground mt-0.5">Done</p>
            </div>
          </div>

          {/* Progress bar */}
          {(team.task_count ?? 0) > 0 && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                <span>{team.done_count ?? 0} completed</span>
                <span>{(team.task_count ?? 0) - (team.done_count ?? 0)} remaining</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${completionPct}%`, background: team.color }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-muted/50 p-1 border w-fit">
        {([
          { id: "members" as Tab, icon: <Users className="size-3.5" />, label: "Members" },
          { id: "tasks"   as Tab, icon: <CheckCircle2 className="size-3.5" />, label: "Tasks" },
          { id: "report"  as Tab, icon: <BarChart3 className="size-3.5" />, label: "Report" },
          { id: "settings" as Tab, icon: <Settings className="size-3.5" />, label: "Settings", hidden: !canManage },
        ] as const).filter((t) => !("hidden" in t && t.hidden)).map(({ id, icon, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
              tab === id ? "bg-card text-foreground shadow-sm border" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {/* Members tab */}
      {tab === "members" && (
        <div className="space-y-4">
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search members…"
              className="pl-9"
            />
          </div>

          {leaders.length > 0 && !search && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                <Crown className="size-3 text-amber-500" /> Team Leaders
              </p>
              <div className="space-y-2">
                {leaders.map((m) => (
                  <MemberRow key={m.user_id} member={m} teamId={teamId} canManage={canManage} isTeamLeaderCaller={isTeamLeaderCaller} />
                ))}
              </div>
            </div>
          )}

          {regular.length > 0 && !search && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                <Users className="size-3" /> Members
              </p>
              <div className="space-y-2">
                {regular.map((m) => (
                  <MemberRow key={m.user_id} member={m} teamId={teamId} canManage={canManage} isTeamLeaderCaller={isTeamLeaderCaller} />
                ))}
              </div>
            </div>
          )}

          {search && (
            <div className="space-y-2">
              {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No members match.</p>
              ) : (
                filtered.map((m) => (
                  <MemberRow key={m.user_id} member={m} teamId={teamId} canManage={canManage} isTeamLeaderCaller={isTeamLeaderCaller} />
                ))
              )}
            </div>
          )}

          {members.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 gap-3 rounded-2xl border bg-card">
              <Users className="size-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No members yet.</p>
              {canManage && (
                <Button size="sm" onClick={() => setShowAdd(true)}>
                  <Plus className="size-4 mr-1.5" /> Add first member
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tasks tab — redirect to projects with team filter */}
      {tab === "tasks" && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 rounded-2xl border bg-card">
          <CheckCircle2 className="size-10 text-muted-foreground/30" />
          <div className="text-center">
            <p className="font-semibold">Team Tasks</p>
            <p className="text-sm text-muted-foreground mt-1">View and manage tasks assigned to this team.</p>
          </div>
          <Button
            size="sm"
            onClick={() => router.push(`/projects?team_id=${teamId}`)}
          >
            Open Task Board
          </Button>
        </div>
      )}

      {/* Report tab */}
      {tab === "report" && (
        <TeamReportPanel teamId={teamId} teamColor={team.color} />
      )}

      {/* Settings tab */}
      {tab === "settings" && canManage && (
        <div className="space-y-6">
          <TeamSettingsPanel team={team} />
          <SavedTasksManager teamId={teamId} teamName={team.name} />
          <TeamEmailPrefsCard teamId={teamId} />
        </div>
      )}

      <AnimatePresence>
        {showAdd && (
          <AddMemberModal
            teamId={teamId}
            existingIds={members.map((m) => m.user_id)}
            onClose={() => setShowAdd(false)}
            isTeamLeaderCaller={isTeamLeaderCaller}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Team email notification settings (leader/admin) ───────────────────────────

function TeamEmailPrefsCard({ teamId }: { teamId: string }) {
  const { data, isLoading } = useTeamEmailPrefs(teamId);
  const update = useUpdateTeamEmailPrefs(teamId);
  const [types, setTypes] = useState<Record<string, boolean>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data) { setTypes(data); setDirty(false); }
  }, [data]);

  return (
    <div className="rounded-2xl border bg-card p-6 space-y-4 max-w-lg">
      <div className="flex items-center gap-2">
        <Bell className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Team Email Notifications</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Turn email types on or off for the whole team. A type turned off here is
        suppressed for every member — even if they enabled it in their own profile.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground/50" /></div>
      ) : (
        <div className="divide-y">
          {TEAM_EMAIL_TYPES.map((d) => {
            const checked = types[d.key] ?? true;
            return (
              <div key={d.key} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{d.label}</p>
                  <p className="text-xs text-muted-foreground">{d.desc}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={checked}
                  onClick={() => { setTypes((p) => ({ ...p, [d.key]: !checked })); setDirty(true); }}
                  className={cn(
                    "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                    checked ? "bg-primary" : "bg-muted-foreground/30"
                  )}
                >
                  <span className={cn(
                    "absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform",
                    checked ? "translate-x-[22px]" : "translate-x-0.5"
                  )} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => update.mutate(types, { onSuccess: () => setDirty(false) })}
          disabled={!dirty || update.isPending}
        >
          {update.isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
          Save
        </Button>
      </div>
    </div>
  );
}

// ── Team settings panel ───────────────────────────────────────────────────────

function TeamSettingsPanel({ team }: { team: import("@/hooks/useTeams").Team }) {
  const [name, setName]             = useState(team.name);
  const [description, setDescription] = useState(team.description);
  const [color, setColor]           = useState(team.color);
  const update = useUpdateTeam(team.id);

  const COLORS = ["#6366f1","#8b5cf6","#ec4899","#ef4444","#f97316","#eab308","#22c55e","#14b8a6","#06b6d4","#3b82f6"];

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    await update.mutateAsync({ name: name.trim(), description, color });
  }

  return (
    <form onSubmit={handleSave} className="rounded-2xl border bg-card p-6 space-y-5 max-w-lg">
      <h2 className="text-sm font-semibold">Team Settings</h2>
      <div className="space-y-2">
        <label className="text-sm font-medium">Team Name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Colour</label>
        <div className="flex gap-2 flex-wrap">
          {COLORS.map((c) => (
            <button
              key={c} type="button" onClick={() => setColor(c)}
              className="size-7 rounded-full transition-all hover:scale-110"
              style={{ background: c, boxShadow: color === c ? `0 0 0 3px white, 0 0 0 5px ${c}` : "none" }}
            />
          ))}
        </div>
      </div>
      <Button type="submit" disabled={update.isPending}>
        {update.isPending ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null}
        Save Changes
      </Button>
    </form>
  );
}

// ── Team report panel ─────────────────────────────────────────────────────────

const PERIODS: { id: ReportPeriod; label: string }[] = [
  { id: "daily",   label: "Daily" },
  { id: "weekly",  label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "custom",  label: "Custom" },
];

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  started: "Started",
  break: "Break",
  reedit: "Reedit",
  pending_review: "Pending Review",
  approved: "Approved",
};

function shortDate(iso: string) {
  return iso.length === 10
    ? fmtDateOnly(iso, { month: "short", day: "numeric" })
    : iso;
}

function StatCard({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <p className="text-2xl font-bold" style={accent ? { color: accent } : undefined}>{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

function TeamReportPanel({ teamId, teamColor }: { teamId: string; teamColor: string }) {
  const [period, setPeriod] = useState<ReportPeriod>("monthly");
  const [from, setFrom] = useState("");
  const [to, setTo]     = useState("");

  const { data: report, isLoading, isError } = useTeamReport(teamId, period, from, to);

  const chartData = (report?.timeseries ?? []).map((d) => ({ ...d, label: shortDate(d.date) }));
  const statusEntries = Object.entries(report?.by_status ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-5">
      {/* Period selector */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-xl bg-muted/50 p-1 border w-fit">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                period === p.id ? "bg-card text-foreground shadow-sm border" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {period === "custom" && (
          <div className="flex items-center gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-auto text-xs" />
            <span className="text-muted-foreground text-xs">to</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-auto text-xs" />
          </div>
        )}

        {report && (
          <span className="text-xs text-muted-foreground ml-auto">
            {shortDate(report.date_from)} – {shortDate(report.date_to)}
          </span>
        )}
      </div>

      {period === "custom" && !(from && to) ? (
        <div className="flex flex-col items-center justify-center py-16 gap-2 rounded-2xl border bg-card">
          <CalendarPrompt />
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-7 animate-spin text-muted-foreground" />
        </div>
      ) : isError || !report ? (
        <div className="flex flex-col items-center justify-center py-16 gap-2 rounded-2xl border bg-card">
          <AlertCircle className="size-7 text-destructive/60" />
          <p className="text-sm text-muted-foreground">Couldn’t load the report.</p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Created" value={report.summary.created} />
            <StatCard label="Completed" value={report.summary.completed} accent="#22c55e" />
            <StatCard label="Completion" value={`${report.summary.completion_pct}%`} accent={teamColor} />
            <StatCard label="Active now" value={report.summary.active} />
          </div>

          {/* Timeseries chart */}
          <div className="rounded-2xl border bg-card p-5">
            <p className="text-sm font-semibold mb-3 flex items-center gap-1.5">
              <TrendingUp className="size-4 text-muted-foreground" /> Activity over time
            </p>
            {chartData.every((d) => d.created === 0 && d.completed === 0) ? (
              <p className="text-sm text-muted-foreground py-12 text-center">No task activity in this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={32} />
                  <Tooltip
                    contentStyle={{ borderRadius: 12, fontSize: 12, border: "1px solid var(--border)", background: "var(--card)" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="created" name="Created" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="completed" name="Completed" fill="#22c55e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Status breakdown */}
          {statusEntries.length > 0 && (
            <div className="rounded-2xl border bg-card p-5">
              <p className="text-sm font-semibold mb-3">Tasks created — by status</p>
              <div className="flex flex-wrap gap-2">
                {statusEntries.map(([status, count]) => (
                  <span
                    key={status}
                    className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-3 py-1 text-xs"
                  >
                    <span className="font-medium">{STATUS_LABELS[status] ?? status}</span>
                    <span className="text-muted-foreground">{count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Per-member table */}
          <div className="rounded-2xl border bg-card overflow-hidden">
            <div className="border-b px-5 py-3">
              <p className="text-sm font-semibold">Per member</p>
            </div>
            {report.members.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No members.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-5 py-2 font-medium">Member</th>
                    <th className="px-5 py-2 font-medium text-right">Assigned</th>
                    <th className="px-5 py-2 font-medium text-right">Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {report.members.map((m) => (
                    <tr key={m.user_id} className="border-t hover:bg-muted/30 transition-colors">
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-2">
                          <Avatar name={m.name || "?"} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate font-medium">{m.name || "Unknown"}</p>
                          </div>
                          {m.role === "leader" && <Crown className="size-3 text-amber-500 shrink-0" />}
                        </div>
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums">{m.assigned}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums font-medium text-green-600 dark:text-green-500">{m.completed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CalendarPrompt() {
  return (
    <>
      <Clock className="size-7 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">Pick a start and end date to view the report.</p>
    </>
  );
}
