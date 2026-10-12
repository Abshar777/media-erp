"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar,
  Clock,
  Loader2,
  Mail,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SelectField } from "@/components/ui/select-field";
import { cn } from "@/lib/utils";
import { fmtDateTimeIST } from "@/lib/datetime";
import {
  useEmailSchedules,
  useCreateEmailSchedule,
  useUpdateEmailSchedule,
  useDeleteEmailSchedule,
  useSendNow,
  useSendTestEmail,
  EmailSchedule,
  EmailScheduleCreate,
  PLATFORMS,
  DOW_LABELS,
} from "@/hooks/useEmailReports";

// ── Create / Edit Modal ───────────────────────────────────────────────────────

function ScheduleModal({ onClose, initial }: { onClose: () => void; initial?: EmailSchedule }) {
  const createSchedule = useCreateEmailSchedule();
  const updateSchedule = useUpdateEmailSchedule();
  const isPending = createSchedule.isPending || updateSchedule.isPending;

  const [form, setForm] = useState<EmailScheduleCreate>({
    name:            initial?.name ?? "",
    frequency:       initial?.frequency ?? "weekly",
    day_of_week:     initial?.day_of_week ?? 0,
    day_of_month:    initial?.day_of_month ?? 1,
    send_time:       initial?.send_time ?? "09:00",
    recipients:      initial?.recipients ?? [],
    platforms:       initial?.platforms ?? [],
    date_range_days: initial?.date_range_days ?? 7,
    enabled:         initial?.enabled ?? true,
  });

  const [emailInput, setEmailInput] = useState("");

  function addEmail() {
    const e = emailInput.trim();
    if (e && !form.recipients.includes(e)) {
      setForm((f) => ({ ...f, recipients: [...f.recipients, e] }));
      setEmailInput("");
    }
  }

  function removeEmail(e: string) {
    setForm((f) => ({ ...f, recipients: f.recipients.filter((x) => x !== e) }));
  }

  function togglePlatform(p: string) {
    setForm((f) => ({
      ...f,
      platforms: f.platforms?.includes(p)
        ? f.platforms.filter((x) => x !== p)
        : [...(f.platforms ?? []), p],
    }));
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    const payload = { ...form };
    // Remove irrelevant fields per frequency
    if (form.frequency !== "weekly") delete payload.day_of_week;
    if (form.frequency !== "monthly") delete payload.day_of_month;
    if (initial) {
      await updateSchedule.mutateAsync({ id: initial.id, ...payload });
    } else {
      await createSchedule.mutateAsync(payload);
    }
    onClose();
  }

  const labelCls = "block text-xs font-medium text-muted-foreground mb-1";
  const inputCls =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary transition-colors";

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        className="relative z-10 w-full max-w-lg rounded-2xl bg-card border border-border shadow-2xl overflow-hidden"
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
      >
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-semibold text-base">
            {initial ? "Edit Schedule" : "Create Email Schedule"}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-muted transition-colors">
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Name */}
          <div>
            <label className={labelCls}>Report Name *</label>
            <input
              className={inputCls}
              placeholder="e.g. Weekly Performance Summary"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>

          {/* Frequency */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="email-frequency" className={labelCls}>Frequency</label>
              <SelectField<EmailScheduleCreate["frequency"]>
                id="email-frequency"
                className="rounded-md"
                value={form.frequency}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, frequency: v }))
                }
                options={[
                  { value: "daily", label: "Daily" },
                  { value: "weekly", label: "Weekly" },
                  { value: "monthly", label: "Monthly" },
                ]}
              />
            </div>
            <div>
              <label className={labelCls}>Send Time (UTC)</label>
              <input
                type="time"
                className={inputCls}
                value={form.send_time}
                onChange={(e) => setForm((f) => ({ ...f, send_time: e.target.value }))}
              />
            </div>
          </div>

          {/* Day of week */}
          {form.frequency === "weekly" && (
            <div>
              <label htmlFor="email-day-of-week" className={labelCls}>Day of Week</label>
              <SelectField<number>
                id="email-day-of-week"
                className="rounded-md"
                value={form.day_of_week ?? 0}
                onValueChange={(v) => setForm((f) => ({ ...f, day_of_week: v }))}
                options={DOW_LABELS.map((d, i) => ({ value: i, label: d }))}
              />
            </div>
          )}

          {/* Day of month */}
          {form.frequency === "monthly" && (
            <div>
              <label className={labelCls}>Day of Month</label>
              <input
                type="number"
                min={1}
                max={28}
                className={inputCls}
                value={form.day_of_month ?? 1}
                onChange={(e) => setForm((f) => ({ ...f, day_of_month: parseInt(e.target.value) }))}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">Use 1–28 to avoid issues with short months.</p>
            </div>
          )}

          {/* Date range */}
          <div>
            <label htmlFor="email-date-range" className={labelCls}>Data window (days of history to include)</label>
            <SelectField<number>
              id="email-date-range"
              className="rounded-md"
              value={form.date_range_days}
              onValueChange={(v) => setForm((f) => ({ ...f, date_range_days: v }))}
              options={[
                { value: 1, label: "Last 1 day" },
                { value: 7, label: "Last 7 days" },
                { value: 14, label: "Last 14 days" },
                { value: 30, label: "Last 30 days" },
                { value: 90, label: "Last 90 days" },
              ]}
            />
          </div>

          {/* Recipients */}
          <div>
            <label className={labelCls}>Recipients *</label>
            <div className="flex gap-2">
              <input
                type="email"
                className={cn(inputCls, "flex-1")}
                placeholder="email@example.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addEmail())}
              />
              <Button type="button" size="sm" variant="outline" onClick={addEmail}>Add</Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {form.recipients.map((em) => (
                <span key={em} className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs">
                  {em}
                  <button type="button" onClick={() => removeEmail(em)}>
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Platforms filter */}
          <div>
            <label className={labelCls}>Platforms (leave empty for all)</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {PLATFORMS.map((p) => {
                const active = form.platforms?.includes(p.value);
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => togglePlatform(p.value)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-border text-muted-foreground hover:border-primary/50"
                    )}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Enabled */}
          <label className="flex items-center gap-3 cursor-pointer">
            <Switch
              checked={form.enabled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
            />
            <span className="text-sm">Schedule enabled</span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending || form.recipients.length === 0}>
              {isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              {initial ? "Save Changes" : "Create Schedule"}
            </Button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ── Schedule Card ─────────────────────────────────────────────────────────────

function ScheduleCard({ schedule }: { schedule: EmailSchedule }) {
  const sendNow = useSendNow();
  const deleteSchedule = useDeleteEmailSchedule();
  const updateSchedule = useUpdateEmailSchedule();
  const [editing, setEditing] = useState(false);

  const freqLabel: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };
  const dayLabel =
    schedule.frequency === "weekly"
      ? DOW_LABELS[schedule.day_of_week ?? 0]
      : schedule.frequency === "monthly"
      ? `Day ${schedule.day_of_month ?? 1}`
      : "Every day";

  return (
    <>
      <AnimatePresence>{editing && <ScheduleModal onClose={() => setEditing(false)} initial={schedule} />}</AnimatePresence>
      <motion.div
        layout
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        className={cn(
          "rounded-xl border bg-card p-4 hover:shadow-sm transition-shadow",
          !schedule.enabled && "opacity-60"
        )}
      >
        <div className="flex items-start gap-3">
          <div className={cn(
            "mt-0.5 flex size-8 items-center justify-center rounded-lg shrink-0",
            schedule.enabled ? "bg-blue-500/10 text-blue-600" : "bg-muted text-muted-foreground"
          )}>
            <Mail className="size-4" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{schedule.name}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                {freqLabel[schedule.frequency]}
              </span>
              {!schedule.enabled && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Disabled</span>
              )}
            </div>

            <p className="mt-0.5 text-xs text-muted-foreground">
              {dayLabel} at {schedule.send_time} UTC · Last {schedule.date_range_days} days · {schedule.recipients.length} recipient{schedule.recipients.length !== 1 ? "s" : ""}
            </p>

            <div className="mt-2 flex items-center gap-4 text-[11px] text-muted-foreground">
              {schedule.last_sent_at && (
                <span className="flex items-center gap-1">
                  <Send className="size-3" />
                  Last sent: {fmtDateTimeIST(schedule.last_sent_at)}
                </span>
              )}
              {schedule.next_send_at && (
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  Next: {fmtDateTimeIST(schedule.next_send_at)}
                </span>
              )}
            </div>

            {schedule.platforms.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {schedule.platforms.map((p) => (
                  <span key={p} className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                    {PLATFORMS.find((x) => x.value === p)?.label ?? p}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => sendNow.mutate(schedule.id)}
              disabled={sendNow.isPending}
              title="Send now"
              className="h-7 px-2 text-xs"
            >
              {sendNow.isPending ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
            </Button>
            <button
              onClick={() => updateSchedule.mutate({ id: schedule.id, enabled: !schedule.enabled })}
              className="rounded-lg p-1.5 hover:bg-muted text-muted-foreground transition-colors text-xs"
              title={schedule.enabled ? "Disable" : "Enable"}
            >
              {schedule.enabled ? "Pause" : "Enable"}
            </button>
            <button
              onClick={() => setEditing(true)}
              className="rounded-lg p-1.5 hover:bg-muted text-muted-foreground transition-colors text-xs"
            >
              Edit
            </button>
            <button
              onClick={() => deleteSchedule.mutate(schedule.id)}
              className="rounded-lg p-1.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}

// ── Test Email Panel ──────────────────────────────────────────────────────────

function TestEmailPanel() {
  const sendTest = useSendTestEmail();
  const [email, setEmail] = useState("");

  return (
    <div className="rounded-xl border bg-card p-5">
      <h3 className="font-medium text-sm mb-3">Test Email Configuration</h3>
      <p className="text-xs text-muted-foreground mb-3">
        Send a test email to verify your SMTP settings are correctly configured in your .env file.
      </p>
      <div className="flex gap-2">
        <input
          type="email"
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => sendTest.mutate(email)}
          disabled={!email || sendTest.isPending}
        >
          {sendTest.isPending ? <Loader2 className="size-4 animate-spin" /> : "Send Test"}
        </Button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function EmailReportsPage() {
  const { data: schedules = [], isLoading } = useEmailSchedules();
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6 p-6">
      <AnimatePresence>{creating && <ScheduleModal onClose={() => setCreating(false)} />}</AnimatePresence>

      <PageHeader
        title="Email Reports"
        subtitle="Automatically email performance reports to your team on a recurring schedule."
        action={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4 mr-2" />
            New Schedule
          </Button>
        }
      />

      {/* Test email */}
      <TestEmailPanel />

      {/* Schedules */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">
          Schedules ({schedules.length})
        </h2>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
          </div>
        ) : schedules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border rounded-xl bg-card">
            <Calendar className="size-10 text-muted-foreground mb-3" />
            <p className="text-sm font-medium">No schedules yet</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              Create a schedule to automatically email performance reports to your team.
            </p>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-4 mr-2" />
              Create First Schedule
            </Button>
          </div>
        ) : (
          <AnimatePresence>
            <div className="space-y-3">
              {schedules.map((s) => <ScheduleCard key={s.id} schedule={s} />)}
            </div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
