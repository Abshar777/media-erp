"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2, Globe, Loader2, Mail, MoreVertical, Phone,
  Plus, Search, Trash2, UserPlus, X,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { cn } from "@/lib/utils";
import {
  useClients, useAgencyStats, useCreateClient, useUpdateClient,
  useDeleteClient, useInviteClient,
  Client, ClientCreate, INDUSTRIES, CLIENT_COLORS,
} from "@/hooks/useClients";

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-xl border bg-card px-5 py-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function ClientAvatar({ client, size = "md" }: { client: Client; size?: "sm" | "md" | "lg" }) {
  const initials = client.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const sz = size === "sm" ? "size-8 text-xs" : size === "lg" ? "size-12 text-base" : "size-10 text-sm";
  return (
    <div
      className={cn("flex shrink-0 items-center justify-center rounded-xl font-bold text-white", sz)}
      style={{ background: client.color || "#6366f1" }}
    >
      {initials}
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const classes: Record<string, string> = {
    active: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
    inactive: "bg-muted text-muted-foreground border-border",
    prospect: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  };
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize", classes[status] ?? classes.inactive)}>
      {status}
    </span>
  );
}

// ── Create / Edit Modal ───────────────────────────────────────────────────────

function ClientModal({ onClose, initial }: { onClose: () => void; initial?: Client }) {
  const create = useCreateClient();
  const update = useUpdateClient();
  const isPending = create.isPending || update.isPending;

  const [form, setForm] = useState<ClientCreate & { status?: string }>({
    name:     initial?.name     ?? "",
    company:  initial?.company  ?? "",
    email:    initial?.email    ?? "",
    phone:    initial?.phone    ?? "",
    website:  initial?.website  ?? "",
    industry: initial?.industry ?? "",
    notes:    initial?.notes    ?? "",
    color:    initial?.color    ?? CLIENT_COLORS[0],
    status:   initial?.status   ?? "active",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== "")) as ClientCreate;
    if (initial) {
      await update.mutateAsync({ id: initial.id, ...payload });
    } else {
      await create.mutateAsync(payload);
    }
    onClose();
  }

  const labelCls = "block text-xs font-medium text-muted-foreground mb-1";
  const inputCls = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary";

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        className="relative z-10 w-full max-w-lg rounded-2xl bg-card border border-border shadow-2xl overflow-hidden"
        initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
      >
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-semibold text-base">{initial ? "Edit Client" : "Add Client"}</h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-muted"><X className="size-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Color picker */}
          <div>
            <label className={labelCls}>Brand Color</label>
            <div className="flex gap-2 flex-wrap">
              {CLIENT_COLORS.map((c) => (
                <button
                  key={c} type="button"
                  onClick={() => setForm((f) => ({ ...f, color: c }))}
                  className={cn("size-7 rounded-full border-2 transition-transform hover:scale-110", form.color === c ? "border-foreground scale-110" : "border-transparent")}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={labelCls}>Client Name *</label>
              <input className={inputCls} placeholder="Acme Corp" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </div>
            <div>
              <label className={labelCls}>Company</label>
              <input className={inputCls} placeholder="Acme Inc." value={form.company ?? ""} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="client-industry" className={labelCls}>Industry</label>
              <SelectField
                id="client-industry"
                className="rounded-md"
                placeholder="Select…"
                value={form.industry ?? ""}
                onValueChange={(v) => setForm((f) => ({ ...f, industry: v }))}
                options={[{ value: "", label: "Select…" }, ...INDUSTRIES.map((i) => ({ value: i, label: i }))]}
              />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input type="email" className={inputCls} placeholder="contact@client.com" value={form.email ?? ""} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Phone</label>
              <input className={inputCls} placeholder="+1 555 0100" value={form.phone ?? ""} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Website</label>
              <input className={inputCls} placeholder="https://client.com" value={form.website ?? ""} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} />
            </div>
            {initial && (
              <div>
                <label htmlFor="client-status" className={labelCls}>Status</label>
                <SelectField
                  id="client-status"
                  className="rounded-md"
                  value={form.status ?? "active"}
                  onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}
                  options={[
                    { value: "active", label: "Active" },
                    { value: "inactive", label: "Inactive" },
                    { value: "prospect", label: "Prospect" },
                  ]}
                />
              </div>
            )}
            <div className={cn("col-span-2", initial ? "" : "")}>
              <label className={labelCls}>Notes</label>
              <textarea className={cn(inputCls, "resize-none")} rows={2} placeholder="Internal notes…" value={form.notes ?? ""} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              {initial ? "Save Changes" : "Add Client"}
            </Button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ── Client card ───────────────────────────────────────────────────────────────

function ClientCard({ client }: { client: Client }) {
  const update  = useUpdateClient();
  const del     = useDeleteClient();
  const invite  = useInviteClient();
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);

  return (
    <>
      <AnimatePresence>{editing && <ClientModal onClose={() => setEditing(false)} initial={client} />}</AnimatePresence>
      <motion.div
        layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
        className="group rounded-xl border bg-card p-5 hover:shadow-sm transition-shadow relative"
      >
        <div className="flex items-start gap-3">
          <ClientAvatar client={client} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{client.name}</span>
              <StatusBadge status={client.status} />
            </div>
            {client.company && <p className="text-xs text-muted-foreground mt-0.5">{client.company}</p>}
            {client.industry && <p className="text-xs text-muted-foreground">{client.industry}</p>}

            <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
              {client.email && (
                <span className="flex items-center gap-1"><Mail className="size-3" />{client.email}</span>
              )}
              {client.phone && (
                <span className="flex items-center gap-1"><Phone className="size-3" />{client.phone}</span>
              )}
              {client.website && (
                <a href={client.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-primary">
                  <Globe className="size-3" />{client.website.replace(/^https?:\/\//, "")}
                </a>
              )}
            </div>

            <div className="mt-3 flex gap-4 text-[11px]">
              <span className="text-muted-foreground">{client.connector_count} connector{client.connector_count !== 1 ? "s" : ""}</span>
              {client.total_spend_30d > 0 && (
                <span className="text-muted-foreground">${client.total_spend_30d.toLocaleString()} spend (30d)</span>
              )}
              {client.invited_at && !client.accepted_at && (
                <span className="text-amber-600">Invite pending</span>
              )}
            </div>
          </div>

          {/* Menu */}
          <div className="relative shrink-0">
            <button onClick={() => setMenu((v) => !v)} className="rounded-lg p-1.5 hover:bg-muted text-muted-foreground">
              <MoreVertical className="size-4" />
            </button>
            {menu && (
              <div className="absolute right-0 top-8 z-10 w-40 rounded-xl border bg-card shadow-lg py-1 text-sm">
                <button onClick={() => { setEditing(true); setMenu(false); }} className="w-full px-3 py-2 text-left hover:bg-muted">Edit</button>
                {client.email && (
                  <button onClick={() => { invite.mutate(client.id); setMenu(false); }} className="w-full px-3 py-2 text-left hover:bg-muted flex items-center gap-2">
                    <UserPlus className="size-3.5" /> Send Invite
                  </button>
                )}
                <button
                  onClick={() => { update.mutate({ id: client.id, status: client.status === "active" ? "inactive" : "active" }); setMenu(false); }}
                  className="w-full px-3 py-2 text-left hover:bg-muted"
                >
                  {client.status === "active" ? "Mark Inactive" : "Mark Active"}
                </button>
                <div className="border-t border-border my-1" />
                <button onClick={() => { del.mutate(client.id); setMenu(false); }} className="w-full px-3 py-2 text-left text-destructive hover:bg-destructive/10 flex items-center gap-2">
                  <Trash2 className="size-3.5" /> Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const { data: clients = [], isLoading } = useClients(statusFilter || undefined);
  const { data: stats } = useAgencyStats();

  const filtered = clients.filter((c) =>
    !search || [c.name, c.company, c.email].some((v) => v?.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6 p-6">
      <AnimatePresence>{creating && <ClientModal onClose={() => setCreating(false)} />}</AnimatePresence>

      <PageHeader
        title="Clients"
        subtitle="Manage your agency clients and track their performance in one place."
        action={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4 mr-2" />
            Add Client
          </Button>
        }
      />

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Total Clients" value={stats.total_clients} />
          <StatCard label="Active" value={stats.active_clients} />
          <StatCard label="Prospects" value={stats.prospect_clients} />
          <StatCard label="Total Spend (30d)" value={`$${stats.total_spend_30d.toLocaleString()}`} />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            className="w-full rounded-lg border bg-background pl-9 pr-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
            placeholder="Search clients…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {(["", "active", "inactive", "prospect"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors capitalize",
                statusFilter === s ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s || "All"}
            </button>
          ))}
        </div>
      </div>

      {/* Client grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border rounded-xl bg-card">
          <Building2 className="size-10 text-muted-foreground mb-3" />
          <p className="text-sm font-medium">{clients.length === 0 ? "No clients yet" : "No matching clients"}</p>
          <p className="text-xs text-muted-foreground mt-1 mb-4">
            {clients.length === 0
              ? "Add your first client to start managing their campaigns."
              : "Try adjusting your search or filters."}
          </p>
          {clients.length === 0 && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-4 mr-2" />
              Add First Client
            </Button>
          )}
        </div>
      ) : (
        <AnimatePresence>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((c) => <ClientCard key={c.id} client={c} />)}
          </div>
        </AnimatePresence>
      )}
    </div>
  );
}
