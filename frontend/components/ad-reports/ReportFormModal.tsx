"use client";

/**
 * "+ New report" (leaders) and "Edit". One short form, two kinds:
 *  • Ad / campaign — numbers are entered daily; may belong to an account.
 *  • Ad account   — Meta's top level; its numbers are its ads added up, so it
 *                   has no dates, metrics or reminders of its own. Its people
 *                   (optional) look after it: they see and update its ads.
 *
 * Built like Add Task: choose the team(s) first, then people from those teams
 * ("Show everyone" widens the list). Several teams — the first is the main one —
 * and up to six people, the first being the owner. Both can change in Edit.
 */
import { useEffect, useMemo, useState } from "react";
import { BarChart3, Building2, Crown, Loader2, Lock, Megaphone, Plus, Search, Settings2, Star, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModalShell } from "./ModalShell";
import { UserPicker } from "@/components/teams/UserPicker";
import { useAssignableUsers, useTeams, type AssignableUser, type Team } from "@/hooks/useTeams";
import { useCreateAdReport, useUpdateAdReport } from "@/hooks/useAdReports";
import { useAuthStore } from "@/stores/authStore";
import type { AdExtraMetric, AdReport, AdReportKind } from "@/types/adReport";

const EXTRAS: { key: AdExtraMetric; label: string }[] = [
  { key: "impressions", label: "Impressions" },
  { key: "reach", label: "Reach" },
  { key: "clicks", label: "Link clicks" },
];
const ELEVATED = ["Super Admin", "Admin", "Coordinator"];
const MAX_PEOPLE = 6;
const MAX_TEAMS = 5;

const KINDS: { value: AdReportKind; label: string; hint: string; icon: React.ElementType }[] = [
  { value: "ad", label: "Ad / campaign", hint: "Someone enters its numbers every day", icon: Megaphone },
  { value: "account", label: "Ad account", hint: "Groups ads — adds their numbers up", icon: Building2 },
];

const AVATAR_COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f97316", "#22c55e", "#14b8a6", "#3b82f6"];
const avatarColor = (name: string) => AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length];

interface Props {
  open: boolean;
  onClose: () => void;
  today: string;
  /** Edit this report; omit to create. */
  report?: AdReport | null;
  onCreated?: (id: string) => void;
  /** Every report the page knows — accounts are picked from these. */
  all?: AdReport[];
  /** Create: start as this kind / inside this account ("+ Add ad" on an account). */
  defaultKind?: AdReportKind;
  defaultAccountId?: string | null;
}

