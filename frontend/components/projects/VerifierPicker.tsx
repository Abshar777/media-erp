"use client";

/**
 * Searchable picker for verifiers — teams and people in one list.
 *
 * A plain <select> meant scrolling 24 names to find one person. Typing
 * narrows both groups at once, so "des" finds DESIGN TEAM and Designer
 * without the user having to know which group they're in.
 */

import { useMemo, useRef, useState, useEffect } from "react";
import { Search, X, Users, User, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PickerTeam { id: string; name: string; color?: string }
export interface PickerPerson { id: string; name: string; email?: string; designation?: string }

export function VerifierPicker({
  teams, people, selectedTeams, selectedPeople, onToggleTeam, onTogglePerson, excludePersonId,
}: {
  teams: PickerTeam[];
  people: PickerPerson[];
  selectedTeams: string[];
  selectedPeople: string[];
  onToggleTeam: (id: string) => void;
  onTogglePerson: (id: string) => void;
  /** The assignee — they can't verify their own work, so never offer them. */
  excludePersonId?: string;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Close on outside click, so the list doesn't sit over the rest of the form.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const q = search.trim().toLowerCase();

  const teamHits = useMemo(
    () => teams.filter((t) => !q || t.name.toLowerCase().includes(q)),
    [teams, q]
  );

  const personHits = useMemo(
    () =>
      people
        .filter((p) => p.id !== excludePersonId)
        .filter(
          (p) =>
            !q ||
            p.name?.toLowerCase().includes(q) ||
            p.email?.toLowerCase().includes(q) ||
            p.designation?.toLowerCase().includes(q)
        ),
    [people, q, excludePersonId]
  );

  const nothing = teamHits.length === 0 && personHits.length === 0;

  return (
    <div ref={boxRef} className="relative space-y-2">
      {/* Chosen so far */}
      {(selectedTeams.length > 0 || selectedPeople.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {selectedTeams.map((id) => (
            <button
              key={`t-${id}`} type="button" onClick={() => onToggleTeam(id)}
              className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary hover:bg-primary/20"
            >
              <Users className="size-3" />
              {teams.find((t) => t.id === id)?.name ?? "Team"}
              <X className="size-3" />
            </button>
          ))}
          {selectedPeople.map((id) => (
            <button
              key={`p-${id}`} type="button" onClick={() => onTogglePerson(id)}
              className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] hover:bg-muted/70"
            >
              <User className="size-3" />
              {people.find((p) => p.id === id)?.name ?? "Person"}
              <X className="size-3" />
            </button>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input
          value={search}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
          placeholder="Search a team or a person…"
          className="w-full rounded-lg border bg-background pl-9 pr-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
      </div>

      {open && (
        <div className="absolute z-20 max-h-56 w-full overflow-y-auto rounded-xl border bg-card p-1 shadow-lg">
          {nothing && (
            <p className="py-4 text-center text-xs text-muted-foreground">
              Nothing matches &ldquo;{search}&rdquo;
            </p>
          )}

          {teamHits.length > 0 && (
            <>
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Teams — everyone in them
              </p>
              {teamHits.map((t) => {
                const on = selectedTeams.includes(t.id);
                return (
                  <button
                    key={t.id} type="button" onClick={() => onToggleTeam(t.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
                      on ? "bg-primary/10" : "hover:bg-muted"
                    )}
                  >
                    <Users className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{t.name}</span>
                    {on && <Check className="size-3.5 text-primary" />}
                  </button>
                );
              })}
            </>
          )}

          {personHits.length > 0 && (
            <>
              <p className="px-2 py-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                People
              </p>
              {personHits.slice(0, 40).map((p) => {
                const on = selectedPeople.includes(p.id);
                return (
                  <button
                    key={p.id} type="button" onClick={() => onTogglePerson(p.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
                      on ? "bg-primary/10" : "hover:bg-muted"
                    )}
                  >
                    <User className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{p.name || p.email}</span>
                    {p.designation && (
                      <span className="max-w-24 shrink-0 truncate text-[10px] text-muted-foreground">
                        {p.designation}
                      </span>
                    )}
                    {on && <Check className="size-3.5 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
