"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, ClipboardList, Eye, EyeOff, FolderKanban, KeyRound, Loader2, Mail, Palette, QrCode, Shield, Sparkles, User, Star
} from "lucide-react";
import { SavedTasksManager } from "@/components/projects/SavedTasksManager";
import { ProjectsManager } from "@/components/projects/ProjectsManager";
import { Switch } from "@/components/ui/switch";
import { useBranding, useUpdateBranding, useResetBranding } from "@/hooks/useWhitelabel";
import { useEmailSettings, useUpdateEmailSettings, useTestEmail } from "@/hooks/useEmailSettings";
import { useNotificationPrefs, useUpdateNotificationPrefs } from "@/hooks/useNotificationPrefs";
import type { User as UserType } from "@/types/user";
import { useAuthStore } from "@/stores/authStore";
import { useUpdatePassword, useUpdateProfile, use2faStatus, use2faSetup, use2faEnable, use2faDisable } from "@/hooks/useAuth";
import { useAuditLogs } from "@/hooks/useAuditLogs";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { fadeVariants } from "@/lib/animations";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/lib/datetime";

// ── Schemas ───────────────────────────────────────────────────────────────────
const profileSchema = z.object({
  name:  z.string().min(1, "Name is required").max(100),
  email: z.string().email("Invalid email address"),
});

const passwordSchema = z
  .object({
    current_password: z.string().min(1, "Current password is required"),
    new_password:     z.string().min(8, "Must be at least 8 characters"),
    confirm_password: z.string(),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    message: "Passwords do not match",
    path: ["confirm_password"],
  });

type ProfileForm   = z.infer<typeof profileSchema>;
type PasswordForm  = z.infer<typeof passwordSchema>;
type Tab = "profile" | "password" | "plan" | "branding" | "security" | "audit" | "email" | "notifications" | "saved-tasks" | "projects";

// ── Notification-prefs helpers ────────────────────────────────────────────────
type NotifCategory = "employee" | "leader" | "elevated";

interface NotifDef { key: string; label: string; desc: string }

const NOTIF_DEFS: Record<NotifCategory, NotifDef[]> = {
  employee: [
    { key: "task_assigned",     label: "Task Assigned",       desc: "When a new task is assigned to you" },
    { key: "pending_review",    label: "Review Acknowledged", desc: "When your task enters pending review" },
    { key: "task_approved",     label: "Task Approved",       desc: "When your task is approved by a leader" },
    { key: "task_reedit",       label: "Sent for Revision",   desc: "When your task is returned for revision" },
    { key: "due_date_reminder", label: "Due Date Reminder",   desc: "When a task is due the next day" },
    { key: "ad_report_due",     label: "Ad Report Reminder",  desc: "When a day's ad numbers are still missing" },
    { key: "ad_flag_update",    label: "Ad Recreate Update",  desc: "When an ad you flagged is picked up, recreated or declined" },
  ],
  leader: [
    { key: "team_task_assigned", label: "New Team Task",     desc: "When new work is assigned to your team" },
    { key: "pending_review",     label: "Pending Review",    desc: "When a team member submits a task for your review" },
    { key: "task_approved",      label: "Task Approved",     desc: "When a task in your team is approved" },
    { key: "task_reedit",        label: "Sent for Revision", desc: "When a task is returned to a member for revision" },
    { key: "task_started",       label: "Task Started",      desc: "When a team member begins working on a task" },
    { key: "task_break",         label: "Task Paused",       desc: "When a team member takes a break on a task" },
    { key: "ad_report_overdue",  label: "Ad Numbers Missing", desc: "When a member still hasn't entered a day's ad numbers" },
    { key: "ad_flagged",         label: "Ad Not Performing", desc: "When an ad is sent to you to recreate" },
  ],
  elevated: [
    { key: "team_task_assigned", label: "Task Assigned",     desc: "When any task is assigned to a team" },
    { key: "pending_review",     label: "Pending Review",    desc: "When any task is submitted for review" },
    { key: "task_approved",      label: "Task Approved",     desc: "When any task is approved" },
    { key: "task_reedit",        label: "Sent for Revision", desc: "When any task is sent back for revision" },
  ],
};

const ROLE_LABEL: Record<NotifCategory, string> = {
  employee: "Employee",
  leader:   "Team Leader",
  elevated: "Admin / Coordinator / Super Admin",
};