export function ReportFormModal({ open, onClose, today, report, onCreated, all = [], defaultKind = "ad", defaultAccountId = null }: Props) {
  const editing = !!report;
  const me = useAuthStore((s) => s.user);
  const isElevated = ELEVATED.includes(me?.role?.role_name ?? "");
  const { data: teams = [] } = useTeams();
  const { data: directory = [] } = useAssignableUsers();
  const create = useCreateAdReport();
  const update = useUpdateAdReport();

  // Teams you may put a report in: the ones you lead (admin roles: all).
  const myTeams = useMemo(() => teams.filter((t) => isElevated || t.my_role === "leader"), [teams, isElevated]);
  const mine = useMemo(() => new Set(myTeams.map((t) => t.id)), [myTeams]);

  const [kind, setKind] = useState<AdReportKind>("ad");
  const [name, setName] = useState("");
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [adRef, setAdRef] = useState("");
  const [assignees, setAssignees] = useState<string[]>([]);
  const [start, setStart] = useState(today);
  const [untilEnded, setUntilEnded] = useState(true);
  const [end, setEnd] = useState("");
  const [extras, setExtras] = useState<AdExtraMetric[]>([]);
  const [due, setDue] = useState("12:00");
  const [escalate, setEscalate] = useState("17:00");
  const [picking, setPicking] = useState(true);
  const [everyone, setEveryone] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const preset = defaultAccountId ? all.find((x) => x.id === defaultAccountId) : null;
    setKind(report?.kind ?? (preset ? "ad" : defaultKind));
    setName(report?.name ?? "");
    setTeamIds(
      report ? (report.team_ids?.length ? report.team_ids : [report.team_id])
        : preset ? (preset.team_ids ?? [preset.team_id]).filter((t) => mine.has(t))
        : myTeams.length === 1 ? [myTeams[0].id] : [],
    );
    setAccountId(report?.account_id ?? preset?.id ?? "");
    setAdRef(report?.ad_account_ref ?? "");
    // A new ad inside an account starts with the account's people.
    setAssignees(report?.assignees.map((a) => a.id) ?? preset?.assignees.map((a) => a.id) ?? []);
    setStart(report?.start_date ?? today);
    setUntilEnded(!report?.end_date);
    setEnd(report?.end_date ?? "");
    setExtras(report?.extra_metrics ?? []);
    setDue(report?.reminder_due ?? "12:00");
    setEscalate(report?.reminder_escalate ?? "17:00");
    setPicking(!report);
    setEveryone(false);
    setTeamsOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, report?.id, defaultAccountId, defaultKind]);

  const isAccount = kind === "account";

  // ── Teams ──
  const teamName = (id: string) =>
    teams.find((t) => t.id === id)?.name ?? report?.teams?.find((t) => t.id === id)?.name ?? "Team";
  const teamColor = (id: string) => teams.find((t) => t.id === id)?.color || "#94a3b8";
  // A leader can't add or remove another team's leader's team…
  const locked = (id: string) => !isElevated && !mine.has(id);
  // …nor remove their own last team (they'd lose the report).
  const ownLeft = teamIds.filter((t) => mine.has(t)).length;
  // (While creating, any chip can go — the form just waits for a team.)
  const removable = (id: string) =>
    !locked(id) && (!editing || (teamIds.length > 1 && (isElevated || ownLeft > 1)));
  const addable = myTeams.filter((t) => !teamIds.includes(t.id));
  const canAddTeam = addable.length > 0 && teamIds.length < MAX_TEAMS;
  // Team first: with none chosen yet the list is simply open.
  const teamPickerOpen = teamsOpen || teamIds.length === 0;
  const removeTeam = (id: string) => setTeamIds((ts) => ts.filter((t) => t !== id));
  const makeMain = (id: string) => setTeamIds((ts) => [id, ...ts.filter((t) => t !== id)]);

  // Accounts an ad may join: open, and sharing one of its teams.
  const accounts = useMemo(
    () => all.filter((x) => x.kind === "account" && x.status !== "ended"
      && (x.team_ids?.length ? x.team_ids : [x.team_id]).some((t) => teamIds.includes(t))),
    [all, teamIds],
  );
  // A team change can leave an account from another team selected.
  useEffect(() => {
    if (accountId && !accounts.some((x) => x.id === accountId)) setAccountId("");
  }, [accounts, accountId]);

  // ── People: the chosen teams' members first (like Add Task) ──
  const memberIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of teams) if (teamIds.includes(t.id)) for (const m of t.members) ids.add(m.user_id);
    return ids;
  }, [teams, teamIds]);
  const pool: AssignableUser[] = useMemo(() => {
    const active = directory.filter((u) => u.status !== "inactive");
    if (everyone) return active;
    const fromDir = active.filter((u) => memberIds.has(u.id));
    // Members missing from the directory still show (the team list has their names).
    const seen = new Set(fromDir.map((u) => u.id));
    const extra: AssignableUser[] = [];
    for (const t of teams) {
      if (!teamIds.includes(t.id)) continue;
      for (const m of t.members) {
        if (seen.has(m.user_id)) continue;
        seen.add(m.user_id);
        extra.push({ id: m.user_id, name: m.name, email: m.email, designation: m.designation, status: "active" });
      }
    }
    return [...fromDir, ...extra].sort((a, b) => a.name.localeCompare(b.name));
  }, [directory, everyone, memberIds, teams, teamIds]);
  const nameOf = (id: string) =>
    directory.find((u) => u.id === id)?.name ?? report?.assignees.find((a) => a.id === id)?.name
    ?? all.flatMap((x) => x.assignees).find((a) => a.id === id)?.name ?? "…";
  const outside = (id: string) => teamIds.length > 0 && memberIds.size > 0 && !memberIds.has(id);
  const togglePerson = (id: string) =>
    setAssignees((a) => (a.includes(id) ? a.filter((x) => x !== id) : a.length >= MAX_PEOPLE ? a : [...a, id]));
  const makeOwner = (id: string) => setAssignees((a) => [id, ...a.filter((x) => x !== id)]);

  const chooseAccount = (id: string) => {
    setAccountId(id);
    // Nobody picked yet: start with the people who look after that account.
    const acc = all.find((x) => x.id === id);
    if (!editing && acc && assignees.length === 0 && acc.assignees.length) setAssignees(acc.assignees.map((a) => a.id).slice(0, MAX_PEOPLE));
  };

  const endBad = !isAccount && !untilEnded && (!end || end < start);
  const timesBad = !isAccount && (!due || !escalate || escalate <= due);
  const valid = !!name.trim() && teamIds.length > 0 && (isAccount || (assignees.length > 0 && !!start)) && !endBad && !timesBad;
  const busy = create.isPending || update.isPending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    try {
      await save();
      onClose();
    } catch {
      /* the hook already showed the server's message */
    }
  };

  const save = async () => {
    if (editing && report) {
      if (report.kind === "account") {
        await update.mutateAsync({ id: report.id, name: name.trim(), ad_account_ref: adRef.trim(), team_ids: teamIds, assignees });
        return;
      }
      await update.mutateAsync({
        id: report.id, name: name.trim(), team_ids: teamIds, assignees, extra_metrics: extras,
        reminder_due: due, reminder_escalate: escalate,
        ...(untilEnded ? { clear_end_date: true } : { end_date: end }),
        ...(accountId !== (report.account_id ?? "") ? (accountId ? { account_id: accountId } : { clear_account: true }) : {}),
      });
      return;
    }
    const r = isAccount
      ? await create.mutateAsync({ kind: "account", name: name.trim(), team_ids: teamIds, assignees, ad_account_ref: adRef.trim() })
      : await create.mutateAsync({
          kind: "ad", name: name.trim(), team_ids: teamIds, assignees, start_date: start,
          end_date: untilEnded ? null : end, extra_metrics: extras, reminder_due: due, reminder_escalate: escalate,
          account_id: accountId || null,
        });
    onCreated?.(r.id);
  };

  const field = "h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:opacity-60";
  const label = "text-xs font-medium text-muted-foreground";
  const title = editing ? (isAccount ? "Edit ad account" : "Edit ad report") : (isAccount ? "New ad account" : "New ad report");
  const full = assignees.length >= MAX_PEOPLE;

  return (
    <ModalShell open={open} onClose={onClose} onSubmit={submit} title={title}
      icon={editing ? <Settings2 className="size-4" /> : isAccount ? <Building2 className="size-4" /> : <BarChart3 className="size-4" />}>

      {/* What are you tracking? — only when creating */}
      {!editing && (
        <div className="space-y-1.5">
          <span className={label}>What are you tracking?</span>
          <div role="radiogroup" aria-label="What are you tracking?" className="grid grid-cols-2 gap-2">
            {KINDS.map((k) => {
              const on = kind === k.value;
              const Icon = k.icon;
              return (
                <button key={k.value} type="button" role="radio" aria-checked={on} onClick={() => setKind(k.value)}
                  className={cn("flex items-start gap-2.5 rounded-xl border p-3 text-left transition outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                    on ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "hover:bg-muted/50")}>
                  <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg",
                    on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{k.label}</span>
                    <span className="block text-[11px] leading-snug text-muted-foreground">{k.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-1">
        <label className={label} htmlFor="ar-name">{isAccount ? "Account name *" : "Campaign name *"}</label>
        <input id="ar-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)}
          placeholder={isAccount ? "e.g. Delta Institutions — Meta" : "e.g. Delta Admissions — Lead form, Oct"} className={field} autoFocus />
      </div>

      {/* Teams — first, like Add Task. The first chip is the main team. */}
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className={label} id="ar-teams-label">Teams *</span>
          <span className="text-[11px] text-muted-foreground">Meta (Facebook &amp; Instagram)</span>
        </div>
        <div role="group" aria-labelledby="ar-teams-label" className="flex flex-wrap items-center gap-1.5">
          {teamIds.map((id, i) => (
            <span key={id}
              className={cn("group inline-flex h-7 items-center gap-1.5 rounded-full border pl-2.5 pr-1 text-xs font-medium",
                i === 0 ? "border-primary/40 bg-primary/5" : "bg-muted/40")}>
              <span className="size-2 shrink-0 rounded-full" style={{ background: teamColor(id) }} />
              {teamName(id)}
              {i === 0 && teamIds.length > 1 && <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">main</span>}
              {i > 0 && !locked(id) && (
                <button type="button" onClick={() => makeMain(id)} aria-label={`Make ${teamName(id)} the main team`} title="Make main team"
                  className="-my-1 rounded-full p-1 text-muted-foreground opacity-60 transition hover:bg-muted hover:text-amber-500 hover:opacity-100">
                  <Star className="size-3" />
                </button>
              )}
              {locked(id) ? (
                <span title="You don't lead this team — only its leader or an admin can remove it" className="p-0.5 text-muted-foreground">
                  <Lock className="size-3" />
                </span>
              ) : removable(id) ? (
                <button type="button" onClick={() => removeTeam(id)} aria-label={`Remove ${teamName(id)}`}
                  className="-my-1 rounded-full p-1 hover:bg-muted"><X className="size-3" /></button>
              ) : (
                <span title={teamIds.length > 1 ? "Keep at least one of your own teams on it" : "A report needs a team"}
                  className="p-0.5 text-muted-foreground/50"><X className="size-3" /></span>
              )}
            </span>
          ))}
          {canAddTeam && !teamPickerOpen && (
            <button type="button" onClick={() => setTeamsOpen(true)} aria-expanded={false} aria-controls="ar-team-list"
              className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed px-2.5 text-xs font-medium text-muted-foreground transition outline-none hover:border-primary/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30">
              <Plus className="size-3" /> {teamIds.length ? "Add team" : "Choose a team"}
            </button>
          )}
        </div>
        {/* Drawn by the app, not a native <select>: Windows paints a native
            option list white while the dark theme's text stays light. In the
            flow (not a floating menu) so the modal's scroll never clips it. */}
        {canAddTeam && teamPickerOpen && (
          <TeamList id="ar-team-list" teams={addable} onPick={(id) => setTeamIds((ts) => [...ts, id])}
            onDone={teamIds.length ? () => setTeamsOpen(false) : undefined} />
        )}
        <p className="text-[11px] text-muted-foreground">
          {teamIds.length === 0 ? "Pick the team this is for — then choose people from it."
            : teamIds.length > 1 ? "Leaders of every team here can see and manage it. ★ sets the main team."
            : "Add another team to share it with that team's leader."}
        </p>
      </div>

      {isAccount ? (
        <div className="space-y-1">
          <label className={label} htmlFor="ar-ref">Ad account ID <span className="font-normal">— optional, as shown in Ads Manager</span></label>
          <input id="ar-ref" value={adRef} maxLength={60} onChange={(e) => setAdRef(e.target.value)}
            placeholder="e.g. act_1234567890" className={cn(field, "font-mono")} />
        </div>
      ) : (
        <div className="space-y-1">
          <label className={label} htmlFor="ar-account">Account</label>
          <select id="ar-account" value={accountId} onChange={(e) => chooseAccount(e.target.value)} className={field} disabled={!teamIds.length}>
            <option value="">None</option>
            {accounts.map((x) => <option key={x.id} value={x.id}>{x.name}{x.ad_account_ref ? ` · ${x.ad_account_ref}` : ""}</option>)}
          </select>
          <p className="text-[11px] text-muted-foreground">
            {!teamIds.length ? "Choose a team first." : accounts.length ? "Its numbers will also add up in that account." : "These teams have no ad accounts yet — None is fine."}
          </p>
        </div>
      )}

      {/* People */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className={label}>
            {isAccount ? <>Who looks after it <span className="font-normal">— optional</span></> : "Who updates it daily *"}
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground">{assignees.length}/{MAX_PEOPLE}</span>
        </div>

        {assignees.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {assignees.map((id, i) => {
              const n = nameOf(id);
              return (
                <li key={id} className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-1 text-xs font-medium",
                  i === 0 ? "border-amber-500/40 bg-amber-500/5" : "bg-muted/40")}>
                  <span className="flex size-6 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ background: avatarColor(n) }}>
                    {n.charAt(0).toUpperCase()}
                  </span>
                  {n}
                  {i === 0 ? (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                      <Crown className="size-3" /> owner
                    </span>
                  ) : (
                    <button type="button" onClick={() => makeOwner(id)} aria-label={`Make ${n} the owner`} title="Make owner"
                      className="-my-1 rounded-full p-1 text-muted-foreground opacity-60 transition hover:bg-muted hover:text-amber-500 hover:opacity-100">
                      <Crown className="size-3" />
                    </button>
                  )}
                  {outside(id) && <span className="text-[10px] font-normal text-muted-foreground" title="Not a member of the teams above">· other team</span>}
                  <button type="button" aria-label={`Remove ${n}`} onClick={() => setAssignees((a) => a.filter((x) => x !== id))}
                    className="-my-1 rounded-full p-1 hover:bg-muted"><X className="size-3" /></button>
                </li>
              );
            })}
            {!picking && !full && (
              <li>
                <button type="button" onClick={() => setPicking(true)}
                  className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed px-3 text-xs font-medium text-muted-foreground transition hover:border-primary/50 hover:text-foreground">
                  <Plus className="size-3" /> Add people
                </button>
              </li>
            )}
          </ul>
        )}

        {!teamIds.length ? (
          <div className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-3 text-xs text-muted-foreground">
            <Users className="size-4 shrink-0" /> Pick a team first — then choose people from it.
          </div>
        ) : (picking || assignees.length === 0) && !full ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="truncate">{everyone ? "Everyone in the company" : `Members of ${teamIds.map(teamName).join(", ")}`}</span>
              <div className="flex shrink-0 items-center gap-3">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} className="size-3.5 accent-primary" />
                  Show everyone
                </label>
                {assignees.length > 0 && (
                  <button type="button" onClick={() => setPicking(false)} className="font-medium text-primary hover:underline">Done</button>
                )}
              </div>
            </div>
            <UserPicker users={pool} selectedIds={assignees} onToggle={togglePerson}
              placeholder={everyone ? "Search everyone…" : "Search team members…"} maxHeightClass="max-h-44" />
          </div>
        ) : null}

        <p className="text-[11px] leading-snug text-muted-foreground">
          {isAccount
            ? "They see this account and every ad in it, and can update those ads' numbers. Reminders stay with each ad's own people."
            : "The first person is the owner. Everyone here can add the numbers and gets the reminders."}
          {full && " · Six people at most."}
        </p>
      </div>

      {isAccount ? (
        <p className="flex items-start gap-2 rounded-xl border border-blue-500/25 bg-blue-500/5 px-3 py-2.5 text-xs text-muted-foreground">
          <Building2 className="mt-0.5 size-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
          <span>Numbers come from the ads you add to it — nobody types numbers for an account, and it sends no reminders of its own.
            Create its ads with this account selected, or move existing ads in from their Edit.</span>
        </p>
      ) : (
        <>
          {/* Dates */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className={label} htmlFor="ar-start">Start date *</label>
              <input id="ar-start" type="date" value={start} disabled={editing} onChange={(e) => setStart(e.target.value)} className={field} />
            </div>
            <div className="space-y-1">
              <label className={label} htmlFor="ar-end">End date</label>
              <input id="ar-end" type="date" value={untilEnded ? "" : end} min={start} disabled={untilEnded}
                onChange={(e) => setEnd(e.target.value)} className={cn(field, endBad && "border-red-500")} />
              <label className="flex cursor-pointer items-center gap-2 pt-0.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={untilEnded} onChange={(e) => setUntilEnded(e.target.checked)} className="size-3.5 accent-primary" />
                Until I end it
              </label>
            </div>
          </div>

          {/* Metrics */}
          <div className="space-y-1.5">
            <span className={label}>Numbers to track</span>
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Leads (Form)</span> and <span className="font-medium text-foreground">Amount spent</span> always —
              Cost per lead is calculated. Extras:
            </p>
            <div className="flex flex-wrap gap-2">
              {EXTRAS.map((x) => {
                const on = extras.includes(x.key);
                return (
                  <button key={x.key} type="button" aria-pressed={on}
                    onClick={() => setExtras((e) => (on ? e.filter((k) => k !== x.key) : [...e, x.key]))}
                    className={cn("rounded-full border px-3 py-1 text-xs font-medium transition",
                      on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}>
                    {on ? "✓ " : "+ "}{x.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">Impressions add CPM · Link clicks add CPC — and CTR when both are on.</p>
          </div>

          {/* Reminders */}
          <div className="space-y-1.5 rounded-xl border bg-muted/30 p-3">
            <span className={label}>Reminders if a day is missing (working days, IST)</span>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-center justify-between gap-2 text-sm">
                <span className="whitespace-nowrap">To the people</span>
                <input type="time" value={due} onChange={(e) => setDue(e.target.value)} className={cn(field, "w-28")} />
              </label>
              <label className="flex items-center justify-between gap-2 text-sm">
                <span className="whitespace-nowrap">People + leaders</span>
                <input type="time" value={escalate} onChange={(e) => setEscalate(e.target.value)} className={cn(field, "w-28", timesBad && "border-red-500")} />
              </label>
            </div>
            {timesBad && <p className="text-xs text-red-600 dark:text-red-400">The leaders&apos; reminder must come after the first one.</p>}
          </div>
        </>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="h-9 rounded-lg border px-4 text-sm font-medium hover:bg-muted">Cancel</button>
        <button type="submit" disabled={!valid || busy}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {busy && <Loader2 className="size-4 animate-spin" />}
          {editing ? "Save changes" : isAccount ? "Create account" : "Create report"}
        </button>
      </div>
    </ModalShell>
  );
}

/**
 * The teams you can add, as an in-form list (search when there are many).
 * Stays open for a second pick; Escape / Done closes it once a team is chosen.
 */
function TeamList({ id, teams, onPick, onDone }: {
  id: string; teams: Team[]; onPick: (id: string) => void; onDone?: () => void;
}) {
  const [q, setQ] = useState("");
  const shown = teams.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()));
  const searchable = teams.length > 6;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && onDone) { e.stopPropagation(); onDone(); }   // close the list, not the modal
    if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
      e.preventDefault();                                                   // never submits the form
      if (shown[0]) { onPick(shown[0].id); setQ(""); }
    }
  };
  return (
    <div id={id} onKeyDown={onKey} className="overflow-hidden rounded-xl border bg-background/60">
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        {searchable ? (
          <>
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search teams…" aria-label="Search teams"
              autoFocus className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground" />
          </>
        ) : (
          <span className="flex-1 py-1 text-[11px] font-medium text-muted-foreground">{onDone ? "Add a team" : "Choose the team this is for"}</span>
        )}
        {onDone && (
          <button type="button" onClick={onDone} className="shrink-0 text-[11px] font-medium text-primary hover:underline">Done</button>
        )}
      </div>
      <ul role="listbox" aria-label="Teams" className="max-h-44 overflow-y-auto p-1">
        {shown.length === 0 ? (
          <li className="px-3 py-4 text-center text-xs text-muted-foreground">No team matches “{q}”</li>
        ) : shown.map((t) => (
          <li key={t.id} role="option" aria-selected={false}>
            <button type="button" onClick={() => { onPick(t.id); setQ(""); }}
              className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: t.color || "#94a3b8" }} />
              <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{t.member_count ?? t.members.length} people</span>
              <Plus className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
