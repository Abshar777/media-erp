"use client";

/**
 * MemberScopePicker — switches the Overview between "my overview" and one of
 * the people the viewer leads.
 *
 * Single-select, searchable, grouped by team. Follows the WAI-ARIA combobox
 * pattern (input owns focus, arrow keys move a highlighted option, Enter picks,
 * Escape closes) so it is fully usable from the keyboard.
 *
 * Avatars are initials on purpose: a member's `avatar` may still be a legacy
 * public R2 URL, which the private bucket now answers with 401 — an <img>
 * there would render as a broken-image glyph.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, LayoutDashboard, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ScopeMember {
  id: string;
  name: string;
  designation?: string;
  role?: "leader" | "member";
}

export interface ScopeGroup {
  id: string;
  name: string;
  color?: string;
  members: ScopeMember[];
}

interface MemberScopePickerProps {
  groups: ScopeGroup[];
  /** "" = the viewer's own overview. */
  value: string;
  onChange: (memberId: string) => void;
  className?: string;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

type Option =
  | { kind: "self"; key: string }
  | { kind: "member"; key: string; member: ScopeMember; groupId: string };

export function MemberScopePicker({ groups, value, onChange, className }: MemberScopePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = useMemo(() => {
    for (const g of groups) {
      const m = g.members.find((x) => x.id === value);
      if (m) return m;
    }
    return null;
  }, [groups, value]);

  // Filter by name, designation or team name — typing "video" finds everyone
  // in the Video team without knowing their names.
  const q = query.trim().toLowerCase();
  const visibleGroups = useMemo(
    () =>
      groups
        .map((g) => {
          const teamHit = !!q && g.name.toLowerCase().includes(q);
          return {
            ...g,
            members: g.members.filter(
              (m) =>
                !q ||
                teamHit ||
                m.name.toLowerCase().includes(q) ||
                (m.designation ?? "").toLowerCase().includes(q)
            ),
          };
        })
        .filter((g) => g.members.length > 0),
    [groups, q]
  );

  // Flat list in render order, so arrow keys walk exactly what is on screen.
  const options: Option[] = useMemo(() => {
    const out: Option[] = [];
    if (!q) out.push({ kind: "self", key: "__self__" });
    for (const g of visibleGroups) {
      for (const m of g.members) out.push({ kind: "member", key: m.id, member: m, groupId: g.id });
    }
    return out;
  }, [visibleGroups, q]);

  // Open on the current selection, not always at the top.
  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex((o) => (o.kind === "self" ? value === "" : o.key === value));
    setActive(idx >= 0 ? idx : 0);
    // Only when opening — re-running on every keystroke would fight the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Typing resets the highlight to the first match.
  useEffect(() => {
    setActive(0);
  }, [q]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery("");
  }, [open]);

  // Close on a click anywhere outside.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Keep the highlighted option in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function pick(opt: Option) {
    onChange(opt.kind === "self" ? "" : opt.key);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (options.length ? (i + 1) % options.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (options.length ? (i - 1 + options.length) % options.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = options[active];
      if (opt) pick(opt);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const viewingOther = !!selected;
  let flatIndex = 0;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={viewingOther ? `Viewing ${selected!.name}'s overview. Change` : "Choose whose overview to view"}
        className={cn(
          "group flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-sm font-medium",
          "transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:w-auto",
          viewingOther
            ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
            : "bg-card text-foreground hover:bg-muted/50"
        )}
      >
        {viewingOther ? (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
            {initials(selected!.name)}
          </span>
        ) : (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <LayoutDashboard className="size-3.5" />
          </span>
        )}
        <span className="flex-1 truncate text-left sm:max-w-[200px]">
          {viewingOther ? selected!.name : "My overview"}
        </span>
        <ChevronDown className={cn("size-4 shrink-0 opacity-60 transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="absolute left-0 right-0 top-full z-50 mt-2 origin-top overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl sm:left-auto sm:w-80"
          >
            {/* Search */}
            <div className="flex items-center gap-2 border-b px-3 py-2.5">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search team members…"
                role="combobox"
                aria-expanded={open}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => { setQuery(""); inputRef.current?.focus(); }}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            <div ref={listRef} id={listId} role="listbox" className="max-h-80 overflow-y-auto p-1.5">
              {/* Own overview */}
              {!q && (() => {
                const idx = flatIndex++;
                const isSel = value === "";
                return (
                  <div
                    id={`${listId}-${idx}`}
                    data-index={idx}
                    role="option"
                    aria-selected={isSel}
                    onMouseEnter={() => setActive(idx)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(options[idx])}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm",
                      active === idx && "bg-muted"
                    )}
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <LayoutDashboard className="size-3.5" />
                    </span>
                    <span className="flex-1 font-medium">My overview</span>
                    {isSel && <Check className="size-4 text-primary" />}
                  </div>
                );
              })()}

              {visibleGroups.map((g) => (
                <div key={g.id} className="mt-1 first:mt-0">
                  <div className="flex items-center gap-2 px-2.5 pb-1 pt-2.5">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: g.color || "#6366f1" }} />
                    <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {g.name}
                    </span>
                    <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/70">{g.members.length}</span>
                  </div>
                  {g.members.map((m) => {
                    const idx = flatIndex++;
                    const isSel = m.id === value;
                    return (
                      <div
                        key={m.id}
                        id={`${listId}-${idx}`}
                        data-index={idx}
                        role="option"
                        aria-selected={isSel}
                        onMouseEnter={() => setActive(idx)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pick(options[idx])}
                        className={cn(
                          "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm",
                          active === idx && "bg-muted"
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                            isSel ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"
                          )}
                        >
                          {initials(m.name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate font-medium">{m.name}</span>
                            {m.role === "leader" && (
                              <span className="shrink-0 rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide bg-amber-500/15 text-amber-600 dark:text-amber-400">
                                Lead
                              </span>
                            )}
                          </span>
                          {m.designation && (
                            <span className="block truncate text-[11px] text-muted-foreground">{m.designation}</span>
                          )}
                        </span>
                        {isSel && <Check className="size-4 shrink-0 text-primary" />}
                      </div>
                    );
                  })}
                </div>
              ))}

              {q && visibleGroups.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No team members match &ldquo;{query.trim()}&rdquo;
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default MemberScopePicker;
