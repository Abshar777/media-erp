"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  Bell,
  ChevronDown,
  Clock,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SelectField } from "@/components/ui/select-field";
import { cn } from "@/lib/utils";
import {
  useRules,
  useCreateRule,
  useUpdateRule,
  useDeleteRule,
  useEvaluateRules,
  useRuleHistory,
  METRICS,
  OPERATORS,
  ACTIONS,
  Rule,
  RuleCreate,
} from "@/hooks/useRules";
import { useConnectors } from "@/hooks/useConnectors";
import { fmtDateTime } from "@/lib/datetime";

// ── Helpers ───────────────────────────────────────────────────────────────────

function operatorLabel(op: string) {
  return OPERATORS.find((o) => o.value === op)?.label ?? op;
}
function metricLabel(m: string) {
  return METRICS.find((x) => x.value === m)?.label ?? m;
}
function actionLabel(a: string) {
  return ACTIONS.find((x) => x.value === a)?.label ?? a;
}

const PLATFORM_LABELS: Record<string, string> = {
  facebook_ads: "Facebook Ads",
  google_ads: "Google Ads",
  instagram_login: "Instagram",
  ga4: "Google Analytics",
  linkedin_ads: "LinkedIn Ads",
  tiktok_ads: "TikTok Ads",
  facebook_pages: "Facebook Pages",
};

// ── Create / Edit Modal ────────────────────────────────────────────────────────

