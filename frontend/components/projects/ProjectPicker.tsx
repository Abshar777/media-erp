"use client";

/**
 * The optional "Project" (ad account) field on a task — Add Task and the task detail.
 *
 * Single (employees): closed it reads like the other fields — "No project", or
 * the chosen one with its platform badge and an × to clear; picking a row closes it.
 * Multiple (team leaders, admins — `multiple`): chosen projects are chips, each
 * with its own ×; rows carry a checkbox and the list stays open for more picks
 * until Done / Esc / a click outside. Up to MAX_PROJECTS.
 *
 * Open it is a list INSIDE the form, not a native <select>: Windows paints a
 * native option list light while the dark theme's text stays light, and an
 * in-flow list is never clipped by the modal's scroll. Search narrows as you
 * type; the groups keep their order; ↑ ↓ Enter Esc work; Enter never submits.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, FolderKanban, Plus, Search, Settings2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanManageProjects, useTaskProjects, type TaskProject } from "@/hooks/useTaskProjects";
import { PlatformBadge } from "./PlatformBadge";
import { ProjectsManagerModal } from "./ProjectsManager";

export { PlatformBadge } from "./PlatformBadge";

/** Mirrors task_project_service.MAX_PER_TASK. */
export const MAX_PROJECTS = 10;

interface Props {
  /** Chosen project ids, in order (the first is the "main" one older screens show). */
  value: string[];
  onChange: (ids: string[]) => void;
  /** Allow several (team leaders / admins). */
  multiple?: boolean;
  /** Names for chosen ids that are no longer in the list (deleted), so they still read right. */
  fallbackNames?: Record<string, string>;
  disabled?: boolean;
  id?: string;
}

