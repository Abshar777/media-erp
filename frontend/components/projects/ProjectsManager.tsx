"use client";

/**
 * Managing the Project list (admin roles + team leaders) — Settings → Projects, and the
 * "Manage projects" window opened from the picker in Add Task.
 *
 * Add (name + platform), rename / change platform / move to another group
 * inline, ↑ ↓ to order within a group, delete with an inline confirm (it is an
 * archive — tasks keep their project) and Restore from "Deleted".
 *
 * No <form> elements on purpose: the window can sit on top of Add Task, and
 * React carries a submit through a portal to the form underneath.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, Check, ChevronDown, FolderKanban, Loader2, Pencil, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useCreateProject, useManagedProjects, useReorderProjects, useUpdateProject,
  type ManagedProject, type ProjectPlatform,
} from "@/hooks/useTaskProjects";
import { PlatformBadge } from "./PlatformBadge";

const PLATFORMS: { value: ProjectPlatform; label: string }[] = [
  { value: "meta", label: "Meta" }, { value: "google", label: "Google" },
  { value: "snapchat", label: "Snapchat" }, { value: "other", label: "Other" },
];
const field = "h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";

function PlatformChips({ value, onChange }: { value: ProjectPlatform; onChange: (p: ProjectPlatform) => void }) {
  return (
    <div role="radiogroup" aria-label="Platform" className="flex flex-wrap gap-1.5">
      {PLATFORMS.map((p) => (
        <button key={p.value} type="button" role="radio" aria-checked={value === p.value} onClick={() => onChange(p.value)}
          className={cn("rounded-full border px-2.5 py-1 text-xs font-medium transition",
            value === p.value ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

export function ProjectsManager({ compact = false }: { compact?: boolean }) {
  const { data: rows = [], isLoading } = useManagedProjects();
  const create = useCreateProject();
  const update = useUpdateProject();
  const reorder = useReorderProjects();

  const [name, setName] = useState("");
  const [platform, setPlatform] = useState<ProjectPlatform>("meta");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);

  const active = useMemo(() => rows.filter((r) => r.active), [rows]);       // server order: group, order
  const deleted = useMemo(() => rows.filter((r) => !r.active), [rows]);
  const groups = useMemo(() => [...new Set(active.map((r) => r.group))].sort((a, b) => a - b), [active]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? active.filter((r) => r.name.toLowerCase().includes(t)) : active;
  }, [active, q]);

  const add = async () => {
    const n = name.trim();
    if (!n || create.isPending) return;
    try { await create.mutateAsync({ name: n, platform }); setName(""); } catch { /* toast shown */ }
  };

  // ↑ ↓ swap with the neighbour in the same group (the picker shows group, then order).
  const move = (id: string, dir: -1 | 1) => {
    const i = active.findIndex((r) => r.id === id);
    const j = i + dir;
    if (j < 0 || j >= active.length || active[j].group !== active[i].group) return;
    const ids = active.map((r) => r.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder.mutate(ids);
  };

  return (
    <div className={cn("space-y-4", !compact && "max-w-2xl rounded-2xl border bg-card p-6")}>
      {!compact && (
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold"><FolderKanban className="size-4 text-primary" /> Projects</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            The ad accounts in the task form&apos;s <span className="font-medium text-foreground">Project</span> field. Admins and team leaders can change this list;
            renaming one renames it on its tasks too.
          </p>
        </div>
      )}

      {/* Add */}
      <div className="space-y-2 rounded-xl border bg-muted/20 p-3">
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="New project, e.g. DELTA TRADING (TikTok)"
            aria-label="New project name"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            className={field} />
          <button type="button" onClick={add} disabled={!name.trim() || create.isPending}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
            {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Platform</span>
          <PlatformChips value={platform} onChange={setPlatform} />
        </div>
      </div>

      {active.length > 8 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects…" aria-label="Search projects"
            className={cn(field, "pl-9")} />
        </div>
      )}

      {/* The list, grouped like the picker */}
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : active.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No projects yet — add the first one above.
        </div>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No project matches “{q}”.</p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const list = shown.filter((r) => r.group === g);
            if (!list.length) return null;
            return (
              <section key={g} aria-label={`Group ${g}`}>
                {groups.length > 1 && (
                  <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Group {g}</p>
                )}
                <ul className="divide-y overflow-hidden rounded-xl border">
                  {list.map((r) => {
                    const idx = active.findIndex((x) => x.id === r.id);
                    const first = idx === 0 || active[idx - 1].group !== r.group;
                    const last = idx === active.length - 1 || active[idx + 1].group !== r.group;
                    return editing === r.id ? (
                      <EditRow key={r.id} row={r} groups={groups} onDone={() => setEditing(null)} />
                    ) : (
                      <li key={r.id} className="group flex items-center gap-2.5 bg-card px-3 py-2">
                        <PlatformBadge platform={r.platform} />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={r.name}>{r.name}</span>
                        {confirming === r.id ? (
                          <span className="flex shrink-0 items-center gap-1.5 text-xs">
                            <span className="hidden text-muted-foreground sm:inline">
                              {r.tasks ? `Used on ${r.tasks} task${r.tasks === 1 ? "" : "s"} — they keep the name.` : "Delete?"}
                            </span>
                            <button type="button" onClick={() => setConfirming(null)} className="rounded-md px-2 py-1 font-medium hover:bg-muted">Cancel</button>
                            <button type="button" disabled={update.isPending}
                              onClick={async () => { try { await update.mutateAsync({ id: r.id, active: false }); } finally { setConfirming(null); } }}
                              className="rounded-md border border-red-500/40 px-2 py-1 font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400">
                              Delete
                            </button>
                          </span>
                        ) : (
                          <>
                            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                              {r.tasks ? `${r.tasks} task${r.tasks === 1 ? "" : "s"}` : "unused"}
                            </span>
                            <span className="flex shrink-0 items-center opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                              <IconBtn label={`Move ${r.name} up`} disabled={first || !!q || reorder.isPending} onClick={() => move(r.id, -1)}><ArrowUp className="size-3.5" /></IconBtn>
                              <IconBtn label={`Move ${r.name} down`} disabled={last || !!q || reorder.isPending} onClick={() => move(r.id, 1)}><ArrowDown className="size-3.5" /></IconBtn>
                              <IconBtn label={`Edit ${r.name}`} onClick={() => { setConfirming(null); setEditing(r.id); }}><Pencil className="size-3.5" /></IconBtn>
                              <IconBtn label={`Delete ${r.name}`} danger onClick={() => { setEditing(null); setConfirming(r.id); }}><Trash2 className="size-3.5" /></IconBtn>
                            </span>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {/* Deleted — archived, restorable */}
      {deleted.length > 0 && (
        <div className="rounded-xl border">
          <button type="button" onClick={() => setShowDeleted((v) => !v)} aria-expanded={showDeleted}
            className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
            Deleted ({deleted.length})
            <ChevronDown className={cn("size-4 transition", showDeleted && "rotate-180")} />
          </button>
          {showDeleted && (
            <ul className="divide-y border-t">
              {deleted.map((r) => (
                <li key={r.id} className="flex items-center gap-2.5 px-3 py-2 opacity-80">
                  <PlatformBadge platform={r.platform} className="grayscale" />
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground line-through decoration-muted-foreground/40" title={r.name}>{r.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{r.tasks ? `${r.tasks} task${r.tasks === 1 ? "" : "s"}` : "unused"}</span>
                  <button type="button" disabled={update.isPending} onClick={() => update.mutate({ id: r.id, active: true })}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10">
                    <RotateCcw className="size-3.5" /> Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function IconBtn({ label, onClick, disabled, danger, children }: {
  label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <button type="button" aria-label={label} title={label.split(" ")[0]} onClick={onClick} disabled={disabled}
      className={cn("rounded-md p-1.5 text-muted-foreground transition disabled:pointer-events-none disabled:opacity-30",
        danger ? "hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400" : "hover:bg-muted hover:text-foreground")}>
      {children}
    </button>
  );
}

function EditRow({ row, groups, onDone }: { row: ManagedProject; groups: number[]; onDone: () => void }) {
  const update = useUpdateProject();
  const [name, setName] = useState(row.name);
  const [platform, setPlatform] = useState<ProjectPlatform>((row.platform as ProjectPlatform) || "other");
  const [group, setGroup] = useState(row.group);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.select(); }, []);
  const newGroup = Math.max(...groups, 0) + 1;

  const save = async () => {
    const n = name.trim();
    if (!n) return;
    const changes = { ...(n !== row.name ? { name: n } : {}), ...(platform !== row.platform ? { platform } : {}),
                      ...(group !== row.group ? { group } : {}) };
    if (!Object.keys(changes).length) { onDone(); return; }
    try { await update.mutateAsync({ id: row.id, ...changes }); onDone(); } catch { /* toast shown; stay in edit */ }
  };

  return (
    <li className="space-y-2 bg-primary/5 px-3 py-3"
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onDone(); } }}>
      <input ref={inputRef} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-label="Project name"
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }} className={field} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <PlatformChips value={platform} onChange={setPlatform} />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Group
          <select value={group} onChange={(e) => setGroup(Number(e.target.value))}
            className="h-7 rounded-md border bg-background px-1.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/30">
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            {!groups.includes(newGroup) && <option value={newGroup}>{newGroup} (new)</option>}
          </select>
        </label>
        <span className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={onDone} className="rounded-md px-2.5 py-1 text-xs font-medium hover:bg-muted">Cancel</button>
          <button type="button" onClick={save} disabled={!name.trim() || update.isPending}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {update.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save
          </button>
        </span>
      </div>
      {row.tasks > 0 && name.trim() && name.trim() !== row.name && (
        <p className="text-[11px] text-muted-foreground">Its {row.tasks} task{row.tasks === 1 ? "" : "s"} will show the new name too.</p>
      )}
    </li>
  );
}

/** The manager in a window on top of Add Task, so a half-filled task is kept. */
export function ProjectsManagerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Manage projects"
        className="relative flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary"><FolderKanban className="size-4" /></span>
            <div>
              <h2 className="text-sm font-semibold">Manage projects</h2>
              <p className="text-[11px] text-muted-foreground">Changes show in the Project field straight away.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 hover:bg-muted"><X className="size-4 text-muted-foreground" /></button>
        </div>
        <div className="overflow-y-auto p-5"><ProjectsManager compact /></div>
        <div className="flex justify-end border-t px-5 py-3">
          <button type="button" onClick={onClose} className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
