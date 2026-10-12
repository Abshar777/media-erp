"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Search, Users, Pencil, Trash2, X, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { UserDialog } from "@/components/users/UserDialog";
import { DeleteUserDialog } from "@/components/users/DeleteUserDialog";
import { useUsersList } from "@/hooks/useUsers";
import { useRolesSimple } from "@/hooks/useRoles";
import { useImpersonate } from "@/hooks/useAuth";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/types/user";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/datetime";

export default function UsersPage() {
  const [search, setSearch]         = useState("");
  const [statusFilter, setStatus]   = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [page, setPage]             = useState(1);
  const [dialogOpen, setDialog]     = useState(false);
  const [editUser, setEditUser]     = useState<User | null>(null);
  const [deleteUser, setDeleteUser] = useState<User | null>(null);

  const { data, isLoading } = useUsersList({ search, status: statusFilter, role_id: roleFilter, page, limit: 15 });
  const { data: roles = [] } = useRolesSimple();
  const currentUser  = useAuthStore((s) => s.user);
  const isSuperAdmin = !!(currentUser?.role?.is_system_role && currentUser?.role?.role_name === "Super Admin");
  const impersonate  = useImpersonate();

  const users = data?.users ?? [];
  const total = data?.total ?? 0;
  const pages = data?.pages ?? 1;

  function openCreate() { setEditUser(null); setDialog(true); }
  function openEdit(user: User) { setEditUser(user); setDialog(true); }

  function initials(name: string) {
    return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{total} user{total !== 1 ? "s" : ""}</p>
        </div>
        <Button size="sm" onClick={openCreate} className="gap-1.5">
          <Plus className="size-3.5" />
          New User
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search users…"
            className="w-full rounded-lg border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2">
              <X className="size-3.5 text-muted-foreground" />
            </button>
          )}
        </div>

        <SelectField
          aria-label="Status"
          value={statusFilter}
          onValueChange={(v) => { setStatus(v); setPage(1); }}
          className="w-auto min-w-[8rem]"
          options={[
            { value: "", label: "All Status" },
            { value: "active", label: "Active", dot: "#22c55e" },
            { value: "inactive", label: "Inactive", dot: "#94a3b8" },
          ]}
        />

        <SelectField
          aria-label="Role"
          value={roleFilter}
          onValueChange={(v) => { setRoleFilter(v); setPage(1); }}
          className="w-auto min-w-[9rem]"
          options={[
            { value: "", label: "All Roles" },
            ...roles.map((r) => ({ value: r.id, label: r.role_name })),
          ]}
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
            className="h-7 w-7 rounded-full border-2 border-primary border-t-transparent"
          />
        </div>
      ) : users.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Users className="size-10 mb-3 opacity-30" />
          <p className="text-sm">No users found</p>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">User</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Role</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Designation</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Joined</th>
                <th className="px-4 py-3 w-24" />
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {users.map((user, i) => (
                  <motion.tr
                    key={user.id}
                    layout
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15, delay: i * 0.02 }}
                    className="border-b last:border-0 hover:bg-muted/20 transition-colors group"
                  >
                    {/* User */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-xs">
                          {initials(user.name || user.email)}
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{user.name}</p>
                          <p className="text-xs text-muted-foreground">{user.email}</p>
                        </div>
                      </div>
                    </td>

                    {/* Role */}
                    <td className="px-4 py-3">
                      {user.role ? (
                        <span className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          user.role.is_system_role ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                        )}>
                          {user.role.role_name}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50 text-xs">—</span>
                      )}
                    </td>

                    {/* Designation */}
                    <td className="px-4 py-3 text-muted-foreground">{user.designation || "—"}</td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        user.status === "active"
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                      )}>
                        {user.status}
                      </span>
                    </td>

                    {/* Joined */}
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {user.created_at ? fmtDate(user.created_at, { day: "numeric", month: "short", year: "numeric" }) : "—"}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {isSuperAdmin && !(user.role?.is_system_role && user.role?.role_name === "Super Admin") && user.id !== currentUser?.id && (
                          <button
                            onClick={() => impersonate.mutate(user.id)}
                            disabled={impersonate.isPending}
                            className="rounded-md p-1.5 text-muted-foreground hover:text-amber-600 hover:bg-amber-100 dark:hover:bg-amber-900/20 transition-colors"
                            title="View as this user"
                          >
                            <UserCheck className="size-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => openEdit(user)}
                          className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          title="Edit"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteUser(user)}
                          className="rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
          <span className="text-sm text-muted-foreground">{page} / {pages}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}

      {/* Dialogs */}
      <UserDialog open={dialogOpen} onClose={() => setDialog(false)} user={editUser} />
      <DeleteUserDialog open={!!deleteUser} onClose={() => setDeleteUser(null)} user={deleteUser} />
    </div>
  );
}