function getNotifCategory(user: UserType | null): NotifCategory {
  if (!user?.role) return "employee";
  if (user.role.is_system_role) return "elevated";
  const n = (user.role.role_name ?? "").toLowerCase();
  if (n.includes("leader") || n.includes("manager") || n.includes("supervisor")) return "leader";
  return "employee";
}

// ── Tab button ────────────────────────────────────────────────────────────────
function TabButton({
  active, onClick, icon: Icon, label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}

// ── Input field ───────────────────────────────────────────────────────────────
function Field({
  label, error, children,
}: {
  label: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground",
        "placeholder:text-muted-foreground outline-none transition",
        "focus:border-ring focus:ring-2 focus:ring-ring/30",
        className
      )}
      {...props}
    />
  );
}

// ── Plan badge colours ────────────────────────────────────────────────────────
const PLAN_STYLES: Record<string, string> = {
  free:       "bg-muted text-muted-foreground",
  starter:    "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  pro:        "bg-primary/10 text-primary",
  enterprise: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

const PLAN_PERKS: Record<string, string[]> = {
  free:       ["5 connectors", "7-day data history", "10 AI queries/mo"],
  starter:    ["10 connectors", "30-day data history", "100 AI queries/mo"],
  pro:        ["Unlimited connectors", "1-year data history", "Unlimited AI queries"],
  enterprise: ["Everything in Pro", "SSO / SAML", "Dedicated support", "Custom SLA"],
};

// ── Profile tab ───────────────────────────────────────────────────────────────
function ProfileTab() {
  const user = useAuthStore((s) => s.user);
  const update = useUpdateProfile();

  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: user?.name ?? "", email: user?.email ?? "" },
  });

  // Keep form in sync if user object updates
  useEffect(() => {
    reset({ name: user?.name ?? "", email: user?.email ?? "" });
  }, [user, reset]);

  return (
    <form onSubmit={handleSubmit((d) => update.mutate(d))} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" error={errors.name?.message}>
          <Input placeholder="Your name" {...register("name")} />
        </Field>
        <Field label="Email address" error={errors.email?.message}>
          <Input type="email" placeholder="you@example.com" {...register("email")} />
        </Field>
      </div>

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={!isDirty || update.isPending}>
          {update.isPending && <Loader2 className="mr-1.5 size-3 animate-spin" />}
          Save changes
        </Button>
      </div>
    </form>
  );
}

