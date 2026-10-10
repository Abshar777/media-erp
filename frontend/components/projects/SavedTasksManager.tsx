"use client";

/**
 * Saved tasks — the list that feeds the Task name suggestions.
 * `teamId` = a team's list (Team → Settings); `null` = the company list
 * (Settings → Saved tasks, admin roles).
 *
 * Kept light on purpose: only the name is needed (details are folded away),
 * there's no dialog, and "Often used" chips turn names the team already types
 * into saved tasks with one click.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, Loader2, Pencil, Plus, Search, Star, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useDeleteTaskPreset, useSaveTaskPreset, useTaskPresets, useTaskSuggestions, useUpdateTaskPreset, type TaskPreset,
} from "@/hooks/useTaskPresets";
import type { TaskPriority } from "@/types/project";
import { useTeams } from "@/hooks/useTeams";

const PRIORITY_DOT: Record<TaskPriority, string> = { low: "bg-slate-400", medium: "bg-amber-500", high: "bg-red-500" };
const field = "h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";

export function SavedTasksManager({ teamId, teamName }: { teamId: string | null; teamName?: string }) {
  const { data: rows = [], isLoading } = useTaskPresets(teamId);
  const { data: sugg } = useTaskSuggestions(teamId ?? "", !!teamId);
  const save = useSaveTaskPreset();
  const [name, setName] = useState("");
  const [more, setMore] = useState(false);
  const [desc, setDesc] = useState("");
  const [prio, setPrio] = useState<TaskPriority | "">("");
  const [q, setQ] = useState("");
  const where = teamId ? teamName || "this team" : "every team";

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? rows.filter((r) => r.title.toLowerCase().includes(t) || r.description.toLowerCase().includes(t)) : rows;
  }, [rows, q]);
  const often = (sugg?.recent ?? []).filter((r) => r.uses >= 2).slice(0, 6);

  const add = async (title: string, extra?: { description?: string; priority?: TaskPriority | null }) => {
    const t = title.trim();
    if (!t) return;
    try {
      await save.mutateAsync({ team_id: teamId, title: t, ...extra });
      toast.success(`“${t}” saved`);
      return true;
    } catch { return false; }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await add(name, more ? { description: desc.trim(), priority: prio || null } : undefined);
    if (ok) { setName(""); setDesc(""); setPrio(""); }
  };

  return (
    <section className="max-w-2xl space-y-4 rounded-2xl border bg-card p-6">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Star className="size-4 fill-amber-400 text-amber-500" /> Saved tasks</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Suggested while anyone types a task name for {where}. Only the name is needed.
        </p>
      </div>

      {/* Quick add */}
      <form onSubmit={submit} className="space-y-2">
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120}
            placeholder="Add a task name — e.g. Daily reel edit" className={field} aria-label="New saved task name" />
          <button type="submit" disabled={!name.trim() || save.isPending}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add
          </button>
        </div>
        <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronDown className={cn("size-3.5 transition-transform", more && "rotate-180")} />
          {more ? "Fewer options" : "More options (description, priority) — optional"}
        </button>
        {more && (
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} maxLength={2000}
              placeholder="Description to pre-fill (optional)"
              className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30" />
            <select value={prio} onChange={(e) => setPrio(e.target.value as TaskPriority | "")} aria-label="Priority to pre-fill"
              className={cn(field, "sm:w-36")}>
              <option value="">No priority</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        )}
      </form>

      {/* One-click from what the team already types */}
      {teamId && often.length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-dashed p-3">
          <p className="text-xs text-muted-foreground">Often used in this team — save with one click:</p>
          <div className="flex flex-wrap gap-1.5">
            {often.map((r) => (
              <button key={r.title} type="button" onClick={() => add(r.title)} disabled={save.isPending}
                title={r.title}
                className="inline-flex max-w-[16rem] items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs transition hover:border-amber-500/50 hover:bg-amber-500/5">
                <Plus className="size-3 shrink-0 text-amber-500" /> <span className="truncate">{r.title}</span> <span className="shrink-0 text-muted-foreground">· {r.uses}×</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {rows.length > 8 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${rows.length} saved tasks`}
            className={cn(field, "pl-8")} aria-label="Search saved tasks" />
        </div>
      )}

      {isLoading ? (
        <div className="h-16 animate-pulse rounded-xl bg-muted" />
      ) : rows.length === 0 ? (
        <p className="rounded-xl bg-muted/40 px-4 py-5 text-center text-sm text-muted-foreground">
          No saved tasks yet. Add your routine tasks and they&apos;ll be suggested while typing.<br />
          <span className="text-xs">Tip: in Add Task, type a new name and click “★ Save” — that works too.</span>
        </p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {shown.map((r) => <PresetRow key={r.id} row={r} />)}
          {shown.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">No match.</li>}
        </ul>
      )}
    </section>
  );
}

function PresetRow({ row }: { row: TaskPreset }) {
  const update = useUpdateTaskPreset();
  const del = useDeleteTaskPreset();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [title, setTitle] = useState(row.title);
  const [desc, setDesc] = useState(row.description);
  const [prio, setPrio] = useState<TaskPriority | "">(row.priority ?? "");

  if (editing) {
    return (
      <li className="space-y-2 bg-muted/30 px-4 py-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={field} aria-label="Name" autoFocus />
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} maxLength={2000} placeholder="Description (optional)"
            className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30" />
          <select value={prio} onChange={(e) => setPrio(e.target.value as TaskPriority | "")} aria-label="Priority" className={cn(field, "sm:w-36")}>
            <option value="">No priority</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => { setEditing(false); setTitle(row.title); setDesc(row.description); setPrio(row.priority ?? ""); }}
            className="h-8 rounded-lg border px-3 text-xs font-medium hover:bg-muted">Cancel</button>
          <button type="button" disabled={!title.trim() || update.isPending}
            onClick={async () => {
              try {
                await update.mutateAsync({ id: row.id, title: title.trim(), description: desc.trim(),
                  ...(prio ? { priority: prio } : { clear_priority: true }) });
                setEditing(false);
              } catch { /* hook showed it */ }
            }}
            className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50">
            <Check className="size-3.5" /> Save
          </button>
        </div>
      </li>
    );
  }
  return (
    <li className="group flex items-center gap-3 px-4 py-2.5">
      <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-500" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-sm font-medium">
          {row.title}
          {row.priority && <span className={cn("size-1.5 shrink-0 rounded-full", PRIORITY_DOT[row.priority])} title={`${row.priority} priority`} />}
        </p>
        {row.description && <p className="truncate text-xs text-muted-foreground">{row.description}</p>}
      </div>
      {row.uses > 0 && <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground" title="Tasks with this name in the last 90 days">used {row.uses}×</span>}
      {confirm ? (
        <span className="flex shrink-0 items-center gap-1 text-xs">
          Remove?
          <button type="button" className="rounded px-1.5 py-0.5 hover:bg-muted" onClick={() => setConfirm(false)} aria-label="Keep"><X className="size-3.5" /></button>
          <button type="button" className="rounded px-1.5 py-0.5 font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400"
            onClick={() => del.mutate(row.id)}>Remove</button>
        </span>
      ) : (
        <span className="flex shrink-0 items-center gap-0.5 opacity-60 transition group-hover:opacity-100">
          <button type="button" aria-label={`Edit ${row.title}`} onClick={() => setEditing(true)} className="rounded p-1.5 hover:bg-muted"><Pencil className="size-3.5" /></button>
          <button type="button" aria-label={`Remove ${row.title}`} onClick={() => setConfirm(true)} className="rounded p-1.5 hover:bg-muted"><Trash2 className="size-3.5" /></button>
        </span>
      )}
    </li>
  );
}

/**
 * Settings → Saved tasks for a team leader (not an admin): the saved tasks of
 * the team(s) they lead — the company-wide list stays with the admin roles.
 * A switcher when they lead more than one team.
 */
export function LeaderSavedTasks() {
  const { data: teams = [], isLoading } = useTeams();
  const led = useMemo(() => teams.filter((t) => t.my_role === "leader"), [teams]);
  const [picked, setPicked] = useState<string | null>(null);
  const team = led.find((t) => t.id === picked) ?? led[0];
  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (!team) return <p className="text-sm text-muted-foreground">You don&apos;t lead a team, so there are no saved tasks to manage.</p>;
  return (
    <div className="space-y-3">
      {led.length > 1 && (
        <div role="group" aria-label="Which team" className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Team</span>
          {led.map((t) => (
            <button key={t.id} type="button" aria-pressed={t.id === team.id} onClick={() => setPicked(t.id)}
              className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition",
                t.id === team.id ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}>
              <span className="size-2 rounded-full" style={{ background: t.color || "#94a3b8" }} /> {t.name}
            </button>
          ))}
        </div>
      )}
      <SavedTasksManager key={team.id} teamId={team.id} teamName={team.name} />
    </div>
  );
}
