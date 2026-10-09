"use client";

/**
 * The optional "Project" (ad account) on a task — Add Task and the task detail.
 *
 * Closed it reads like the other fields: "No project", or the chosen one with
 * its platform badge and an × to clear. Open it is a list INSIDE the form, not
 * a native <select>: Windows paints a native option list light while the dark
 * theme's text stays light, and an in-flow list is never clipped by the
 * modal's scroll. Search narrows as you type; the groups keep the order they
 * were given in; ↑ ↓ Enter Esc work.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, FolderKanban, Search, Settings2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTaskProjects, type TaskProject } from "@/hooks/useTaskProjects";
import { useAuthStore } from "@/stores/authStore";
import { PlatformBadge } from "./PlatformBadge";
import { ProjectsManagerModal } from "./ProjectsManager";

const ELEVATED = ["Super Admin", "Admin", "Coordinator"];

export { PlatformBadge } from "./PlatformBadge";

interface Props {
  /** Project id, or "" for none. */
  value: string;
  onChange: (id: string) => void;
  /** Shown when the saved project is no longer in the list (renamed/archived). */
  fallbackName?: string;
  disabled?: boolean;
  id?: string;
}

export function ProjectPicker({ value, onChange, fallbackName, disabled, id }: Props) {
  const { data: projects = [], isLoading } = useTaskProjects();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Admin roles can open the list's manager from here, without leaving the form.
  const canManage = ELEVATED.includes(useAuthStore((s) => s.user?.role?.role_name) ?? "");
  const [managing, setManaging] = useState(false);

  const selected = projects.find((p) => p.id === value) ?? null;
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? projects.filter((p) => p.name.toLowerCase().includes(t)) : projects;
  }, [projects, q]);
  // Row 0 is "No project" while something is chosen (and not searching).
  const offerNone = !!value && !q.trim();
  const rows: (TaskProject | null)[] = offerNone ? [null, ...shown] : shown;

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, rows.findIndex((r) => (r?.id ?? "") === value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q]);

  // Close when clicking anywhere else.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setOpen(false); setQ(""); }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (p: TaskProject | null) => { onChange(p?.id ?? ""); setOpen(false); setQ(""); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); setQ(""); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(rows.length - 1, i + 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    if (e.key === "Enter")     { e.preventDefault(); if (rows[active] !== undefined) pick(rows[active]); }   // never submits the form
  };

  const name = selected?.name ?? (value ? fallbackName : "");

  return (
    <div ref={boxRef} className="space-y-1.5">
      {!open && (
        <div className="relative">
          <button type="button" id={id} disabled={disabled} onClick={() => setOpen(true)}
            aria-haspopup="listbox" aria-expanded={false}
            className="flex h-10 w-full items-center gap-2 rounded-lg border bg-background pl-3 pr-9 text-left text-sm outline-none transition hover:border-foreground/20 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60">
            {name ? (
              <>
                {selected && <PlatformBadge platform={selected.platform} />}
                <span className="min-w-0 truncate font-medium">{name}</span>
              </>
            ) : (
              <>
                <FolderKanban className="size-4 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">No project</span>
              </>
            )}
          </button>
          {value && !disabled ? (
            <button type="button" onClick={() => onChange("")} aria-label="Clear project" title="Clear project"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground">
              <X className="size-3.5" />
            </button>
          ) : (
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          )}
        </div>
      )}

      {open && (
        <div onKeyDown={onKey} className="overflow-hidden rounded-xl border bg-background shadow-sm ring-1 ring-ring/20">
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects…"
              aria-label="Search projects" aria-controls="task-project-list" aria-activedescendant={`task-project-${active}`}
              className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            <button type="button" onClick={() => { setOpen(false); setQ(""); }}
              className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
              Esc
            </button>
          </div>
          <ul id="task-project-list" ref={listRef} role="listbox" aria-label="Projects" className="max-h-60 overflow-y-auto p-1">
            {isLoading ? (
              <li className="px-3 py-4 text-center text-xs text-muted-foreground">Loading projects…</li>
            ) : rows.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-muted-foreground">No project matches “{q}”</li>
            ) : rows.map((p, i) => {
              const isSel = (p?.id ?? "") === value;
              const prev = rows[i - 1];
              const newGroup = !!p && !!prev && prev.group !== p.group;
              return (
                <li key={p?.id ?? "none"} role="option" aria-selected={isSel} id={`task-project-${i}`}
                  className={cn(newGroup && "mt-1 border-t pt-1", !p && "mb-1 border-b pb-1")}>
                  <button type="button" data-row={i} onClick={() => pick(p)} onMouseEnter={() => setActive(i)} tabIndex={-1}
                    className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition",
                      i === active ? "bg-muted" : "hover:bg-muted/60")}>
                    {p ? <PlatformBadge platform={p.platform} /> : <X className="mx-[19px] size-4 text-muted-foreground" />}
                    <span className={cn("min-w-0 flex-1 truncate", p ? "font-medium" : "text-muted-foreground")}>
                      {p ? p.name : "No project"}
                    </span>
                    {isSel && <Check className="size-4 shrink-0 text-primary" />}
                  </button>
                </li>
              );
            })}
          </ul>
          {canManage && (
            <button type="button" onClick={() => { setOpen(false); setQ(""); setManaging(true); }}
              className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground">
              <Settings2 className="size-3.5" /> Manage projects
              <span className="ml-auto font-normal">add · rename · delete</span>
            </button>
          )}
        </div>
      )}
      {canManage && <ProjectsManagerModal open={managing} onClose={() => setManaging(false)} />}
    </div>
  );
}
