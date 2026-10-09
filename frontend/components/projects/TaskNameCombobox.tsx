"use client";

/**
 * Task name with suggestions — a WAI-ARIA combobox, like a search box.
 *
 * Built to stay out of the way:
 *  • it never forces a choice — any name can still be typed;
 *  • nothing is highlighted until you press ↓, so Enter keeps its normal job;
 *  • it doesn't open at all when there's nothing to suggest, and it opens on
 *    a click, typing or ↓ — not just because the form focused the field;
 *  • the list for a team loads once and filters in the browser, so typing
 *    never waits on the network.
 * Leaders get a one-click "★ Save for <team>" for a new name (name only — no
 * dialog), and a ☆ on recently used names. Before a team is picked (Title comes
 * first in Add Task) a leader is offered each team they lead; admins save for
 * everyone.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Building2, Clock, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { highlight, rankSuggestions, type Suggestion } from "@/lib/taskPresets";
import { useSaveTaskPreset, useTaskSuggestions } from "@/hooks/useTaskPresets";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onPick: (s: Suggestion) => void;
  teamId: string;
  teamName?: string;
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
}

export function TaskNameCombobox({ value, onChange, onPick, teamId, teamName, autoFocus, placeholder = "Task title...", className }: Props) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const { data } = useTaskSuggestions(teamId);
  const save = useSaveTaskPreset();

  const all: Suggestion[] = useMemo(() => [
    ...(data?.saved ?? []).map((p) => ({ key: `s-${p.id}`, title: p.title, source: "saved" as const, uses: p.uses,
      teamId: p.team_id, teamName: p.team_name, description: p.description, priority: p.priority })),
    ...(data?.company ?? []).map((p) => ({ key: `c-${p.id}`, title: p.title, source: "company" as const, uses: p.uses,
      teamId: null, description: p.description, priority: p.priority })),
    ...(data?.recent ?? []).map((r) => ({ key: `r-${r.title}`, title: r.title, source: "recent" as const, uses: r.uses })),
  ], [data]);

  const query = value;
  const items = useMemo(() => rankSuggestions(all, query, query.trim() ? 8 : 6), [all, query]);
  const typed = value.trim();
  // Already saved WHERE? A name saved for one team can still be saved for
  // another; a company name covers everyone.
  const savedFor = (target: { id: string | null }) => all.some((s) =>
    s.source !== "recent" && s.title.trim().toLowerCase() === typed.toLowerCase()
    && (s.source === "company" || target.id === null || s.teamId === target.id));
  // Where a new name can be saved: the picked team (if you may), "everyone"
  // (admin roles, no team picked), or — no team picked — each team you lead.
  const targets: { id: string | null; name: string }[] = data?.can_save
    ? [{ id: teamId || null, name: teamId ? (teamName || "this team") : "everyone" }]
    : !teamId ? (data?.save_teams ?? []).map((t) => ({ id: t.id, name: t.name })) : [];
  const nameOk = typed.length > 0 && typed.length <= 120;
  const saveRows = nameOk ? targets.filter((t) => !savedFor(t)).slice(0, 3) : [];
  const canSave = saveRows.length > 0;
  // The ☆ on a recent name needs one unambiguous place to save it.
  const starTarget = targets.length === 1 ? targets[0] : null;
  const showList = open && (items.length > 0 || canSave);

  useEffect(() => setActive(-1), [query, teamId]);

  const pick = (s: Suggestion) => {
    onPick(s);
    setOpen(false);
    setActive(-1);
  };

  const saveName = async (title: string, target: { id: string | null; name: string }) => {
    try {
      await save.mutateAsync({ team_id: target.id, title });
      toast.success(`Saved — “${title}” will be suggested for ${target.name}`);
    } catch { /* hook showed the message */ }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showList) {
      if (e.key === "ArrowDown" && (items.length || canSave)) { setOpen(true); e.preventDefault(); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); setActive(-1); }
    else if ((e.key === "Enter" || e.key === "Tab") && active >= 0 && items[active]) {
      if (e.key === "Enter") e.preventDefault();
      pick(items[active]);
    }
  };

  return (
    <div className={cn("relative", className)}>
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        // Not on focus: Add Task focuses this field itself, and the list popping
        // open over the form before anyone touched it would just get in the way.
        onMouseDown={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}   // let a click on a row land first
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        maxLength={200}
        className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
      />

      {showList && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl border bg-popover shadow-xl"
          onMouseDown={(e) => e.preventDefault()}>      {/* keep focus in the input */}
          {items.length > 0 && (
            <ul id={listId} role="listbox" aria-label="Suggested task names" className="max-h-64 overflow-y-auto py-1">
              {!typed && <li role="presentation" className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Suggestions</li>}
              {items.map((s, i) => {
                const Icon = s.source === "saved" ? Star : s.source === "company" ? Building2 : Clock;
                return (
                  <li
                    key={s.key}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(s)}
                    className={cn("group flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm", i === active && "bg-muted")}
                  >
                    <Icon className={cn("size-3.5 shrink-0",
                      s.source === "saved" ? "fill-amber-400 text-amber-500" : s.source === "company" ? "text-blue-500" : "text-muted-foreground")} />
                    <span className="min-w-0 flex-1 truncate">
                      {highlight(s.title, typed).map((part, j) => (
                        <span key={j} className={part.hit ? "font-semibold text-foreground" : undefined}>{part.text}</span>
                      ))}
                    </span>
                    {!teamId && s.teamName && (
                      <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{s.teamName}</span>
                    )}
                    {s.source === "company" && <span className="shrink-0 text-[10px] text-muted-foreground">Company</span>}
                    {(s.description || s.priority) && s.source !== "recent" && (
                      <span className="shrink-0 text-[10px] text-muted-foreground" title="Also fills the description / priority if they're empty">+ details</span>
                    )}
                    {s.source === "recent" && s.uses > 1 && <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">used {s.uses}×</span>}
                    {s.source === "recent" && starTarget && (
                      <button type="button" aria-label={`Save “${s.title}” for ${starTarget.name}`} title={`Save for ${starTarget.name}`}
                        onClick={(e) => { e.stopPropagation(); saveName(s.title, starTarget); }}
                        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition hover:text-amber-500 group-hover:opacity-100 focus:opacity-100">
                        <Star className="size-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {saveRows.map((target, i) => (
            <button key={target.id ?? "everyone"} type="button" onClick={() => saveName(typed, target)} disabled={save.isPending}
              className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50",
                (i === 0 && items.length > 0) && "border-t")}>
              <Star className="size-3.5 shrink-0 text-amber-500" />
              <span className="min-w-0 truncate">Save <span className="font-medium text-foreground">“{typed}”</span> for {target.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