function RuleModal({ onClose, initial }: { onClose: () => void; initial?: Rule }) {
  const { data: connectors = [] } = useConnectors();
  const createRule = useCreateRule();
  const updateRule = useUpdateRule();
  const isPending = createRule.isPending || updateRule.isPending;

  const connected = connectors.filter((c) => c.status === "connected");

  const [form, setForm] = useState<RuleCreate>({
    name:            initial?.name ?? "",
    platform:        initial?.platform ?? connected[0]?.platform ?? "",
    connector_id:    initial?.connector_id ?? connected[0]?.id ?? "",
    campaign_id:     initial?.campaign_id ?? undefined,
    metric:          initial?.metric ?? "spend",
    operator:        initial?.operator ?? "gt",
    threshold:       initial?.threshold ?? 100,
    action:          initial?.action ?? "alert",
    email_recipients: initial?.email_recipients ?? [],
    cooldown_minutes: initial?.cooldown_minutes ?? 60,
    enabled:         initial?.enabled ?? true,
  });

  const [emailInput, setEmailInput] = useState("");

  const selectedConnector = connected.find((c) => c.id === form.connector_id);

  function handleConnectorChange(connectorId: string) {
    const c = connected.find((x) => x.id === connectorId);
    setForm((f) => ({ ...f, connector_id: connectorId, platform: c?.platform ?? "" }));
  }

  function addEmail() {
    const e = emailInput.trim();
    if (e && !form.email_recipients!.includes(e)) {
      setForm((f) => ({ ...f, email_recipients: [...(f.email_recipients ?? []), e] }));
      setEmailInput("");
    }
  }

  function removeEmail(e: string) {
    setForm((f) => ({ ...f, email_recipients: f.email_recipients!.filter((x) => x !== e) }));
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (initial) {
      await updateRule.mutateAsync({ id: initial.id, ...form });
    } else {
      await createRule.mutateAsync(form);
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
          <h2 className="font-semibold text-base">{initial ? "Edit Rule" : "Create Rule"}</h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-muted transition-colors">
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Name */}
          <div>
            <label className={labelCls}>Rule Name *</label>
            <input
              className={inputCls}
              placeholder="e.g. High CPA Alert"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>

          {/* Connector */}
          <div>
            <label htmlFor="rule-connector" className={labelCls}>Connector *</label>
            <SelectField
              id="rule-connector"
              className="rounded-md"
              placeholder="Select connector…"
              value={form.connector_id}
              onValueChange={(v) => handleConnectorChange(v)}
              required
              options={[
                { value: "", label: "Select connector…" },
                ...connected.map((c) => ({
                  value: c.id,
                  label: `${PLATFORM_LABELS[c.platform] ?? c.platform} — ${c.name}`,
                })),
              ]}
            />
          </div>

          {/* Metric + Operator + Threshold */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="rule-metric" className={labelCls}>Metric</label>
              <SelectField
                id="rule-metric"
                className="rounded-md"
                value={form.metric}
                onValueChange={(v) => setForm((f) => ({ ...f, metric: v }))}
                options={METRICS.map((m) => ({ value: m.value, label: m.label }))}
              />
            </div>
            <div>
              <label htmlFor="rule-operator" className={labelCls}>Operator</label>
              <SelectField
                id="rule-operator"
                className="rounded-md"
                value={form.operator}
                onValueChange={(v) => setForm((f) => ({ ...f, operator: v }))}
                options={OPERATORS.map((o) => ({ value: o.value, label: o.label }))}
              />
            </div>
            <div>
              <label className={labelCls}>Threshold</label>
              <input
                type="number"
                step="any"
                className={inputCls}
                value={form.threshold}
                onChange={(e) => setForm((f) => ({ ...f, threshold: parseFloat(e.target.value) || 0 }))}
                required
              />
            </div>
          </div>

          {/* Action */}
          <div>
            <label htmlFor="rule-action" className={labelCls}>Action when triggered</label>
            <SelectField
              id="rule-action"
              className="rounded-md"
              value={form.action}
              onValueChange={(v) => setForm((f) => ({ ...f, action: v }))}
              options={ACTIONS.map((a) => ({ value: a.value, label: a.label }))}
            />
          </div>

          {/* Email recipients (only when action=email) */}
          {form.action === "email" && (
            <div>
              <label className={labelCls}>Email Recipients</label>
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
                {form.email_recipients?.map((em) => (
                  <span key={em} className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs">
                    {em}
                    <button type="button" onClick={() => removeEmail(em)}>
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Cooldown */}
          <div>
            <label className={labelCls}>Cooldown (minutes between re-triggers)</label>
            <input
              type="number"
              min={1}
              className={inputCls}
              value={form.cooldown_minutes}
              onChange={(e) => setForm((f) => ({ ...f, cooldown_minutes: parseInt(e.target.value) || 60 }))}
            />
          </div>

          {/* Enabled */}
          <label className="flex items-center gap-3 cursor-pointer">
            <Switch
              checked={form.enabled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
            />
            <span className="text-sm">Rule enabled</span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              {initial ? "Save Changes" : "Create Rule"}
            </Button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ── Rule Card ─────────────────────────────────────────────────────────────────

function RuleCard({ rule }: { rule: Rule }) {
  const updateRule = useUpdateRule();
  const deleteRule = useDeleteRule();
  const [editing, setEditing] = useState(false);

  const conditionText = `${metricLabel(rule.metric)} ${operatorLabel(rule.operator)} ${rule.threshold}`;

  return (
    <>
      <AnimatePresence>{editing && <RuleModal onClose={() => setEditing(false)} initial={rule} />}</AnimatePresence>
      <motion.div
        layout
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        className={cn(
          "group rounded-xl border bg-card p-4 hover:shadow-sm transition-shadow",
          !rule.enabled && "opacity-60"
        )}
      >
        <div className="flex items-start gap-3">
          <div className={cn(
            "mt-0.5 flex size-8 items-center justify-center rounded-lg shrink-0",
            rule.enabled ? "bg-amber-500/10 text-amber-600" : "bg-muted text-muted-foreground"
          )}>
            <Zap className="size-4" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{rule.name}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                {PLATFORM_LABELS[rule.platform] ?? rule.platform}
              </span>
              {!rule.enabled && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Disabled</span>
              )}
            </div>

            <p className="mt-0.5 text-xs text-muted-foreground">
              When <strong className="text-foreground">{conditionText}</strong> → {actionLabel(rule.action)}
            </p>

            <div className="mt-2 flex items-center gap-4 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Bell className="size-3" />
                {rule.triggered_count} trigger{rule.triggered_count !== 1 ? "s" : ""}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                {rule.cooldown_minutes}m cooldown
              </span>
              {rule.last_triggered_at && (
                <span>Last: {fmtDateTime(rule.last_triggered_at)}</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Toggle enabled */}
            <button
              onClick={() => updateRule.mutate({ id: rule.id, enabled: !rule.enabled })}
              disabled={updateRule.isPending}
              className="rounded-lg p-1.5 hover:bg-muted text-muted-foreground transition-colors"
              title={rule.enabled ? "Disable rule" : "Enable rule"}
            >
              {rule.enabled ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </button>
            <button
              onClick={() => setEditing(true)}
              className="rounded-lg p-1.5 hover:bg-muted text-muted-foreground transition-colors text-xs font-medium"
            >
              Edit
            </button>
            <button
              onClick={() => deleteRule.mutate(rule.id)}
              className="rounded-lg p-1.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
              title="Delete rule"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}

// ── History Panel ─────────────────────────────────────────────────────────────

function HistoryPanel() {
  const { data: history = [], isLoading } = useRuleHistory();

  if (isLoading) return (
    <div className="flex items-center justify-center py-8 text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
    </div>
  );

  if (!history.length) return (
    <p className="py-8 text-center text-sm text-muted-foreground">
      No rule triggers yet. Rules evaluate every 5 minutes.
    </p>
  );

  return (
    <div className="space-y-2">
      {history.map((h) => (
        <div key={h.id} className="flex items-start gap-3 rounded-lg border bg-card px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{h.rule_name}</p>
            <p className="text-xs text-muted-foreground">
              {h.campaign_name} · {metricLabel(h.metric)} {operatorLabel(h.operator)} {h.threshold}
              {" · "}actual: <strong>{h.actual_value}</strong>
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[11px] text-muted-foreground">{fmtDateTime(h.triggered_at)}</p>
            <p className="text-[11px] text-amber-600 capitalize">{h.action_taken.replace("_", " ")}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RulesPage() {
  const { data: rules = [], isLoading } = useRules();
  const evaluateRules = useEvaluateRules();
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<"rules" | "history">("rules");

  const enabledCount = rules.filter((r) => r.enabled).length;

  return (
    <div className="space-y-6 p-6">
      <AnimatePresence>{creating && <RuleModal onClose={() => setCreating(false)} />}</AnimatePresence>

      <PageHeader
        title="Automated Rules"
        subtitle="Monitor campaign metrics and take action when thresholds are crossed."
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => evaluateRules.mutate()}
              disabled={evaluateRules.isPending}
            >
              {evaluateRules.isPending
                ? <Loader2 className="size-4 mr-2 animate-spin" />
                : <RefreshCw className="size-4 mr-2" />
              }
              Evaluate Now
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-4 mr-2" />
              New Rule
            </Button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Rules", value: rules.length, color: "text-foreground" },
          { label: "Active Rules", value: enabledCount, color: "text-emerald-600" },
          { label: "Total Triggers", value: rules.reduce((s, r) => s + r.triggered_count, 0), color: "text-amber-600" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={cn("text-2xl font-semibold mt-1", color)}>{value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        {(["rules", "history"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors capitalize",
              tab === t
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "rules" ? `Rules (${rules.length})` : "Trigger History"}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === "rules" ? (
        isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
          </div>
        ) : rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Zap className="size-10 text-muted-foreground mb-3" />
            <p className="text-sm font-medium">No rules yet</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              Create a rule to automatically monitor your campaigns.
            </p>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-4 mr-2" />
              Create First Rule
            </Button>
          </div>
        ) : (
          <AnimatePresence>
            <div className="space-y-3">
              {rules.map((rule) => <RuleCard key={rule.id} rule={rule} />)}
            </div>
          </AnimatePresence>
        )
      ) : (
        <HistoryPanel />
      )}
    </div>
  );
}