export function ProjectPicker({ value, onChange, multiple = false, fallbackNames = {}, disabled, id }: Props) {
  const { data: projects = [], isLoading } = useTaskProjects();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Admin roles and team leaders can open the list's manager from here, without leaving the form.
  const canManage = useCanManageProjects();
  const [managing, setManaging] = useState(false);

  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const chosen = value.map((pid) => ({ id: pid, project: byId.get(pid) ?? null, name: byId.get(pid)?.name ?? fallbackNames[pid] ?? "Deleted project" }));
  const full = multiple && value.length >= MAX_PROJECTS;

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? projects.filter((p) => p.name.toLowerCase().includes(t)) : projects;
  }, [projects, q]);
  // Single mode: row 0 is "No project" while something is chosen (and not searching).
  const offerNone = !multiple && value.length > 0 && !q.trim();
  const rows: (TaskProject | null)[] = offerNone ? [null, ...shown] : shown;

  const close = () => { setOpen(false); setQ(""); };

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, rows.findIndex((r) => (r?.id ?? "") === (value[0] ?? ""))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q]);

  // Close when clicking anywhere else.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) close(); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (p: TaskProject | null) => {
    if (!multiple) { onChange(p ? [p.id] : []); close(); return; }
    if (!p) return;
    if (value.includes(p.id)) onChange(value.filter((x) => x !== p.id));
    else if (!full) onChange([...value, p.id]);
  };
  const remove = (pid: string) => onChange(value.filter((x) => x !== pid));

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(rows.length - 1, i + 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    if (e.key === "Enter") {                                       // never submits the form
      e.preventDefault();
      const row = rows[Math.min(active, rows.length - 1)];
      if (row !== undefined) pick(row);
    }
  };

  return (
    <div ref={boxRef} className="space-y-1.5">
      {!open && (multiple && chosen.length > 0 ? (
        /* Several: chips, each removable; the field itself (or "+ Add") opens the list. */
        <div id={id} role="group" aria-label="Projects"
          onClick={(e) => { if (!disabled && e.target === e.currentTarget) setOpen(true); }}
          className={cn("flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg border bg-background px-2 py-1.5 transition",
            disabled ? "opacity-60" : "cursor-text hover:border-foreground/20")}>
          {chosen.map((c) => (
            <span key={c.id} className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/40 py-0.5 pl-1 pr-0.5 text-xs font-medium">
              {c.project ? <PlatformBadge platform={c.project.platform} className="h-4 w-[46px] text-[9px]" /> : null}
              <span className="min-w-0 truncate" title={c.name}>{c.name}</span>
              {!disabled && (
                <button type="button" onClick={() => remove(c.id)} aria-label={`Remove ${c.name}`}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-3" /></button>
              )}
            </span>
          ))}
          {!disabled && !full && (
            <button type="button" onClick={() => setOpen(true)}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
              <Plus className="size-3" /> Add
            </button>
          )}
          {!disabled && (
            <button type="button" onClick={() => onChange([])} aria-label="Clear all projects" title="Clear all"
              className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-3.5" /></button>
          )}
        </div>
      ) : (
        <div className="relative">
          <button type="button" id={id} disabled={disabled} onClick={() => setOpen(true)}
            aria-haspopup="listbox" aria-expanded={false}
            className="flex h-10 w-full items-center gap-2 rounded-lg border bg-background pl-3 pr-9 text-left text-sm outline-none transition hover:border-foreground/20 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60">
            {chosen[0] ? (
              <>
                {chosen[0].project && <PlatformBadge platform={chosen[0].project.platform} />}
                <span className="min-w-0 truncate font-medium">{chosen[0].name}</span>
                {chosen.length > 1 && <span className="shrink-0 text-xs text-muted-foreground">+{chosen.length - 1}</span>}
              </>
            ) : (
              <>
                <FolderKanban className="size-4 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">{multiple ? "No project — pick one or more" : "No project"}</span>
              </>
            )}
          </button>
          {value.length > 0 && !disabled ? (
            <button type="button" onClick={() => onChange([])} aria-label="Clear project" title="Clear project"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground">
              <X className="size-3.5" />
            </button>
          ) : (
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          )}
        </div>
      ))}

      {open && (
        <div onKeyDown={onKey} className="overflow-hidden rounded-xl border bg-background shadow-sm ring-1 ring-ring/20">
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            {/* The highlight resets with the text, in the same update — so "type, Enter" at
                full speed acts on the first match, never on a row from the previous results. */}
            <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} placeholder="Search projects…"
              aria-label="Search projects" aria-controls="task-project-list" aria-activedescendant={`task-project-${active}`}
              className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            {multiple ? (
              <>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{value.length} selected</span>
                {value.length > 0 && (
                  <button type="button" onClick={() => onChange([])}
                    className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
                    Clear
                  </button>
                )}
              </>
            ) : (
              <button type="button" onClick={close}
                className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
                Esc
              </button>
            )}
          </div>
          <ul id="task-project-list" ref={listRef} role="listbox" aria-label="Projects" aria-multiselectable={multiple || undefined}
            className="max-h-60 overflow-y-auto p-1">
            {isLoading ? (
              <li className="px-3 py-4 text-center text-xs text-muted-foreground">Loading projects…</li>
            ) : rows.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-muted-foreground">No project matches “{q}”</li>
            ) : rows.map((p, i) => {
              const isSel = p ? value.includes(p.id) : value.length === 0;
              const blocked = multiple && !!p && !isSel && full;
              const prev = rows[i - 1];
              const newGroup = !!p && !!prev && prev.group !== p.group;
              return (
                <li key={p?.id ?? "none"} role="option" aria-selected={isSel} aria-disabled={blocked || undefined} id={`task-project-${i}`}
                  className={cn(newGroup && "mt-1 border-t pt-1", !p && "mb-1 border-b pb-1")}>
                  <button type="button" data-row={i} onClick={() => pick(p)} onMouseEnter={() => setActive(i)} tabIndex={-1}
                    disabled={blocked} title={blocked ? `Up to ${MAX_PROJECTS} projects` : undefined}
                    className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition disabled:opacity-40",
                      i === active ? "bg-muted" : "hover:bg-muted/60")}>
                    {multiple && p && (
                      <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border transition",
                        isSel ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")}>
                        {isSel && <Check className="size-3" />}
                      </span>
                    )}
                    {p ? <PlatformBadge platform={p.platform} /> : <X className="mx-[19px] size-4 text-muted-foreground" />}
                    <span className={cn("min-w-0 flex-1 truncate", p ? "font-medium" : "text-muted-foreground")}>
                      {p ? p.name : "No project"}
                    </span>
                    {!multiple && isSel && p && <Check className="size-4 shrink-0 text-primary" />}
                  </button>
                </li>
              );
            })}
          </ul>
          {(canManage || multiple) && (
            <div className="flex items-center gap-2 border-t px-2 py-1.5">
              {canManage && (
                <button type="button" onClick={() => { close(); setManaging(true); }}
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground">
                  <Settings2 className="size-3.5" /> Manage projects
                </button>
              )}
              {full && <span className="text-[11px] text-muted-foreground">Up to {MAX_PROJECTS} projects</span>}
              {multiple && (
                <button type="button" onClick={close}
                  className="ml-auto rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90">
                  Done
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {canManage && <ProjectsManagerModal open={managing} onClose={() => setManaging(false)} />}
    </div>
  );
}
