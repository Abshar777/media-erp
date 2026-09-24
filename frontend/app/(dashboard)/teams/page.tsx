"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Plus, Crown, User, Trash2, ChevronRight,
  Search, X, Loader2, Shield, AlertCircle, Palette, Pencil,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useTeams, useCreateTeam, useUpdateTeam, useDeleteTeam, useAssignableUsers,
  type Team,
} from "@/hooks/useTeams";
import { UserPicker } from "@/components/teams/UserPicker";
import { useAuthStore } from "@/stores/authStore";

// ── Colour palette for teams ──────────────────────────────────────────────────

const TEAM_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444",
  "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#06b6d4", "#3b82f6", "#a855f7", "#f43f5e",
];

// ── Create team modal ─────────────────────────────────────────────────────────

function CreateTeamModal({ onClose }: { onClose: () => void }) {
  const [name, setName]               = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor]             = useState(TEAM_COLORS[0]);
  const [status, setStatus]           = useState<"active" | "inactive">("active");
  const [leaderIds, setLeaderIds]     = useState<string[]>([]);
  const [memberIds, setMemberIds]     = useState<string[]>([]);

  const create = useCreateTeam();
  const { data: users = [], isLoading: usersLoading } = useAssignableUsers();

  function toggle(list: string[], setList: (v: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await create.mutateAsync({
      name: name.trim(),
      description,
      color,
      status,
      leader_ids: leaderIds,
      // a user picked as leader shouldn't also be a plain member
      member_ids: memberIds.filter((id) => !leaderIds.includes(id)),
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-2xl border bg-card shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between border-b px-6 py-4 shrink-0">
          <h2 className="text-base font-semibold">Create Team</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
          <div className="p-6 space-y-5 overflow-y-auto">
            {/* Team Name */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Team Name *</label>
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sales North"
                required
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional team description"
              />
            </div>

            {/* Status + Colour */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as "active" | "inactive")}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Palette className="size-3.5" /> Colour
                </label>
                <div className="flex gap-1.5 flex-wrap pt-1.5">
                  {TEAM_COLORS.slice(0, 8).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className="size-5 rounded-full transition-all hover:scale-110"
                      style={{ background: c, boxShadow: color === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : "none" }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Team Leaders */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Crown className="size-3.5 text-amber-500" /> Team Leaders (Managers)
              </label>
              <UserPicker
                users={users}
                selectedIds={leaderIds}
                onToggle={(id) => {
                  toggle(leaderIds, setLeaderIds, id);
                  // if promoted to leader, drop from members
                  setMemberIds((m) => m.filter((x) => x !== id));
                }}
                loading={usersLoading}
                placeholder="Search users..."
              />
            </div>

            {/* Team Members */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <User className="size-3.5" /> Team Members
              </label>
              <UserPicker
                users={users}
                selectedIds={memberIds}
                onToggle={(id) => toggle(memberIds, setMemberIds, id)}
                excludeIds={leaderIds}
                loading={usersLoading}
                placeholder="Search users..."
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 border-t px-6 py-4 shrink-0">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <Plus className="size-4 mr-2" />}
              Create Team
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ── Edit team modal ───────────────────────────────────────────────────────────

/**
 * Quick edit from the Teams list.
 *
 * Covers exactly the fields the API accepts (UpdateTeamRequest: name,
 * description, colour, status). Membership is deliberately not here — it lives
 * on the team detail page, which has the add/remove and role-change flows.
 */
function EditTeamModal({ team, onClose }: { team: Team; onClose: () => void }) {
  const [name, setName]               = useState(team.name);
  const [description, setDescription] = useState(team.description ?? "");
  const [color, setColor]             = useState(team.color);
  const [status, setStatus]           = useState<"active" | "inactive">(
    team.status === "inactive" ? "inactive" : "active"
  );
  // Seed the pickers from the team's current roster.
  const [leaderIds, setLeaderIds] = useState<string[]>(
    () => (team.members ?? []).filter((m) => m.role === "leader").map((m) => m.user_id)
  );
  const [memberIds, setMemberIds] = useState<string[]>(
    () => (team.members ?? []).filter((m) => m.role !== "leader").map((m) => m.user_id)
  );

  const update = useUpdateTeam(team.id);
  const { data: users = [], isLoading: usersLoading } = useAssignableUsers(team.id);
  const unresolvedMembers = usersLoading
    ? []
    : (team.members ?? []).filter((member) => !users.some((user) => user.id === member.user_id));

  function toggle(list: string[], setList: (v: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await update.mutateAsync({
      name: name.trim(),
      description,
      color,
      status,
      leader_ids: leaderIds,
      // a user picked as leader shouldn't also be a plain member
      member_ids: memberIds.filter((id) => !leaderIds.includes(id)),
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-2xl border bg-card shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between border-b px-6 py-4 shrink-0">
          <h2 className="text-base font-semibold">Edit Team</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {unresolvedMembers.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                <p className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
                  <AlertCircle className="size-4 shrink-0" />
                  {unresolvedMembers.length} current team member(s) are unavailable in the user picker.
                  Remove them here to save the roster.
                </p>
                <div className="space-y-1">
                  {unresolvedMembers.map((member) => (
                    <div key={member.user_id} className="flex items-center justify-between gap-3 rounded-md bg-background/70 px-2.5 py-1.5 text-xs">
                      <span className="min-w-0 truncate">
                        {member.name && member.name !== "Unknown" ? member.name : "Unavailable user"}
                        <span className="ml-2 font-mono text-muted-foreground">{member.user_id}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setLeaderIds((ids) => ids.filter((id) => id !== member.user_id));
                          setMemberIds((ids) => ids.filter((id) => id !== member.user_id));
                        }}
                        className="shrink-0 rounded px-2 py-1 font-medium text-destructive hover:bg-destructive/10"
                        aria-label={`Remove unavailable member ${member.user_id}`}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium">Team Name *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as "active" | "inactive")}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Palette className="size-3.5" /> Colour
                </label>
                <div className="flex gap-1.5 flex-wrap pt-1.5">
                  {TEAM_COLORS.slice(0, 8).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className="size-5 rounded-full transition-all hover:scale-110"
                      style={{ background: c, boxShadow: color === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : "none" }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Team Leaders */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Crown className="size-3.5 text-amber-500" /> Team Leaders (Managers)
              </label>
              <UserPicker
                users={users}
                selectedIds={leaderIds}
                onToggle={(id) => {
                  toggle(leaderIds, setLeaderIds, id);
                  // promoting to leader drops them from the members list
                  setMemberIds((m) => m.filter((x) => x !== id));
                }}
                loading={usersLoading}
                placeholder="Search users..."
              />
              {leaderIds.length === 0 && (
                <p className="flex items-center gap-1 text-[11px] text-amber-600">
                  <AlertCircle className="size-3" />
                  A team needs at least one leader.
                </p>
              )}
            </div>

            {/* Team Members */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <User className="size-3.5" /> Team Members
              </label>
              <UserPicker
                users={users}
                selectedIds={memberIds}
                onToggle={(id) => toggle(memberIds, setMemberIds, id)}
                excludeIds={leaderIds}
                loading={usersLoading}
                placeholder="Search users..."
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t px-6 py-4 shrink-0">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || leaderIds.length === 0 || update.isPending}
            >
              {update.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              Save Changes
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ── Team card ─────────────────────────────────────────────────────────────────

function TeamCard({ team, onEdit, onDelete }: { team: Team; onEdit: (t: Team) => void; onDelete: (id: string) => void }) {
  const router  = useRouter();
  const leaders = team.members?.filter((m) => m.role === "leader") ?? [];
  const isAdmin = team.my_role === "admin";
  const isLeader = team.my_role === "leader";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="group rounded-2xl border bg-card shadow-sm hover:shadow-md transition-all overflow-hidden cursor-pointer"
      onClick={() => router.push(`/teams/${team.id}`)}
    >
      {/* Colour bar */}
      <div className="h-2" style={{ background: team.color }} />

      <div className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="size-10 rounded-xl flex items-center justify-center text-white font-bold text-base shadow-md shrink-0"
              style={{ background: team.color }}
            >
              {team.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="font-semibold text-sm leading-tight">{team.name}</h3>
              {team.description && (
                <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{team.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {/* Edit mirrors the server's _can_manage: elevated roles OR this
                team's own leader. Delete stays admin-only. */}
            {(isAdmin || isLeader) && (
              <button
                type="button"
                title="Edit team"
                aria-label={`Edit ${team.name}`}
                onClick={(e) => { e.stopPropagation(); onEdit(team); }}
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-primary/10 hover:text-primary transition-all text-muted-foreground"
              >
                <Pencil className="size-3.5" />
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                title="Delete team"
                aria-label={`Delete ${team.name}`}
                onClick={(e) => { e.stopPropagation(); onDelete(team.id); }}
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-destructive/10 hover:text-destructive transition-all text-muted-foreground"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-muted/40 px-3 py-2 text-center">
            <p className="text-lg font-bold leading-none">{team.member_count}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Members</p>
          </div>
          <div className="rounded-lg bg-muted/40 px-3 py-2 text-center">
            <p className="text-lg font-bold leading-none">{team.task_count ?? 0}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Tasks</p>
          </div>
        </div>

        {/* Leaders */}
        {leaders.length > 0 && (
          <div className="flex items-center gap-2">
            <Crown className="size-3.5 text-amber-500 shrink-0" />
            <p className="text-xs text-muted-foreground truncate">
              {leaders.map((l) => l.name || "Leader").join(", ")}
            </p>
          </div>
        )}

        {/* My role badge */}
        <div className="flex items-center justify-between">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            team.my_role === "leader"
              ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
              : team.my_role === "admin"
              ? "bg-purple-500/15 text-purple-600 dark:text-purple-400"
              : "bg-muted text-muted-foreground"
          }`}>
            {team.my_role === "leader" ? <Crown className="size-2.5" /> : team.my_role === "admin" ? <Shield className="size-2.5" /> : <User className="size-2.5" />}
            {team.my_role === "leader" ? "Leader" : team.my_role === "admin" ? "Admin" : "Member"}
          </span>
          <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </div>
      </div>
    </motion.div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TeamsPage() {
  const [search, setSearch]       = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);
  const { data: teams = [], isLoading, isError } = useTeams();
  const deleteTeam    = useDeleteTeam();
  const { hasPermission } = useAuthStore();
  const canCreateTeam = hasPermission("teams", "create");

  const filtered = teams.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.description?.toLowerCase().includes(search.toLowerCase())
  );

  function handleDelete(id: string) {
    if (!confirm("Delete this team? This cannot be undone.")) return;
    deleteTeam.mutate(id);
  }

  return (
    <div className="flex flex-col gap-6 pb-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Teams</h1>
          <p className="text-sm text-muted-foreground">
            Organise your people into focused teams.
          </p>
        </div>
        {canCreateTeam && (
          <Button onClick={() => setShowCreate(true)} size="sm">
            <Plus className="size-4 mr-1.5" /> New Team
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search teams…"
          className="pl-9"
        />
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl border bg-card overflow-hidden">
              <div className="h-2 bg-muted animate-pulse" />
              <div className="p-5 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-xl bg-muted animate-pulse" />
                  <div className="space-y-1.5">
                    <div className="h-3.5 w-28 rounded bg-muted animate-pulse" />
                    <div className="h-2.5 w-20 rounded bg-muted animate-pulse" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="h-14 rounded-lg bg-muted animate-pulse" />
                  <div className="h-14 rounded-lg bg-muted animate-pulse" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 rounded-2xl border bg-card">
          <AlertCircle className="size-8 text-destructive/60" />
          <p className="text-sm text-muted-foreground">Failed to load teams</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-28 gap-4 rounded-2xl border bg-card">
          <div className="size-16 rounded-2xl bg-muted flex items-center justify-center">
            <Users className="size-8 text-muted-foreground/50" />
          </div>
          <div className="text-center">
            <p className="font-semibold">{search ? "No teams match your search" : "No teams yet"}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {search ? "Try a different search term." : "Create your first team to get started."}
            </p>
          </div>
          {!search && (
            <Button onClick={() => setShowCreate(true)} size="sm">
              <Plus className="size-4 mr-1.5" /> Create Team
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((team) => (
            <TeamCard key={team.id} team={team} onEdit={setEditing} onDelete={handleDelete} />
          ))}
        </div>
      )}

      <AnimatePresence>
        {showCreate && <CreateTeamModal onClose={() => setShowCreate(false)} />}
        {editing && (
          <EditTeamModal
            key={editing.id}
            team={editing}
            onClose={() => setEditing(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
