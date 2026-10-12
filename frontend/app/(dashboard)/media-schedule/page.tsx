"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
  Loader2,
  User,
  Users,
  Flag,
  CheckCircle2,
  Check,
  ChevronDown,
  Video,
  Camera,
  ClipboardList,
  Link as LinkIcon,
  MapPin,
  Clock,
} from "lucide-react";
import {
  useMediaTasks,
  useCreateMediaTask,
  useUpdateMediaTask,
  useCancelMediaTask,
  type MediaTask,
} from "@/hooks/useMediaSchedule";
import { useTeams } from "@/hooks/useTeams";
import { useUsersList } from "@/hooks/useUsers";
import { useTasks } from "@/hooks/useProjects";
import { useAuthStore } from "@/stores/authStore";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SelectField } from "@/components/ui/select-field";
import { fmtDate as fmtDateIST } from "@/lib/datetime";

// ─── constants ────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const DAY_HEADERS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const PRIORITY_DOT: Record<string, string> = {
  low:    "bg-blue-400",
  medium: "bg-amber-400",
  high:   "bg-red-500",
};

const STATUS_BADGE: Record<string, string> = {
  scheduled: "bg-blue-500/10    text-blue-600  dark:text-blue-400  border-blue-500/30",
  active:    "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  completed: "bg-muted          text-muted-foreground border-border",
  cancelled: "bg-red-500/10    text-red-600   dark:text-red-400   border-red-500/30",
};

// ─── types ────────────────────────────────────────────────────────────────────

interface Meeting {
  id: string;
  meet_name: string;
  description: string;
  team_ids: string[];
  member_ids: string[];
  meet_link: string;
  schedule_date: string;
  schedule_time: string;
  created_at: string;
}

interface Shooting {
  id: string;
  shoot_name: string;
  description: string;
  location: string;
  team_id: string;
  member_ids: string[];
  schedule_date: string;
  schedule_time: string;
  equipment: string;
  dependencies: string;
  created_at: string;
}

type ModalType = "task" | "meeting" | "shooting" | null;

// ─── helpers ──────────────────────────────────────────────────────────────────

function pad2(n: number) { return String(n).padStart(2, "0"); }

function toDateStr(year: number, month: number, day: number) {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

function parseDate(iso: string) {
  return iso.slice(0, 10);
}

function fmtDate(iso: string) {
  return fmtDateIST(iso, { dateStyle: "medium" });
}

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function loadLS<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
}

function saveLS<T>(key: string, data: T[]) {
  localStorage.setItem(key, JSON.stringify(data));
}

const INPUT_CLS =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
const LABEL_CLS = "block text-xs font-medium text-muted-foreground mb-1";

// ─── Multi-select picker (generic) ───────────────────────────────────────────

interface PickerItem { id: string; label: string; sub?: string }

