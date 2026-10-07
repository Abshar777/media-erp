"use client";

/**
 * "+ New report" (leaders) and "Edit". One short form, two kinds:
 *  • Ad / campaign — numbers are entered daily; may belong to an account.
 *  • Ad account   — Meta's top level; its numbers are its ads added up, so it
 *                   has no people, dates, metrics or reminders of its own.
 */
import { useEffect, useMemo, useState } from "react";
import { BarChart3, Building2, Loader2, Megaphone, Settings2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModalShell } from "./ModalShell";
import { UserPicker } from "@/components/teams/UserPicker";
import { useAssignableUsers, useTeams } from "@/hooks/useTeams";
import { useCreateAdReport, useUpdateAdReport } from "@/hooks/useAdReports";
import { useAuthStore } from "@/stores/authStore";
import type { AdExtraMetric, AdReport, AdReportKind } from "@/types/adReport";

const EXTRAS: { key: AdExtraMetric; label: string }[] = [
  { key: "impressions", label: "Impressions" },
  { key: "reach", label: "Reach" },
  { key: "clicks", label: "Link clicks" },
];
const ELEVATED = ["Super Admin", "Admin", "Coordinator"];

const KINDS: { value: AdReportKind; label: string; hint: string; icon: React.ElementType }[] = [
  { value: "ad", label: "Ad / campaign", hint: "Someone enters its numbers every day", icon: Megaphone },
  { value: "account", label: "Ad account", hint: "Groups ads — adds their numbers up", icon: Building2 },
];

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

  const myTeams = useMemo(() => teams.filter((t) => isElevated || t.my_role === "leader"), [teams, isElevated]);

  const [kind, setKind] = useState<AdReportKind>("ad");
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState("");
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

  useEffect(() => {
    if (!open) return;
    const preset = defaultAccountId ? all.find((x) => x.id === defaultAccountId) : null;
    setKind(report?.kind ?? (preset ? "ad" : defaultKind));
    setName(report?.name ?? "");
    setTeamId(report?.team_id ?? preset?.team_id ?? (myTeams.length === 1 ? myTeams[0].id : ""));
    setAccountId(report?.account_id ?? preset?.id ?? "");
    setAdRef(report?.ad_account_ref ?? "");
    setAssignees(report?.assignees.map((a) => a.id) ?? []);
    setStart(report?.start_date ?? today);
    setUntilEnded(!report?.end_date);
    setEnd(report?.end_date ?? "");
    setExtras(report?.extra_metrics ?? []);
    setDue(report?.reminder_due ?? "12:00");
    setEscalate(report?.reminder_escalate ?? "17:00");
    setPicking(!report);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, report?.id, defaultAccountId, defaultKind]);

  // Accounts an ad may join: same team, still open.
  const accounts = useMemo(
    () => all.filter((x) => x.kind === "account" && x.team_id === teamId && x.status !== "ended"),
    [all, teamId],
  );
  // A team change can leave an account from the other team selected.
  useEffect(() => {
    if (accountId && !accounts.some((x) => x.id === accountId)) setAccountId("");
  }, [accounts, accountId]);

  const isAccount = kind === "account";
  const nameOf = (id: string) => directory.find((u) => u.id === id)?.name ?? report?.assignees.find((a) => a.id === id)?.name ?? "…";
  const endBad = !isAccount && !untilEnded && (!end || end < start);
  const timesBad = !isAccount && (!due || !escalate || escalate <= due);
  const valid = !!name.trim() && !!teamId && (isAccount || (assignees.length > 0 && !!start)) && !endBad && !timesBad;
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
        await update.mutateAsync({ id: report.id, name: name.trim(), ad_account_ref: adRef.trim() });
        return;
      }
      await update.mutateAsync({
        id: report.id, name: name.trim(), assignees, extra_metrics: extras,
        reminder_due: due, reminder_escalate: escalate,
        ...(untilEnded ? { clear_end_date: true } : { end_date: end }),
        ...(accountId !== (report.account_id ?? "") ? (accountId ? { account_id: accountId } : { clear_account: true }) : {}),
      });
      return;
    }
    const r = isAccount
      ? await create.mutateAsync({ kind: "account", name: name.trim(), team_id: teamId, ad_account_ref: adRef.trim() })
      : await create.mutateAsync({
          kind: "ad", name: name.trim(), team_id: teamId, assignees, start_date: start,
          end_date: untilEnded ? null : end, extra_metrics: extras, reminder_due: due, reminder_escalate: escalate,
          account_id: accountId || null,
        });
    onCreated?.(r.id);
  };

  const field = "h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:opacity-60";
  const label = "text-xs font-medium text-muted-foreground";
  const title = editing ? (isAccount ? "Edit ad account" : "Edit ad report") : (isAccount ? "New ad account" : "New ad report");

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

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className={label} htmlFor="ar-team">Team *</label>
          <select id="ar-team" value={teamId} disabled={editing} onChange={(e) => setTeamId(e.target.value)} className={field}>
            <option value="">Select a team…</option>
            {myTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <span className={label}>Platform</span>
          <div className={cn(field, "flex items-center gap-2 bg-muted/40 text-muted-foreground")}>Meta (Facebook &amp; Instagram)</div>
        </div>
      </div>

      {isAccount ? (
        <>
          <div className="space-y-1">
            <label className={label} htmlFor="ar-ref">Ad account ID <span className="font-normal">— optional, as shown in Ads Manager</span></label>
            <input id="ar-ref" value={adRef} maxLength={60} onChange={(e) => setAdRef(e.target.value)}
              placeholder="e.g. act_1234567890" className={cn(field, "font-mono")} />
          </div>
          <p className="flex items-start gap-2 rounded-xl border border-blue-500/25 bg-blue-500/5 px-3 py-2.5 text-xs text-muted-foreground">
            <Building2 className="mt-0.5 size-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
            <span>Numbers come from the ads you add to it — nobody types numbers for an account, and it sends no reminders of its own.
              Create its ads with this account selected, or move existing ads in from their Edit.</span>
          </p>
        </>
      ) : (
        <>
          {/* Account */}
          <div className="space-y-1">
            <label className={label} htmlFor="ar-account">Account</label>
            <select id="ar-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className={field} disabled={!teamId}>
              <option value="">None</option>
              {accounts.map((x) => <option key={x.id} value={x.id}>{x.name}{x.ad_account_ref ? ` · ${x.ad_account_ref}` : ""}</option>)}
            </select>
            <p className="text-[11px] text-muted-foreground">
              {!teamId ? "Choose a team first." : accounts.length ? "Its numbers will also add up in that account." : "This team has no ad accounts yet — None is fine."}
            </p>
          </div>

          {/* People */}
          <div className="space-y-1.5">
            <span className={label}>Who updates it daily * <span className="font-normal">— one person, plus an optional backup</span></span>
            {assignees.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {assignees.map((id, i) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pl-2.5 pr-1 text-xs font-medium">
                    {nameOf(id)}<span className="text-muted-foreground">{i === 0 ? " · owner" : " · backup"}</span>
                    <button type="button" aria-label={`Remove ${nameOf(id)}`} onClick={() => setAssignees((a) => a.filter((x) => x !== id))}
                      className="rounded-full p-0.5 hover:bg-muted"><X className="size-3" /></button>
                  </span>
                ))}
                {assignees.length < 2 && !picking && (
                  <button type="button" onClick={() => setPicking(true)} className="text-xs font-medium text-primary hover:underline">+ Add backup</button>
                )}
              </div>
            )}
            {picking && assignees.length < 2 && (
              <UserPicker
                users={directory}
                selectedIds={assignees}
                onToggle={(id) => {
                  setAssignees((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id].slice(0, 2)));
                  setPicking(false);
                }}
                placeholder="Search people…"
                maxHeightClass="max-h-40"
              />
            )}
          </div>

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
                <span className="whitespace-nowrap">To the person</span>
                <input type="time" value={due} onChange={(e) => setDue(e.target.value)} className={cn(field, "w-28")} />
              </label>
              <label className="flex items-center justify-between gap-2 text-sm">
                <span className="whitespace-nowrap">Person + leader</span>
                <input type="time" value={escalate} onChange={(e) => setEscalate(e.target.value)} className={cn(field, "w-28", timesBad && "border-red-500")} />
              </label>
            </div>
            {timesBad && <p className="text-xs text-red-600 dark:text-red-400">The leader&apos;s reminder must come after the first one.</p>}
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
