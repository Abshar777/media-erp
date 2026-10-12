"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { useCreateUser, useUpdateUser } from "@/hooks/useUsers";
import { useRolesSimple } from "@/hooks/useRoles";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/types/user";

interface Props {
  open: boolean;
  onClose: () => void;
  user?: User | null;
}

const inputCls = "w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      {children}
    </div>
  );
}

export function UserDialog({ open, onClose, user }: Props) {
  const isEdit = !!user;
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const { data: roles = [] } = useRolesSimple();
  const { user: currentUser } = useAuthStore();

  const isSuperAdmin =
    currentUser?.role?.is_system_role &&
    currentUser?.role?.role_name === "Super Admin";

  // Super Admin can assign any role; Admin can only assign non-elevated roles
  const assignableRoles = isSuperAdmin
    ? roles
    : roles.filter((r) => r.role_name !== "Super Admin" && r.role_name !== "Admin");

  const [name, setName]             = useState("");
  const [email, setEmail]           = useState("");
  const [password, setPassword]     = useState("");
  const [roleId, setRoleId]         = useState("");
  const [designation, setDesg]      = useState("");
  const [status, setStatus]         = useState<"active" | "inactive">("active");
  const [waPhone, setWaPhone]       = useState("");

  useEffect(() => {
    if (user) {
      setName(user.name);
      setEmail(user.email);
      setPassword("");
      setRoleId(user.role_id ?? "");
      setDesg(user.designation ?? "");
      setStatus(user.status ?? "active");
      setWaPhone((user as any).whatsapp_phone ?? "");
    } else {
      setName(""); setEmail(""); setPassword("");
      setRoleId(assignableRoles[0]?.id ?? ""); setDesg(""); setStatus("active");
      setWaPhone("");
    }
  }, [user, open, assignableRoles]);

  function close() { onClose(); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (isEdit) {
        const payload: Record<string, string> = { name, email, role_id: roleId, designation, status, whatsapp_phone: waPhone };
        if (password) payload.password = password;
        await updateUser.mutateAsync({ id: user!.id, payload });
      } else {
        await createUser.mutateAsync({ name, email, password, role_id: roleId, designation, status, whatsapp_phone: waPhone });
      }
      close();
    } catch {
      // toast handled in hook
    }
  }

  const isPending = createUser.isPending || updateUser.isPending;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={close}
          />
          <motion.div
            key="modal"
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="fixed inset-x-4 top-[10%] z-50 mx-auto max-w-lg rounded-2xl bg-background shadow-2xl border"
          >
            <form onSubmit={submit}>
              {/* Header */}
              <div className="flex items-center justify-between border-b px-6 py-4">
                <div className="flex items-center gap-2">
                  <UserCog className="size-5 text-primary" />
                  <h2 className="text-base font-semibold">{isEdit ? "Edit User" : "Create User"}</h2>
                </div>
                <button type="button" onClick={close} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
                  <X className="size-4" />
                </button>
              </div>

              {/* Body */}
              <div className="px-6 py-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Full Name" required>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Jane Smith"
                      className={inputCls}
                      required
                    />
                  </Field>
                  <Field label="Email" required>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="jane@company.com"
                      className={inputCls}
                      required
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Field label={isEdit ? "New Password" : "Password"} required={!isEdit}>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={isEdit ? "Leave blank to keep" : "Min. 6 characters"}
                      className={inputCls}
                      required={!isEdit}
                      minLength={6}
                    />
                  </Field>
                  <Field label="Role" required>
                    <SelectField
                      aria-label="Role"
                      value={roleId}
                      onValueChange={setRoleId}
                      required
                      options={[
                        { value: "", label: "Select role…" },
                        ...assignableRoles.map((r) => ({ value: r.id, label: r.role_name })),
                      ]}
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Designation">
                    <input
                      value={designation}
                      onChange={(e) => setDesg(e.target.value)}
                      placeholder="e.g. Marketing Lead"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Status">
                    <SelectField<"active" | "inactive">
                      aria-label="Status"
                      value={status}
                      onValueChange={setStatus}
                      options={[
                        { value: "active", label: "Active", dot: "#22c55e" },
                        { value: "inactive", label: "Inactive", dot: "#94a3b8" },
                      ]}
                    />
                  </Field>
                </div>

                <Field label="WhatsApp Phone">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm select-none">💬</span>
                    <input
                      type="tel"
                      value={waPhone}
                      onChange={(e) => setWaPhone(e.target.value)}
                      placeholder="+91 98765 43210"
                      className={`${inputCls} pl-8`}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Include country code. Used for WhatsApp task notifications.</p>
                </Field>
              </div>

              {/* Footer */}
              <div className="flex justify-end gap-2 border-t px-6 py-4">
                <Button type="button" variant="outline" onClick={close}>Cancel</Button>
                <Button type="submit" disabled={isPending || !name || !email || (!isEdit && !password) || !roleId}>
                  {isPending ? "Saving…" : isEdit ? "Save Changes" : "Create User"}
                </Button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