function MultiPicker({
  items,
  selected,
  onChange,
  placeholder = "Select…",
  disabled,
}: {
  items: PickerItem[];
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  const label =
    selected.length === 0 ? placeholder
    : selected.length === 1
      ? items.find((i) => i.id === selected[0])?.label ?? "1 selected"
    : `${selected.length} selected`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          INPUT_CLS,
          "flex items-center justify-between gap-2 cursor-pointer text-left",
          disabled && "opacity-50 cursor-not-allowed",
          selected.length > 0 && "border-primary/60"
        )}
      >
        <span className={cn("truncate", selected.length === 0 && "text-muted-foreground")}>
          {label}
        </span>
        <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute z-50 mt-1 w-full rounded-lg border bg-card shadow-lg overflow-hidden"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
              <span className="text-[11px] font-medium text-muted-foreground">
                {selected.length}/{items.length} selected
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={() => onChange(items.map(i => i.id))}
                  className="text-[11px] text-primary hover:underline font-medium">All</button>
                <button type="button" onClick={() => onChange([])}
                  className="text-[11px] text-muted-foreground hover:underline">Clear</button>
              </div>
            </div>
            <div className="max-h-44 overflow-y-auto py-1">
              {items.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground italic">No items available</p>
              )}
              {items.map((item) => {
                const checked = selected.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggle(item.id)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors",
                      checked ? "bg-primary/8 text-foreground" : "hover:bg-muted/60"
                    )}
                  >
                    <span className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                      checked ? "bg-primary border-primary text-primary-foreground" : "border-border"
                    )}>
                      {checked && <Check className="size-3" />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block truncate font-medium">{item.label}</span>
                      {item.sub && <span className="text-[10px] text-muted-foreground truncate">{item.sub}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Legacy MemberPicker (kept for TaskModal compatibility) ───────────────────

interface Member { user_id: string; name: string; designation?: string }

function MemberPicker({
  members, selected, onChange, disabled,
}: {
  members: Member[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <MultiPicker
      items={members.map(m => ({ id: m.user_id, label: m.name, sub: m.designation }))}
      selected={selected}
      onChange={onChange}
      placeholder="Select employees…"
      disabled={disabled}
    />
  );
}

// ─── Modal shell ──────────────────────────────────────────────────────────────

function ModalShell({ title, icon, onClose, children }: {
  title: string;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.18 }}
        className="w-full max-w-lg rounded-xl border bg-card shadow-2xl max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            {icon}
            <h2 className="font-semibold text-sm">{title}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {children}
        </div>
      </motion.div>
    </div>
  );
}

// ─── TaskModal ─────────────────────────────────────────────────────────────────

interface TaskModalProps {
  onClose: () => void;
  teams: ReturnType<typeof useTeams>["data"];
  initial?: MediaTask | null;
}

function TaskModal({ onClose, teams = [], initial }: TaskModalProps) {
  const create  = useCreateMediaTask();
  const update  = useUpdateMediaTask();
  const loading = create.isPending || update.isPending;

  const [form, setForm] = useState({
    title:       initial?.title       ?? "",
    description: initial?.description ?? "",
    team_id:     initial?.team_id     ?? "",
    assigned_to: initial?.assigned_to ?? "",
    start_date:  initial ? parseDate(initial.start_date) : "",
    due_date:    initial ? parseDate(initial.due_date)   : "",
    priority:    initial?.priority    ?? "medium" as "low" | "medium" | "high",
  });

  const teamObj = teams.find((t) => t.id === form.team_id);
  const members: Member[] = ((teamObj as any)?.members ?? []).map((m: any) => ({
    user_id:     m.user_id,
    name:        m.name ?? "",
    designation: m.designation ?? "",
  }));

  const canSubmit =
    !!form.title.trim() && !!form.team_id &&
    !!form.assigned_to && !!form.start_date && !!form.due_date;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    if (initial) {
      await update.mutateAsync({
        id: initial.id, title: form.title, description: form.description,
        team_id: form.team_id, assigned_to: form.assigned_to,
        start_date: form.start_date, due_date: form.due_date, priority: form.priority,
      });
    } else {
      await create.mutateAsync({
        title: form.title, description: form.description || undefined,
        team_id: form.team_id, assigned_to: form.assigned_to,
        start_date: form.start_date, due_date: form.due_date, priority: form.priority,
      });
    }
    onClose();
  }

  return (
    <ModalShell
      title={initial ? "Edit Task" : "Schedule New Task"}
      icon={<ClipboardList className="size-4 text-primary" />}
      onClose={onClose}
    >
      <form onSubmit={submit} className="p-5 space-y-4">
        <div>
          <label className={LABEL_CLS}>Task Title *</label>
          <input className={INPUT_CLS} placeholder="e.g. Design social media banner"
            value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
        </div>
        <div>
          <label className={LABEL_CLS}>Description</label>
          <textarea className={cn(INPUT_CLS, "resize-none h-20")} placeholder="Optional notes…"
            value={form.description ?? ""} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </div>
        <div>
          <label className={LABEL_CLS} htmlFor="ms-task-team">Team *</label>
          <SelectField id="ms-task-team" value={form.team_id} required
            onValueChange={(v) => setForm((f) => ({ ...f, team_id: v, assigned_to: "" }))}
            placeholder="Select team"
            options={[
              { value: "", label: "Select team" },
              ...teams.map((t) => ({ value: t.id, label: t.name, dot: t.color || "#94a3b8" })),
            ]} />
        </div>
        <div>
          <label className={LABEL_CLS} htmlFor="ms-task-assignee">Assign To *</label>
          <SelectField id="ms-task-assignee" value={form.assigned_to}
            onValueChange={(v) => setForm((f) => ({ ...f, assigned_to: v }))}
            disabled={!form.team_id} required
            placeholder={form.team_id ? "Select employee" : "Select a team first"}
            options={[
              { value: "", label: form.team_id ? "Select employee" : "Select a team first" },
              ...members.map((m) => ({ value: m.user_id, label: m.name, description: m.designation || undefined })),
            ]} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS}>Start Date *</label>
            <input type="date" className={INPUT_CLS} value={form.start_date}
              onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} required />
          </div>
          <div>
            <label className={LABEL_CLS}>Due Date *</label>
            <input type="date" className={INPUT_CLS} value={form.due_date} min={form.start_date}
              onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} required />
          </div>
        </div>
        <div>
          <label className={LABEL_CLS}>Priority</label>
          <div className="flex gap-2">
            {(["low", "medium", "high"] as const).map((p) => (
              <button key={p} type="button" onClick={() => setForm((f) => ({ ...f, priority: p }))}
                className={cn(
                  "flex-1 rounded-lg border py-1.5 text-xs font-medium capitalize transition-colors",
                  form.priority === p
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40"
                )}>{p}</button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={loading || !canSubmit}>
            {loading && <Loader2 className="size-3 mr-1.5 animate-spin" />}
            {initial ? "Save Changes" : "Schedule Task"}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── MeetingModal ──────────────────────────────────────────────────────────────

function MeetingModal({ onClose, teams = [], onSave }: {
  onClose: () => void;
  teams: ReturnType<typeof useTeams>["data"];
  onSave: (m: Meeting) => void;
}) {
  const [form, setForm] = useState({
    meet_name:     "",
    description:   "",
    team_ids:      [] as string[],
    member_ids:    [] as string[],
    meet_link:     "",
    schedule_date: "",
    schedule_time: "",
  });

  // Collect members from all selected teams
  const availableMembers = useMemo(() => {
    const seen = new Set<string>();
    const result: PickerItem[] = [];
    for (const t of teams) {
      if (!form.team_ids.includes(t.id)) continue;
      for (const m of (t as any).members ?? []) {
        if (m.user_id && !seen.has(m.user_id)) {
          seen.add(m.user_id);
          result.push({ id: m.user_id, label: m.name ?? m.user_id, sub: m.designation });
        }
      }
    }
    return result;
  }, [teams, form.team_ids]);

  // Reset members when teams change
  useEffect(() => {
    setForm(f => ({
      ...f,
      member_ids: f.member_ids.filter(id => availableMembers.some(m => m.id === id))
    }));
  }, [availableMembers]);

  const teamItems: PickerItem[] = teams.map(t => ({ id: t.id, label: t.name }));

  const canSubmit = !!form.meet_name.trim() && form.team_ids.length > 0
    && form.member_ids.length > 0 && !!form.schedule_date && !!form.schedule_time;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSave({
      id: genId(),
      ...form,
      created_at: new Date().toISOString(),
    });
    onClose();
  }

  return (
    <ModalShell
      title="Schedule Meeting"
      icon={<Video className="size-4 text-violet-500" />}
      onClose={onClose}
    >
      <form onSubmit={submit} className="p-5 space-y-4">
        <div>
          <label className={LABEL_CLS}>Meeting Name *</label>
          <input className={INPUT_CLS} placeholder="e.g. Weekly Content Review"
            value={form.meet_name}
            onChange={(e) => setForm(f => ({ ...f, meet_name: e.target.value }))} required />
        </div>

        <div>
          <label className={LABEL_CLS}>Description</label>
          <textarea className={cn(INPUT_CLS, "resize-none h-20")} placeholder="Agenda or notes…"
            value={form.description}
            onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} />
        </div>

        <div>
          <label className={LABEL_CLS}>Teams * <span className="text-muted-foreground font-normal">(select all participating teams)</span></label>
          <MultiPicker
            items={teamItems}
            selected={form.team_ids}
            onChange={(ids) => setForm(f => ({ ...f, team_ids: ids }))}
            placeholder="Select teams…"
          />
        </div>

        <div>
          <label className={LABEL_CLS}>
            Members *
            {form.team_ids.length === 0 && <span className="ml-1 text-muted-foreground font-normal">(select teams first)</span>}
          </label>
          <MultiPicker
            items={availableMembers}
            selected={form.member_ids}
            onChange={(ids) => setForm(f => ({ ...f, member_ids: ids }))}
            placeholder="Select members…"
            disabled={form.team_ids.length === 0}
          />
          {form.member_ids.length > 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">{form.member_ids.length} member(s) will be invited</p>
          )}
        </div>

        <div>
          <label className={LABEL_CLS}>Meet Link *</label>
          <div className="relative">
            <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input className={cn(INPUT_CLS, "pl-8")} placeholder="https://meet.google.com/…"
              value={form.meet_link} type="url"
              onChange={(e) => setForm(f => ({ ...f, meet_link: e.target.value }))} required />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS}>Date *</label>
            <input type="date" className={INPUT_CLS} value={form.schedule_date}
              onChange={(e) => setForm(f => ({ ...f, schedule_date: e.target.value }))} required />
          </div>
          <div>
            <label className={LABEL_CLS}>Time *</label>
            <div className="relative">
              <Clock className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input type="time" className={cn(INPUT_CLS, "pl-8")} value={form.schedule_time}
                onChange={(e) => setForm(f => ({ ...f, schedule_time: e.target.value }))} required />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={!canSubmit}
            className="bg-violet-600 hover:bg-violet-700 text-white border-violet-600">
            Schedule Meeting
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── ShootingModal ─────────────────────────────────────────────────────────────

function ShootingModal({ onClose, teams = [], onSave }: {
  onClose: () => void;
  teams: ReturnType<typeof useTeams>["data"];
  onSave: (s: Shooting) => void;
}) {
  const [form, setForm] = useState({
    shoot_name:    "",
    description:   "",
    location:      "",
    team_id:       "",
    member_ids:    [] as string[],
    schedule_date: "",
    schedule_time: "",
    equipment:     "",
    dependencies:  "",
  });

  const teamObj = teams.find(t => t.id === form.team_id);
  const crewItems: PickerItem[] = ((teamObj as any)?.members ?? []).map((m: any) => ({
    id: m.user_id, label: m.name ?? m.user_id, sub: m.designation,
  }));

  const canSubmit = !!form.shoot_name.trim() && !!form.location.trim()
    && !!form.team_id && form.member_ids.length > 0
    && !!form.schedule_date && !!form.schedule_time;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSave({
      id: genId(),
      ...form,
      created_at: new Date().toISOString(),
    });
    onClose();
  }

  return (
    <ModalShell
      title="Schedule Shooting"
      icon={<Camera className="size-4 text-orange-500" />}
      onClose={onClose}
    >
      <form onSubmit={submit} className="p-5 space-y-4">
        <div>
          <label className={LABEL_CLS}>Shoot Name *</label>
          <input className={INPUT_CLS} placeholder="e.g. July Product Shoot"
            value={form.shoot_name}
            onChange={(e) => setForm(f => ({ ...f, shoot_name: e.target.value }))} required />
        </div>

        <div>
          <label className={LABEL_CLS}>Description</label>
          <textarea className={cn(INPUT_CLS, "resize-none h-16")} placeholder="Brief about the shoot…"
            value={form.description}
            onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} />
        </div>

        <div>
          <label className={LABEL_CLS}>Location *</label>
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input className={cn(INPUT_CLS, "pl-8")} placeholder="e.g. Studio A, Rooftop, Client Office"
              value={form.location}
              onChange={(e) => setForm(f => ({ ...f, location: e.target.value }))} required />
          </div>
        </div>

        <div>
          <label className={LABEL_CLS} htmlFor="ms-shoot-team">Team *</label>
          <SelectField id="ms-shoot-team" value={form.team_id} required
            onValueChange={(v) => setForm(f => ({ ...f, team_id: v, member_ids: [] }))}
            placeholder="Select team"
            options={[
              { value: "", label: "Select team" },
              ...teams.map(t => ({ value: t.id, label: t.name, dot: t.color || "#94a3b8" })),
            ]} />
        </div>

        <div>
          <label className={LABEL_CLS}>Crew Members *</label>
          <MultiPicker
            items={crewItems}
            selected={form.member_ids}
            onChange={(ids) => setForm(f => ({ ...f, member_ids: ids }))}
            placeholder="Select crew…"
            disabled={!form.team_id}
          />
          {form.member_ids.length > 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">{form.member_ids.length} crew member(s) assigned</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS}>Date *</label>
            <input type="date" className={INPUT_CLS} value={form.schedule_date}
              onChange={(e) => setForm(f => ({ ...f, schedule_date: e.target.value }))} required />
          </div>
          <div>
            <label className={LABEL_CLS}>Time *</label>
            <div className="relative">
              <Clock className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input type="time" className={cn(INPUT_CLS, "pl-8")} value={form.schedule_time}
                onChange={(e) => setForm(f => ({ ...f, schedule_time: e.target.value }))} required />
            </div>
          </div>
        </div>

        <div>
          <label className={LABEL_CLS}>Equipment Needed</label>
          <textarea className={cn(INPUT_CLS, "resize-none h-16")}
            placeholder="e.g. Camera A7IV, Ring light, Tripod, Drone…"
            value={form.equipment}
            onChange={(e) => setForm(f => ({ ...f, equipment: e.target.value }))} />
        </div>

        <div>
          <label className={LABEL_CLS}>Dependencies / Notes</label>
          <textarea className={cn(INPUT_CLS, "resize-none h-16")}
            placeholder="e.g. Depends on weather, client approval needed first…"
            value={form.dependencies}
            onChange={(e) => setForm(f => ({ ...f, dependencies: e.target.value }))} />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={!canSubmit}
            className="bg-orange-500 hover:bg-orange-600 text-white border-orange-500">
            Schedule Shoot
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── TaskDetailPanel ───────────────────────────────────────────────────────────

interface DetailPanelProps {
  task: MediaTask;
  teams: ReturnType<typeof useTeams>["data"];
  onClose: () => void;
  onEdit: () => void;
}

function TaskDetailPanel({ task, teams = [], onClose, onEdit }: DetailPanelProps) {
  const cancel = useCancelMediaTask();
  const update = useUpdateMediaTask();
  const teamObj  = teams.find((t) => t.id === task.team_id);
  const member   = (teamObj as any)?.members?.find((m: any) => m.user_id === task.assigned_to);
  const canAct   = task.status !== "cancelled" && task.status !== "completed";

  return (
    <motion.div
      initial={{ x: "100%", opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "100%", opacity: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="fixed right-0 top-0 h-full w-80 bg-card border-l shadow-2xl z-40 flex flex-col"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <span className="text-sm font-semibold">Task Details</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="size-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
        <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border capitalize",
          STATUS_BADGE[task.status] ?? STATUS_BADGE.scheduled)}>{task.status}</span>
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">Task</p>
          <p className="font-medium">{task.title}</p>
        </div>
        {task.description && (
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Description</p>
            <p className="text-muted-foreground leading-relaxed">{task.description}</p>
          </div>
        )}
        <div className="flex items-start gap-2">
          <Users className="size-3.5 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">Team</p>
            <p>{(teamObj as any)?.name ?? task.team_id}</p>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <User className="size-3.5 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">Assigned to</p>
            <p>{member?.name ?? task.assigned_to}</p>
            {member?.designation && <p className="text-xs text-muted-foreground">{member.designation}</p>}
          </div>
        </div>
        <div className="rounded-lg border bg-muted/20 p-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-emerald-500 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Start Date</p>
              <p className="font-medium">{fmtDate(task.start_date)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-red-500 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Due Date</p>
              <p className="font-medium">{fmtDate(task.due_date)}</p>
            </div>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <Flag className={cn("size-3.5 mt-0.5 shrink-0",
            task.priority === "high" ? "text-red-500" : task.priority === "medium" ? "text-amber-500" : "text-blue-400")} />
          <div>
            <p className="text-xs text-muted-foreground">Priority</p>
            <p className="capitalize">{task.priority}</p>
          </div>
        </div>
      </div>
      {canAct && (
        <div className="p-4 border-t flex flex-col gap-2">
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1" onClick={onEdit}>Edit</Button>
            {task.status === "active" && (
              <Button size="sm" variant="outline"
                className="flex-1 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/10"
                onClick={async () => { await update.mutateAsync({ id: task.id, status: "completed" }); onClose(); }}
                disabled={update.isPending}>
                <CheckCircle2 className="size-3.5 mr-1" /> Complete
              </Button>
            )}
          </div>
          <Button size="sm" variant="destructive"
            onClick={async () => { await cancel.mutateAsync(task.id); onClose(); }}
            disabled={cancel.isPending}>
            {cancel.isPending ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
            Cancel Task
          </Button>
        </div>
      )}
    </motion.div>
  );
}

// ─── DayCell ──────────────────────────────────────────────────────────────────

interface DayCellProps {
  day: number | null;
  isToday: boolean;
  startTasks: MediaTask[];
  dueTasks: MediaTask[];
  projectDueTasks: Array<{ id: string; title: string }>;
  meetings: Meeting[];
  shootings: Shooting[];
  onTaskClick: (t: MediaTask) => void;
}

function DayCell({ day, isToday, startTasks, dueTasks, projectDueTasks, meetings, shootings, onTaskClick }: DayCellProps) {
  type EventItem =
    | { kind: "media"; task: MediaTask; type: "start" | "due" }
    | { kind: "project"; id: string; title: string }
    | { kind: "meeting"; item: Meeting }
    | { kind: "shooting"; item: Shooting };

  const allEvents: EventItem[] = [
    ...startTasks.map((t): EventItem    => ({ kind: "media",    task: t, type: "start" })),
    ...dueTasks.map((t): EventItem      => ({ kind: "media",    task: t, type: "due"   })),
    ...projectDueTasks.map((t): EventItem => ({ kind: "project", id: t.id, title: t.title })),
    ...meetings.map((m): EventItem      => ({ kind: "meeting",  item: m })),
    ...shootings.map((s): EventItem     => ({ kind: "shooting", item: s })),
  ];
  const shown = allEvents.slice(0, 3);
  const more  = allEvents.length - shown.length;

  if (day === null) {
    return <div className="min-h-[7rem] border-b border-r border-border/30 bg-muted/5" />;
  }

  return (
    <div className="min-h-[7rem] border-b border-r border-border/30 p-1.5 flex flex-col gap-0.5">
      <div className="mb-0.5">
        <span className={cn(
          "inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium",
          isToday ? "bg-primary text-primary-foreground font-bold" : "text-muted-foreground"
        )}>{day}</span>
      </div>
      {shown.map((ev, i) => {
        if (ev.kind === "media") return (
          <button key={`${ev.task.id}-${ev.type}-${i}`} onClick={() => onTaskClick(ev.task)}
            title={`${ev.type === "start" ? "Start" : "Due"}: ${ev.task.title}`}
            className={cn(
              "w-full text-left rounded px-1.5 py-0.5 text-[10px] leading-tight truncate font-medium transition-opacity hover:opacity-80",
              ev.type === "start"
                ? "bg-emerald-700 dark:bg-emerald-800 text-white"
                : "bg-red-700 dark:bg-red-800 text-white"
            )}>
            ■ {ev.task.title}
          </button>
        );
        if (ev.kind === "project") return (
          <span key={`proj-${ev.id}-${i}`} title={`Project due: ${ev.title}`}
            className="w-full block rounded px-1.5 py-0.5 text-[10px] leading-tight truncate font-medium bg-amber-600 dark:bg-amber-700 text-white">
            ■ {ev.title}
          </span>
        );
        if (ev.kind === "meeting") return (
          <span key={`meet-${ev.item.id}-${i}`} title={`Meeting: ${ev.item.meet_name} @ ${ev.item.schedule_time}`}
            className="w-full block rounded px-1.5 py-0.5 text-[10px] leading-tight truncate font-medium bg-violet-700 dark:bg-violet-800 text-white">
            ■ {ev.item.meet_name}
          </span>
        );
        if (ev.kind === "shooting") return (
          <span key={`shoot-${ev.item.id}-${i}`} title={`Shoot: ${ev.item.shoot_name} @ ${ev.item.schedule_time}`}
            className="w-full block rounded px-1.5 py-0.5 text-[10px] leading-tight truncate font-medium bg-orange-600 dark:bg-orange-700 text-white">
            ■ {ev.item.shoot_name}
          </span>
        );
        return null;
      })}
      {more > 0 && (
        <span className="text-[10px] text-muted-foreground pl-1 leading-tight">+{more} more</span>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MediaSchedulePage() {
  const todayObj = new Date();

  const [year,  setYear]  = useState(todayObj.getFullYear());
  const [month, setMonth] = useState(todayObj.getMonth());

  function prevMonth() {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  }
  function goToday() { setYear(todayObj.getFullYear()); setMonth(todayObj.getMonth()); }

  const { user } = useAuthStore();
  const roleName   = user?.role?.role_name ?? "";
  const canViewAll = ["Super Admin", "Admin", "Coordinator"].includes(roleName);

  const [filterTeam,     setFilterTeam]     = useState("");
  const [filterMember,   setFilterMember]   = useState("");
  const [filterDateType, setFilterDateType] = useState<"both" | "start" | "due">("both");
  const { data: teams = [] } = useTeams();
  const { data: usersData }  = useUsersList({ limit: 500, page: 1 });
  const allUsersFromDb = usersData?.users ?? [];

  const visibleTeams = useMemo(() => {
    if (canViewAll) return teams;
    return teams.filter((t) => (t as any).my_role === "leader");
  }, [teams, canViewAll]);

  const isLeader   = !canViewAll && (roleName === "Team Leader" || visibleTeams.length > 0);
  const isEmployee = !canViewAll && !isLeader;

  const selectedTeamObj = teams.find((t) => t.id === filterTeam);
  const teamMemberIds   = useMemo(
    () => new Set<string>((selectedTeamObj as any)?.members?.map((m: any) => m.user_id) ?? []),
    [selectedTeamObj]
  );

  const leaderTeamMembers = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{ id: string; name: string; designation: string }> = [];
    const teamsToScan = filterTeam ? visibleTeams.filter((t) => t.id === filterTeam) : visibleTeams;
    for (const t of teamsToScan) {
      for (const m of (t as any).members ?? []) {
        if (m.user_id && !seen.has(m.user_id)) {
          seen.add(m.user_id);
          result.push({ id: m.user_id, name: m.name ?? "", designation: m.designation ?? "" });
        }
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [visibleTeams, filterTeam]);

  const visibleUsers = useMemo(() => {
    if (canViewAll) {
      let base = allUsersFromDb;
      if (filterTeam) base = base.filter((u) => teamMemberIds.has(u.id));
      return base.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    }
    return leaderTeamMembers;
  }, [canViewAll, allUsersFromDb, filterTeam, teamMemberIds, leaderTeamMembers]);

  const resolvedAssignedTo = filterMember === "__me__" ? (user?.id ?? "") : filterMember;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const from_date   = `${year}-${pad2(month + 1)}-01`;
  const to_date     = `${year}-${pad2(month + 1)}-${pad2(daysInMonth)}`;

  const queryParams = useMemo(() => {
    if (isEmployee) return { from_date, to_date };
    const p: Record<string, string | undefined> = { from_date, to_date };
    if (filterTeam)         p.team_id     = filterTeam;
    if (resolvedAssignedTo) p.assigned_to = resolvedAssignedTo;
    return p;
  }, [isEmployee, filterTeam, resolvedAssignedTo, from_date, to_date]);

  const { data: tasks = [], isLoading } = useMediaTasks(queryParams);
  const { data: projectTasks = [] }     = useTasks({
    date_filter: "custom", date_from: from_date, date_to: to_date,
    ...(filterTeam   ? { team_id:   filterTeam }   : {}),
    ...(filterMember ? { member_id: filterMember } : {}),
  });

  // ── Meetings + Shootings (localStorage) ───────────────────────────────────
  const [meetings,  setMeetings]  = useState<Meeting[]>(() => loadLS<Meeting>("media-meetings"));
  const [shootings, setShootings] = useState<Shooting[]>(() => loadLS<Shooting>("media-shootings"));

  function addMeeting(m: Meeting) {
    const next = [...meetings, m];
    setMeetings(next);
    saveLS("media-meetings", next);
  }
  function addShooting(s: Shooting) {
    const next = [...shootings, s];
    setShootings(next);
    saveLS("media-shootings", next);
  }

  // Filter to current month
  const monthMeetings  = useMemo(() =>
    meetings.filter(m => m.schedule_date.startsWith(`${year}-${pad2(month + 1)}`)),
    [meetings, year, month]
  );
  const monthShootings = useMemo(() =>
    shootings.filter(s => s.schedule_date.startsWith(`${year}-${pad2(month + 1)}`)),
    [shootings, year, month]
  );

  // ── Calendar ──────────────────────────────────────────────────────────────
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const totalCells     = Math.ceil((firstDayOfWeek + daysInMonth) / 7) * 7;

  const cells = useMemo(
    () => Array.from({ length: totalCells }, (_, i) => {
      const d = i - firstDayOfWeek + 1;
      return d >= 1 && d <= daysInMonth ? d : null;
    }),
    [totalCells, firstDayOfWeek, daysInMonth]
  );

  const startMap = useMemo(() => {
    const m: Record<string, MediaTask[]> = {};
    for (const t of tasks) { const d = parseDate(t.start_date); (m[d] ??= []).push(t); }
    return m;
  }, [tasks]);

  const dueMap = useMemo(() => {
    const m: Record<string, MediaTask[]> = {};
    for (const t of tasks) { const d = parseDate(t.due_date); (m[d] ??= []).push(t); }
    return m;
  }, [tasks]);

  const projectDueMap = useMemo(() => {
    const m: Record<string, Array<{ id: string; title: string }>> = {};
    for (const t of projectTasks) {
      if (!t.due_date) continue;
      const d = parseDate(t.due_date);
      (m[d] ??= []).push({ id: String((t as any).id ?? ""), title: t.title });
    }
    return m;
  }, [projectTasks]);

  const meetingMap = useMemo(() => {
    const m: Record<string, Meeting[]> = {};
    for (const mt of monthMeetings) { (m[mt.schedule_date] ??= []).push(mt); }
    return m;
  }, [monthMeetings]);

  const shootingMap = useMemo(() => {
    const m: Record<string, Shooting[]> = {};
    for (const sh of monthShootings) { (m[sh.schedule_date] ??= []).push(sh); }
    return m;
  }, [monthShootings]);

  const todayStr = toDateStr(todayObj.getFullYear(), todayObj.getMonth(), todayObj.getDate());

  // ── Modal state ────────────────────────────────────────────────────────────
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [editTask,    setEditTask]    = useState<MediaTask | null>(null);
  const [detailTask,  setDetailTask]  = useState<MediaTask | null>(null);

  function openDetail(task: MediaTask) { setDetailTask(task); }
  function openEditFromDetail() { setEditTask(detailTask); setDetailTask(null); }

  const selectCls = "w-full sm:w-auto max-w-full min-w-0 sm:min-w-[9rem]";

  // ── 3-tab switcher ─────────────────────────────────────────────────────────
  const TABS = [
    { key: "task"     as ModalType, label: "New Task", icon: <ClipboardList className="size-3.5" />, color: "text-primary" },
    { key: "meeting"  as ModalType, label: "Meeting",  icon: <Video className="size-3.5" />,         color: "text-violet-600" },
    { key: "shooting" as ModalType, label: "Shooting", icon: <Camera className="size-3.5" />,        color: "text-orange-500" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Media Schedule"
        subtitle="Plan and assign media tasks on a timeline"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setActiveModal("task")}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground transition-colors shadow-sm">
              <ClipboardList className="size-3.5" /> New Task
            </button>
            <button onClick={() => setActiveModal("meeting")}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-violet-600 hover:bg-violet-700 text-white transition-colors shadow-sm">
              <Video className="size-3.5" /> Meeting
            </button>
            <button onClick={() => setActiveModal("shooting")}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-orange-500 hover:bg-orange-600 text-white transition-colors shadow-sm">
              <Camera className="size-3.5" /> Shooting
            </button>
          </div>
        }
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-0.5 rounded-lg border bg-card px-1 py-1">
          <button onClick={prevMonth} className="p-1.5 rounded hover:bg-muted transition-colors">
            <ChevronLeft className="size-4 text-muted-foreground" />
          </button>
          <span className="min-w-[140px] text-center text-sm font-semibold px-2">
            {MONTH_NAMES[month]} {year}
          </span>
          <button onClick={nextMonth} className="p-1.5 rounded hover:bg-muted transition-colors">
            <ChevronRight className="size-4 text-muted-foreground" />
          </button>
        </div>
        <Button size="sm" variant="outline" onClick={goToday}>Today</Button>

        <div className="hidden md:block md:flex-1" />

        <div className="flex rounded-lg border bg-card overflow-hidden text-xs font-medium">
          {(["both", "start", "due"] as const).map((v) => (
            <button key={v} onClick={() => setFilterDateType(v)}
              className={cn(
                "px-3 py-1.5 transition-colors capitalize",
                filterDateType === v
                  ? v === "start" ? "bg-emerald-500 text-white"
                    : v === "due" ? "bg-red-500 text-white"
                    : "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              )}>
              {v === "both" ? "All Events" : v === "start" ? "Start Dates" : "Due Dates"}
            </button>
          ))}
        </div>

        {!isEmployee && (
          <>
            <SelectField aria-label="Filter by team" className={selectCls} value={filterTeam}
              onValueChange={(v) => { setFilterTeam(v); setFilterMember(""); }}
              options={[
                { value: "", label: isLeader ? "My Teams" : "All Teams" },
                ...visibleTeams.map((t) => ({ value: t.id, label: t.name, dot: t.color || "#94a3b8" })),
              ]} />
            <SelectField aria-label="Filter by member" className={selectCls} value={filterMember}
              onValueChange={setFilterMember}
              options={[
                { value: "", label: "All Members" },
                ...(isLeader ? [{ value: "__me__", label: "⭐ My Tasks" }] : []),
                ...visibleUsers.map((u) => ({ value: u.id, label: u.name, description: u.designation || undefined })),
              ]} />
          </>
        )}

        {isEmployee && (
          <span className="text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-lg border">
            Showing your tasks only
          </span>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        {filterDateType !== "due" && (
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-emerald-500" /> Start Date
          </span>
        )}
        {filterDateType !== "start" && (
          <>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-red-500" /> Media Due Date
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-amber-500" /> Project Due Date
            </span>
          </>
        )}
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-violet-500" /> Meeting
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-orange-500" /> Shooting
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-primary" /> Today
        </span>
        {isLoading && (
          <span className="flex items-center gap-1.5">
            <Loader2 className="size-3 animate-spin" /> Loading…
          </span>
        )}
      </div>

      {/* Calendar */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="grid grid-cols-7 border-b bg-muted/30">
          {DAY_HEADERS.map((d) => (
            <div key={d} className="py-2.5 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, idx) => {
            const dayStr = day ? toDateStr(year, month, day) : "";
            return (
              <DayCell
                key={idx}
                day={day}
                isToday={dayStr === todayStr}
                startTasks={dayStr && filterDateType !== "due"   ? (startMap[dayStr]      ?? []) : []}
                dueTasks={dayStr   && filterDateType !== "start" ? (dueMap[dayStr]        ?? []) : []}
                projectDueTasks={dayStr && filterDateType !== "start" ? (projectDueMap[dayStr] ?? []) : []}
                meetings={dayStr ? (meetingMap[dayStr] ?? []) : []}
                shootings={dayStr ? (shootingMap[dayStr] ?? []) : []}
                onTaskClick={openDetail}
              />
            );
          })}
        </div>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {(activeModal === "task" || editTask) && (
          <TaskModal
            key={editTask?.id ?? "new"}
            onClose={() => { setActiveModal(null); setEditTask(null); }}
            teams={teams}
            initial={editTask}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeModal === "meeting" && (
          <MeetingModal
            key="meeting-modal"
            onClose={() => setActiveModal(null)}
            teams={teams}
            onSave={addMeeting}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeModal === "shooting" && (
          <ShootingModal
            key="shooting-modal"
            onClose={() => setActiveModal(null)}
            teams={teams}
            onSave={addShooting}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {detailTask && (
          <TaskDetailPanel
            key={detailTask.id}
            task={detailTask}
            teams={teams}
            onClose={() => setDetailTask(null)}
            onEdit={openEditFromDetail}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
