"use client";

/** "+ New report" (leaders) and "Edit report". One short form. */
import { useEffect, useMemo, useState } from "react";
import { BarChart3, Loader2, Settings2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModalShell } from "./ModalShell";
import { UserPicker } from "@/components/teams/UserPicker";
import { useAssignableUsers, useTeams } from "@/hooks/useTeams";
import { useCreateAdReport, useUpdateAdReport } from "@/hooks/useAdReports";
import { useAuthStore } from "@/stores/authStore";
import type { AdExtraMetric, AdReport } from "@/types/adReport";

const EXTRAS: { key: AdExtraMetric; label: string }[] = [
  { key: "impressions", label: "Impressions" },
  { key: "reach", label: "Reach" },
  { key: "clicks", label: "Link clicks" },
];
const ELEVATED = ["Super Admin", "Admin", "Coordinator"];

interface Props {
  open: boolean;
  onClose: () => void;
  today: string;
  /** Edit this report; omit to create. */
  report?: AdReport | null;
  onCreated?: (id: string) => void;
}

export function ReportFormModal({ open, onClose, today, report, onCreated }: Props) {
  const editing = !!report;
  const me = useAuthStore((s) => s.user);
  const isElevated = ELEVATED.includes(me?.role?.role_name ?? "");
  const { data: teams = [] } = useTeams();
  const { data: directory = [] } = useAssignableUsers();
  const create = useCreateAdReport();
  const update = useUpdateAdReport();

  const myTeams = useMemo(
    () => teams.filter((t) => isElevated || t.my_role === "leader"),
    [teams, isElevated],
  );

  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState("");
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
    setName(report?.name ?? "");
    setTeamId(report?.team_id ?? (myTeams.length === 1 ? myTeams[0].id : ""));
    setAssignees(report?.assignees.map((a) => a.id) ?? []);
    setStart(report?.start_date ?? today);
    setUntilEnded(!report?.end_date);
    setEnd(report?.end_date ?? "");
    setExtras(report?.extra_metrics ?? []);
    setDue(report?.reminder_due ?? "12:00");
    setEscalate(report?.reminder_escalate ?? "17:00");
    setPicking(!report);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, report?.id]);

  const nameOf = (id: string) => directory.find((u) => u.id === id)?.name ?? report?.assignees.find((a) => a.id === id)?.name ?? "…";
  const endBad = !untilEnded && (!end || end < start);
  const timesBad = !due || !escalate || escalate <= due;
  const valid = name.trim() && teamId && assignees.length > 0 && start && !endBad && !timesBad;
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
      await update.mutateAsync({
        id: report.id, name: name.trim(), assignees, extra_metrics: extras,
        reminder_due: due, reminder_escalate: escalate,
        ...(untilEnded ? { clear_end_date: true } : { end_date: end }),
      });
      return;
    }
    const r = await create.mutateAsync({
      name: name.trim(), team_id: teamId, assignees, start_date: start,
      end_date: untilEnded ? null : end, extra_metrics: extras, reminder_due: due, reminder_escalate: escalate,
    });
    onCreated?.(r.id);
  };

  const field = "h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:opacity-60";
  const label = "text-xs font-medium text-muted-foreground";

  return (
    <ModalShell open={open} onClose={onClose} onSubmit={submit}
      title={editing ? "Edit ad report" : "New ad report"}
      icon={editing ? <Settings2 className="size-4" /> : <BarChart3 className="size-4" />}>
      <div className="space-y-1">
        <label className={label} htmlFor="ar-name">Campaign name *</label>
        <input id="ar-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Delta Admissions — Lead form, Oct" className={field} autoFocus />
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

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="h-9 rounded-lg border px-4 text-sm font-medium hover:bg-muted">Cancel</button>
        <button type="submit" disabled={!valid || busy}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {busy && <Loader2 className="size-4 animate-spin" />}
          {editing ? "Save changes" : "Create report"}
        </button>
      </div>
    </ModalShell>
  );
}
