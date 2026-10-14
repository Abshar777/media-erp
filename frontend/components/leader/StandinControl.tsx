"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, Loader2, Search, UserRoundCheck, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePopoverSide } from "@/hooks/usePopoverSide";
import { istTodayKey } from "@/lib/datetime";
import { addDaysISO } from "@/lib/adReports";
import { useTeams } from "@/hooks/useTeams";
import { useAuthStore } from "@/stores/authStore";
import { delayLabel, useAutoApprove } from "@/hooks/useAutoApprove";
import { standinDay, useEndStandin, useHandOver, useStandin } from "@/hooks/useStandin";

const LENGTHS = [3, 7, 10, 30];
const AVATAR = ["#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f97316", "#22c55e", "#14b8a6", "#3b82f6"];
const avatarBg = (n: string) => AVATAR[(n.charCodeAt(0) || 0) % AVATAR.length];

/**
 * Leader Desk header control, next to Auto-approve: hand your desk to a
 * teammate while you're away. A pill that shows who's standing in (and until
 * when), opening a card to choose the person, the days, the teams and whether
 * they may review too. Renders nothing for someone who doesn't lead a team.
 */
export function StandinControl() {
  const { data } = useStandin();
  const { data: allTeams = [] } = useTeams();
  const { data: auto } = useAutoApprove();
  const meId = useAuthStore((s) => s.user)?.id ?? "";
  const handOver = useHandOver();
  const end = useEndStandin();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const side = usePopoverSide(ref, open, 400);

  // Form state
  const today = istTodayKey();
  const [who, setWho] = useState("");
  const [q, setQ] = useState("");
  const [start, setStart] = useState(today);
  const [length, setLength] = useState<number | "custom">(7);
  const [customEnd, setCustomEnd] = useState(addDaysISO(today, 6));
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [review, setReview] = useState(false);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); window.removeEventListener("keydown", esc); };
  }, [open]);

  const led = useMemo(() => data?.teams ?? [], [data]);
  // Everyone in the teams I lead (not me), with the led teams they belong to.
  const people = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; email: string; teams: string[] }>();
    for (const lt of led) {
      const t = allTeams.find((x) => x.id === lt.id);
      for (const m of t?.members ?? []) {
        if (m.user_id === meId) continue;
        const p = byId.get(m.user_id) ?? { id: m.user_id, name: m.name || m.email, email: m.email, teams: [] };
        p.teams.push(lt.id);
        byId.set(m.user_id, p);
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [led, allTeams, meId]);
  const shown = people.filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(q.trim().toLowerCase()));
  const person = people.find((p) => p.id === who);

  if (!data?.can_use) return null;
  const mine = data.mine;
  const teamName = (id: string) => led.find((t) => t.id === id)?.name ?? "";

  const startForm = () => {
    setWho(mine?.standin_id ?? "");
    setQ("");
    setStart(mine && mine.start_date >= today ? mine.start_date : today);
    setLength(7);
    setCustomEnd(mine?.end_date ?? addDaysISO(today, 6));
    setTeamIds(mine?.team_ids ?? []);
    setReview(mine?.can_review ?? false);
    setEditing(true);
  };
  const pick = (id: string) => {
    setWho(id);
    // Cover every team I lead that they're in.
    setTeamIds(people.find((p) => p.id === id)?.teams ?? []);
  };
  const endDate = length === "custom" ? customEnd : addDaysISO(start, length - 1);
  const days = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
  const maxDays = data.max_days || 60;
  const datesOk = start >= today && endDate >= start && days <= maxDays;
  const valid = !!who && teamIds.length > 0 && datesOk;

  const submit = () => {
    if (!valid) return;
    handOver.mutate(
      { standin_id: who, start_date: start, end_date: endDate, team_ids: teamIds, can_review: review },
      { onSuccess: () => setEditing(false) },
    );
  };

  const live = mine?.state === "active";
  const pillText = !mine ? "Off" : live ? `${first(mine.standin_name)} · until ${shortDay(mine.end_date)}`
    : `${first(mine.standin_name)} · from ${shortDay(mine.start_date)}`;
  const formOpen = editing || !mine;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setEditing(false); }}
        aria-expanded={open}
        className={cn(
          "flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
          mine
            ? "border-violet-500/40 bg-violet-500/10 text-violet-700 hover:bg-violet-500/15 dark:text-violet-300"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <UserRoundCheck className="size-4" />
        Stand-in
        <span className={cn("max-w-[11rem] truncate rounded-full px-2 py-0.5 text-[11px] font-semibold",
          mine ? "bg-violet-500/15" : "bg-muted")}>
          {pillText}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Stand-in settings"
          className={cn("fixed inset-x-3 top-24 z-50 max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-2xl border bg-card p-4 shadow-xl sm:absolute sm:inset-x-auto sm:top-full sm:mt-2 sm:w-[25rem]",
            side === "right" ? "sm:right-0" : "sm:left-0")}
        >
          <div className="flex items-start gap-3">
            <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
              mine ? "bg-violet-500/15 text-violet-600 dark:text-violet-300" : "bg-muted text-muted-foreground")}>
              <UserRoundCheck className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Stand-in while you&apos;re away</p>
              <p className="text-xs text-muted-foreground">
                Hand your Assign Work and Reedits to a teammate for a few days. You keep full access.
              </p>
            </div>
          </div>

          {/* Current hand-over */}
          {mine && !editing && (
            <div className="mt-4 rounded-xl border border-violet-500/30 bg-violet-500/5 p-3">
              <div className="flex items-center gap-2.5">
                <Avatar name={mine.standin_name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{mine.standin_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {live ? "Standing in now" : "Starts"} · {standinDay(mine.start_date)} → {standinDay(mine.end_date)}
                  </p>
                </div>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  live ? "bg-violet-500/15 text-violet-700 dark:text-violet-300" : "bg-muted text-muted-foreground")}>
                  {live ? "Active" : "Scheduled"}
                </span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11px]">
                {mine.teams.map((t) => <span key={t.id} className="rounded-full bg-muted px-2 py-0.5">{t.name}</span>)}
                <span className="rounded-full bg-muted px-2 py-0.5">Assign Work · Reedit{mine.can_review ? " · Reviews" : ""}</span>
              </div>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={startForm}
                  className="flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted">Change</button>
                <button type="button" disabled={end.isPending} onClick={() => end.mutate()}
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-violet-500/40 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-500/10 disabled:opacity-50 dark:text-violet-300">
                  {end.isPending && <Loader2 className="size-3.5 animate-spin" />}
                  {live ? "End now — I'm back" : "Cancel it"}
                </button>
              </div>
            </div>
          )}

          {formOpen && (
            <div className="mt-4 space-y-4">
              {/* Who */}
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Who stands in</p>
                <div className="overflow-hidden rounded-xl border">
                  {people.length > 6 && (
                    <div className="flex items-center gap-2 border-b px-3 py-1.5">
                      <Search className="size-3.5 text-muted-foreground" />
                      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your team…"
                        aria-label="Search your team" className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none" />
                    </div>
                  )}
                  <ul role="radiogroup" aria-label="Who stands in" className="max-h-44 overflow-y-auto p-1">
                    {shown.length === 0 && <li className="px-3 py-4 text-center text-xs text-muted-foreground">Nobody in your teams yet</li>}
                    {shown.map((p) => (
                      <li key={p.id}>
                        <button type="button" role="radio" aria-checked={who === p.id} onClick={() => pick(p.id)}
                          className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition",
                            who === p.id ? "bg-violet-500/10" : "hover:bg-muted/70")}>
                          <Avatar name={p.name} small />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{p.name}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">{p.teams.map(teamName).join(" · ")}</span>
                          </span>
                          {who === p.id && <Check className="size-4 shrink-0 text-violet-600 dark:text-violet-300" />}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* When */}
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">For how long</p>
                <div className="grid grid-cols-5 gap-1.5">
                  {LENGTHS.map((n) => (
                    <button key={n} type="button" aria-pressed={length === n} onClick={() => setLength(n)}
                      className={cn("rounded-lg border px-1 py-1.5 text-xs font-medium transition-colors",
                        length === n ? "border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-300" : "hover:bg-muted")}>
                      {n} days
                    </button>
                  ))}
                  <button type="button" aria-pressed={length === "custom"} onClick={() => setLength("custom")}
                    className={cn("rounded-lg border px-1 py-1.5 text-xs font-medium transition-colors",
                      length === "custom" ? "border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-300" : "hover:bg-muted")}>
                    Custom
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="text-[11px] text-muted-foreground">
                    From
                    <input type="date" value={start} min={today} onChange={(e) => setStart(e.target.value)}
                      className="mt-0.5 h-8 w-full rounded-lg border bg-background px-2 text-sm text-foreground outline-none focus:border-ring" />
                  </label>
                  <label className="text-[11px] text-muted-foreground">
                    Until (last day)
                    <input type="date" value={endDate} min={start} disabled={length !== "custom"}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className="mt-0.5 h-8 w-full rounded-lg border bg-background px-2 text-sm text-foreground outline-none focus:border-ring disabled:opacity-70" />
                  </label>
                </div>
                {!datesOk && (
                  <p className="mt-1 text-[11px] text-rose-500">
                    {start < today ? "Start today or later." : endDate < start ? "The last day can't be before the start." : `Up to ${maxDays} days.`}
                  </p>
                )}
              </div>

              {/* Teams */}
              {person && led.length > 1 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Teams they cover</p>
                  <div className="flex flex-wrap gap-1.5">
                    {led.map((t) => {
                      const member = person.teams.includes(t.id);
                      const on = teamIds.includes(t.id);
                      return (
                        <button key={t.id} type="button" disabled={!member} aria-pressed={on}
                          title={member ? undefined : `${person.name} isn't in ${t.name}`}
                          onClick={() => setTeamIds((ids) => (on ? ids.filter((x) => x !== t.id) : [...ids, t.id]))}
                          className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition",
                            on ? "border-violet-500/50 bg-violet-500/10" : "text-muted-foreground hover:bg-muted",
                            !member && "cursor-not-allowed opacity-50")}>
                          <span className="size-2 rounded-full" style={{ background: t.color || "#94a3b8" }} />
                          {t.name}{!member && " · not in it"}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Reviews */}
              <div className="rounded-xl border p-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Also review submissions</p>
                    <p className="text-[11px] text-muted-foreground">Approve or send back their teammates&apos; work — never their own.</p>
                  </div>
                  <button type="button" role="switch" aria-checked={review} aria-label="Also review submissions"
                    onClick={() => setReview((v) => !v)}
                    className={cn("relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                      review ? "bg-violet-500" : "bg-muted-foreground/30")}>
                    <span className={cn("inline-block size-5 rounded-full bg-white shadow transition-transform",
                      review ? "translate-x-5" : "translate-x-0.5")} />
                  </button>
                </div>
                <p className={cn("mt-2 flex items-center gap-1.5 text-[11px]",
                  auto?.enabled ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
                  <Zap className={cn("size-3", auto?.enabled && "fill-current")} />
                  {auto?.enabled
                    ? `Your auto-approve is on (${delayLabel(auto.delay_minutes)}) — submissions keep moving.`
                    : review ? "Your auto-approve is off — your stand-in reviews submissions."
                      : "Your auto-approve is off — submissions wait for you. Turn it on, or let them review."}
                </p>
              </div>

              {/* Summary + action */}
              {person && datesOk && (
                <p className="flex items-start gap-2 rounded-lg bg-violet-500/10 px-3 py-2 text-xs text-violet-900 dark:text-violet-200">
                  <CalendarDays className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {standinDay(start)} → {standinDay(endDate)} ({days} day{days === 1 ? "" : "s"}):{" "}
                    <b>{person.name}</b> gets Assign Work and Reedit{review ? ", and reviews," : ""} for{" "}
                    {teamIds.map(teamName).join(", ") || "—"}. Work routed to you goes to them. Your team is told.
                  </span>
                </p>
              )}
              <div className="flex gap-2">
                {mine && (
                  <button type="button" onClick={() => setEditing(false)}
                    className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">Back</button>
                )}
                <button type="button" disabled={!valid || handOver.isPending} onClick={submit}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-violet-600/90 disabled:opacity-50">
                  {handOver.isPending ? <Loader2 className="size-4 animate-spin" /> : <UserRoundCheck className="size-4" />}
                  {mine ? "Save changes" : "Hand over"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Avatar({ name, small }: { name: string; small?: boolean }) {
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
      small ? "size-7 text-[11px]" : "size-9 text-sm")} style={{ background: avatarBg(name) }}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

const first = (name: string) => name.split(" ")[0] || name;
const shortDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