// ── Password tab ──────────────────────────────────────────────────────────────
function PasswordTab() {
  const update = useUpdatePassword();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { current_password: "", new_password: "", confirm_password: "" },
  });

  function onSubmit(d: PasswordForm) {
    update.mutate(
      { current_password: d.current_password, new_password: d.new_password },
      { onSuccess: () => reset() }
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <Field label="Current password" error={errors.current_password?.message}>
        <Input type="password" placeholder="••••••••" {...register("current_password")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="New password" error={errors.new_password?.message}>
          <Input type="password" placeholder="••••••••" {...register("new_password")} />
        </Field>
        <Field label="Confirm new password" error={errors.confirm_password?.message}>
          <Input type="password" placeholder="••••••••" {...register("confirm_password")} />
        </Field>
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
        After changing your password you will need to log in again on all devices.
      </div>

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={update.isPending}>
          {update.isPending && <Loader2 className="mr-1.5 size-3 animate-spin" />}
          Change password
        </Button>
      </div>
    </form>
  );
}

// ── Plan tab ──────────────────────────────────────────────────────────────────
function PlanTab() {
  const user  = useAuthStore((s) => s.user);
  const plan  = user?.plan ?? "free";
  const perks = PLAN_PERKS[plan] ?? PLAN_PERKS.free;

  return (
    <div className="space-y-5">
      {/* Current plan card */}
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Current plan
            </p>
            <div className="flex items-center gap-2">
              <p className="text-xl font-bold capitalize text-foreground">{plan}</p>
              <span className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize",
                PLAN_STYLES[plan] ?? PLAN_STYLES.free
              )}>
                Active
              </span>
            </div>
          </div>
          <Sparkles className="size-8 text-primary/40" />
        </div>

        <ul className="space-y-1.5">
          {perks.map((perk) => (
            <li key={perk} className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="size-1.5 shrink-0 rounded-full bg-primary" />
              {perk}
            </li>
          ))}
        </ul>
      </div>

      {/* Upgrade CTA for non-enterprise */}
      {plan !== "enterprise" && (
        <div className="rounded-xl border border-dashed bg-muted/30 p-5 text-center space-y-3">
          <p className="text-sm font-medium text-foreground">
            Need more power?
          </p>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            Upgrade to unlock unlimited connectors, longer data history, and more AI queries.
            Contact your account manager or visit the billing portal.
          </p>
          <Button size="sm" variant="outline" disabled>
            Upgrade plan
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
// ── Branding panel ────────────────────────────────────────────────────────────
function BrandingPanel() {
  const { data: branding } = useBranding();
  const updateBranding = useUpdateBranding();
  const resetBranding  = useResetBranding();

  const [form, setForm] = useState({
    company_name:           "",
    logo_url:               "",
    primary_color:          "#18181b",
    accent_color:           "#facc15",
    footer_text:            "",
    report_title_prefix:    "",
    hide_mediaerp_branding: false,
  });

  // Sync form from server data
  const [synced, setSynced] = useState(false);
  if (branding && !synced) {
    setForm({
      company_name:           branding.company_name ?? "",
      logo_url:               branding.logo_url ?? "",
      primary_color:          branding.primary_color ?? "#18181b",
      accent_color:           branding.accent_color ?? "#facc15",
      footer_text:            branding.footer_text ?? "",
      report_title_prefix:    branding.report_title_prefix ?? "",
      hide_mediaerp_branding: branding.hide_mediaerp_branding ?? false,
    });
    setSynced(true);
  }

  const labelCls = "block text-xs font-medium text-muted-foreground mb-1";
  const inputCls = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <h3 className="font-medium text-sm">White-label Branding</h3>
        <p className="text-xs text-muted-foreground">
          Customise the branding applied to your PDF/Excel exports and email reports. Requires an Enterprise plan for full white-labelling.
        </p>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className={labelCls}>Company Name</label>
            <input className={inputCls} placeholder="Your Company" value={form.company_name}
              onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Logo URL</label>
            <input className={inputCls} placeholder="https://yourco.com/logo.png" value={form.logo_url}
              onChange={(e) => setForm((f) => ({ ...f, logo_url: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>Primary Color</label>
            <div className="flex gap-2">
              <input type="color" className="h-9 w-9 rounded border p-0.5 cursor-pointer" value={form.primary_color}
                onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value }))} />
              <input className={cn(inputCls, "flex-1")} value={form.primary_color}
                onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Accent Color</label>
            <div className="flex gap-2">
              <input type="color" className="h-9 w-9 rounded border p-0.5 cursor-pointer" value={form.accent_color}
                onChange={(e) => setForm((f) => ({ ...f, accent_color: e.target.value }))} />
              <input className={cn(inputCls, "flex-1")} value={form.accent_color}
                onChange={(e) => setForm((f) => ({ ...f, accent_color: e.target.value }))} />
            </div>
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Report Footer Text</label>
            <input className={inputCls} placeholder="Generated by Your Company" value={form.footer_text}
              onChange={(e) => setForm((f) => ({ ...f, footer_text: e.target.value }))} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Report Title Prefix</label>
            <input className={inputCls} placeholder="e.g. 'Confidential —'" value={form.report_title_prefix}
              onChange={(e) => setForm((f) => ({ ...f, report_title_prefix: e.target.value }))} />
          </div>
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <Switch
            checked={form.hide_mediaerp_branding}
            onCheckedChange={(v) => setForm((f) => ({ ...f, hide_mediaerp_branding: v }))}
          />
          <span className="text-sm">Hide "Powered by mediaERP" in exports</span>
        </label>

        {/* Preview */}
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="text-[11px] font-medium text-muted-foreground mb-2">PDF Header Preview</p>
          <div className="flex items-center gap-3 rounded-lg p-3" style={{ background: form.primary_color }}>
            <div className="font-bold text-white text-sm">{form.company_name || "Your Company"}</div>
            <div className="text-white/60 text-xs ml-auto">Campaign Performance Report</div>
          </div>
          <div className="mt-1 rounded-b-lg bg-muted/50 px-3 py-1.5">
            <p className="text-[10px] text-muted-foreground">{form.footer_text || `Generated by ${form.company_name || "Your Company"}`}</p>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <Button size="sm" onClick={() => updateBranding.mutate(form)} disabled={updateBranding.isPending}>
            {updateBranding.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
            Save Branding
          </Button>
          <Button size="sm" variant="outline" onClick={() => { resetBranding.mutate(); setSynced(false); }} disabled={resetBranding.isPending}>
            Reset to Defaults
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Security / 2FA tab ────────────────────────────────────────────────────────
function SecurityTab() {
  const { data: status } = use2faStatus();
  const setup = use2faSetup();
  const enable = use2faEnable();
  const disable = use2faDisable();
  const [setupData, setSetupData] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");

  const isEnabled = status?.two_fa_enabled ?? false;

  function handleSetup() {
    setup.mutate(undefined, { onSuccess: (d) => setSetupData(d) });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-sm text-foreground">Authenticator App (TOTP)</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Use Google Authenticator, Authy, or 1Password to generate login codes.
            </p>
          </div>
          <span className={cn(
            "rounded-full px-2.5 py-1 text-xs font-semibold",
            isEnabled ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"
          )}>
            {isEnabled ? "Enabled" : "Disabled"}
          </span>
        </div>

        {!isEnabled && !setupData && (
          <Button size="sm" onClick={handleSetup} disabled={setup.isPending}>
            {setup.isPending && <Loader2 className="mr-1.5 size-3 animate-spin" />}
            Set up 2FA
          </Button>
        )}

        {setupData && !isEnabled && (
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/40 border p-4 space-y-3">
              <p className="text-xs font-medium text-foreground">1. Scan this QR code with your authenticator app:</p>
              <div className="flex items-center justify-center">
                <div className="rounded-lg border bg-white p-3">
                  <QrCode className="size-24 text-foreground" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-center">Or enter this secret manually:</p>
              <code className="block rounded-md bg-muted px-3 py-2 text-xs font-mono text-center break-all">
                {setupData.secret}
              </code>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-foreground">2. Enter the 6-digit code from your app:</p>
              <div className="flex gap-2">
                <Input
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  maxLength={6}
                  className="w-36 font-mono text-center tracking-widest"
                />
                <Button
                  size="sm"
                  onClick={() => enable.mutate(code, { onSuccess: () => { setSetupData(null); setCode(""); } })}
                  disabled={code.length !== 6 || enable.isPending}
                >
                  {enable.isPending && <Loader2 className="mr-1.5 size-3 animate-spin" />}
                  Verify & Enable
                </Button>
              </div>
            </div>
          </div>
        )}

        {isEnabled && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Enter your current authenticator code to disable 2FA:</p>
            <div className="flex gap-2">
              <Input
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
                className="w-36 font-mono text-center tracking-widest"
              />
              <Button
                size="sm"
                variant="destructive"
                onClick={() => disable.mutate(code, { onSuccess: () => setCode("") })}
                disabled={code.length !== 6 || disable.isPending}
              >
                {disable.isPending && <Loader2 className="mr-1.5 size-3 animate-spin" />}
                Disable 2FA
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-muted/30 border-dashed p-4 text-xs text-muted-foreground">
        <Shield className="size-4 mb-1.5 text-primary/60" />
        When 2FA is enabled, you&apos;ll need your authenticator app in addition to your password when logging in.
      </div>
    </div>
  );
}

// ── Audit Logs tab ────────────────────────────────────────────────────────────
function AuditTab() {
  const { data, isLoading } = useAuditLogs({ limit: 50 });
  const logs = data?.logs ?? [];

  const ACTION_COLORS: Record<string, string> = {
    login:             "bg-blue-500/10 text-blue-600",
    "connector.create": "bg-emerald-500/10 text-emerald-600",
    "connector.delete": "bg-red-500/10 text-red-600",
    "profile.update":  "bg-amber-500/10 text-amber-600",
  };

  function fmt(iso: string) {
    return fmtDateTime(iso, { dateStyle: "short", timeStyle: "short" });
  }

  if (isLoading) return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  );

  if (!logs.length) return (
    <div className="rounded-xl border border-dashed bg-muted/20 px-6 py-12 text-center">
      <ClipboardList className="size-8 mx-auto mb-3 text-muted-foreground/40" />
      <p className="text-sm font-medium text-foreground">No audit events yet</p>
      <p className="text-xs text-muted-foreground mt-1">Events are recorded as you use the platform.</p>
    </div>
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Showing the last {logs.length} events for your account.</p>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              <th className="px-4 py-3 text-left">Action</th>
              <th className="px-4 py-3 text-left">Resource</th>
              <th className="px-4 py-3 text-left">Time</th>
              <th className="px-4 py-3 text-left">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {logs.map((log) => (
              <tr key={log.id} className="hover:bg-muted/20 transition-colors">
                <td className="px-4 py-2.5">
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    ACTION_COLORS[log.action] ?? "bg-muted text-muted-foreground"
                  )}>
                    {log.action}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{log.resource_type}{log.resource_id ? ` · ${log.resource_id}` : ""}</td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs whitespace-nowrap">{fmt(log.created_at)}</td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs font-mono">{log.ip_address ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Notifications tab — all users ────────────────────────────────────────────
function NotificationsTab() {
  const user     = useAuthStore((s) => s.user);
  const { data, isLoading } = useNotificationPrefs();
  const update   = useUpdateNotificationPrefs();

  const category = getNotifCategory(user);
  const defs     = NOTIF_DEFS[category];

  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailTypes,   setEmailTypes]   = useState<Record<string, boolean>>({});
  const [synced,       setSynced]       = useState(false);

  if (data && !synced) {
    setEmailEnabled(data.email_enabled ?? false);
    setEmailTypes(data.email_types ?? {});
    setSynced(true);
  }

  function getType(key: string): boolean {
    return key in emailTypes ? emailTypes[key] : true;
  }
  function toggleType(key: string) {
    setEmailTypes((t) => ({ ...t, [key]: !getType(key) }));
  }
  function save() {
    update.mutate({ email_enabled: emailEnabled, email_types: emailTypes });
  }

  if (isLoading) return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Master switch */}
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-medium text-sm">Email Notifications</p>
            <p className="text-xs text-muted-foreground mt-1">
              Receive email alerts for important updates. Turn off to stop all notification emails.
            </p>
          </div>
          <Switch checked={emailEnabled} onCheckedChange={setEmailEnabled} />
        </div>
      </div>

      {/* Role context badge */}
      <div className="flex items-center gap-2 px-1">
        <Bell className="size-3.5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          Customised for&nbsp;
          <span className="font-medium text-foreground">{ROLE_LABEL[category]}</span>
        </p>
      </div>

      {/* Per-type toggles */}
      <div className={cn(
        "rounded-xl border bg-card p-5 transition-opacity duration-200",
        !emailEnabled && "opacity-40 pointer-events-none select-none"
      )}>
        <div className="mb-4">
          <p className="font-medium text-sm">Notification Types</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Choose which events trigger an email.
          </p>
        </div>

        <div className="space-y-0">
          {defs.map((def, i) => (
            <div
              key={def.key}
              className={cn(
                "flex items-center justify-between gap-4 py-3",
                i < defs.length - 1 && "border-b border-border/60"
              )}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{def.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{def.desc}</p>
              </div>
              <Switch checked={getType(def.key)} onCheckedChange={() => toggleType(def.key)} />
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={update.isPending}>
          {update.isPending && <Loader2 className="size-3 mr-1.5 animate-spin" />}
          Save Preferences
        </Button>
      </div>
    </div>
  );
}

// ── Email (SMTP) tab — Super Admin only ───────────────────────────────────────
function EmailTab() {
  const { data, isLoading } = useEmailSettings();
  const update    = useUpdateEmailSettings();
  const testEmail = useTestEmail();

  const [form, setForm] = useState({
    host: "", port: 587, username: "", password: "",
    from_email: "", from_name: "mediaERP", use_tls: true,
  });
  const [showPw,  setShowPw]  = useState(false);
  const [testTo,  setTestTo]  = useState("");
  const [synced,  setSynced]  = useState(false);

  if (data && !synced) {
    setForm({
      host:       data.host ?? "",
      port:       data.port ?? 587,
      username:   data.username ?? "",
      password:   data.password ?? "",
      from_email: data.from_email ?? "",
      from_name:  data.from_name ?? "mediaERP",
      use_tls:    data.use_tls ?? true,
    });
    setSynced(true);
  }

  const labelCls = "block text-xs font-medium text-muted-foreground mb-1";
  const inputCls = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary";

  if (isLoading) return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  );

  return (
    <div className="space-y-5">
      {/* SMTP config card */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div>
          <h3 className="font-medium text-sm">SMTP Configuration</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure the outgoing mail server used for all email notifications.
          </p>
        </div>

        {data?.configured && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-emerald-500 shrink-0" />
            Email is configured and active.
          </div>
        )}
        {!data?.configured && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            No email settings saved yet. Fill in the form and click Save.
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 sm:col-span-1">
            <label className={labelCls}>SMTP Host</label>
            <input className={inputCls} placeholder="smtp.gmail.com" value={form.host}
              onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>Port</label>
            <input type="number" className={inputCls} placeholder="587" value={form.port}
              onChange={(e) => setForm((f) => ({ ...f, port: Number(e.target.value) }))} />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={labelCls}>Username</label>
            <input className={inputCls} placeholder="you@gmail.com" value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={labelCls}>Password / App Password</label>
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                className={cn(inputCls, "pr-9")}
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
              <button type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPw((v) => !v)}>
                {showPw ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={labelCls}>From Email</label>
            <input className={inputCls} placeholder="noreply@yourcompany.com" value={form.from_email}
              onChange={(e) => setForm((f) => ({ ...f, from_email: e.target.value }))} />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={labelCls}>From Name</label>
            <input className={inputCls} placeholder="mediaERP" value={form.from_name}
              onChange={(e) => setForm((f) => ({ ...f, from_name: e.target.value }))} />
          </div>
        </div>

        <label className="flex items-center gap-3 cursor-pointer select-none">
          <Switch
            checked={form.use_tls}
            onCheckedChange={(v) => setForm((f) => ({ ...f, use_tls: v }))}
          />
          <span className="text-sm">Use TLS / STARTTLS</span>
        </label>

        <Button size="sm" onClick={() => update.mutate(form)} disabled={update.isPending}>
          {update.isPending && <Loader2 className="size-3 mr-1.5 animate-spin" />}
          Save Settings
        </Button>
      </div>

      {/* Test email card */}
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <div>
          <h3 className="font-medium text-sm">Send Test Email</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Verify your SMTP settings by sending a test message.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            type="email"
            className={cn(inputCls, "flex-1")}
            placeholder="recipient@example.com"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
          />
          <Button size="sm" variant="outline"
            onClick={() => testEmail.mutate(testTo || undefined)}
            disabled={testEmail.isPending}>
            {testEmail.isPending && <Loader2 className="size-3 mr-1.5 animate-spin" />}
            Send Test
          </Button>
        </div>
      </div>
    </div>
  );
}

const TABS: { id: Tab; label: string; icon: React.ElementType; superAdminOnly?: boolean; elevatedOnly?: boolean }[] = [
  { id: "profile",       label: "Profile",       icon: User },
  { id: "password",      label: "Password",      icon: KeyRound },
  { id: "plan",          label: "Plan",          icon: Sparkles },
  { id: "branding",      label: "Branding",      icon: Palette },
  { id: "security",      label: "Security",      icon: Shield },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "saved-tasks",   label: "Saved tasks",   icon: Star, elevatedOnly: true },
  { id: "projects",      label: "Projects",      icon: FolderKanban, elevatedOnly: true },
  { id: "audit",         label: "Audit Logs",    icon: ClipboardList },
  { id: "email",         label: "Email SMTP",    icon: Mail, superAdminOnly: true },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("profile");
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = !!(user?.role?.is_system_role && user?.role?.role_name === "Super Admin");
  const isElevated = ["Super Admin", "Admin", "Coordinator"].includes(user?.role?.role_name ?? "");
  const visibleTabs = TABS.filter((t) => (!t.superAdminOnly || isSuperAdmin) && (!t.elevatedOnly || isElevated));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        subtitle="Manage your profile, security, and subscription"
      />

      {/* Tab bar */}
      <div className="rounded-xl border bg-muted/40 p-1 w-fit flex flex-wrap gap-0.5">
        {visibleTabs.map((t) => (
          <TabButton
            key={t.id}
            active={tab === t.id}
            onClick={() => setTab(t.id)}
            icon={t.icon}
            label={t.label}
          />
        ))}
      </div>

      {/* Tab panels */}
      <div className="rounded-xl border bg-card p-6 shadow-sm max-w-2xl">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            variants={fadeVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {tab === "profile"  && <ProfileTab />}
            {tab === "password" && <PasswordTab />}
            {tab === "plan"     && <PlanTab />}
            {tab === "branding" && <BrandingPanel />}
            {tab === "security" && <SecurityTab />}
            {tab === "audit"         && <AuditTab />}
            {tab === "notifications" && <NotificationsTab />}
            {tab === "email"         && <EmailTab />}
            {tab === "saved-tasks"   && <SavedTasksManager teamId={null} />}
            {tab === "projects"      && <ProjectsManager />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
