// ── Wallet (2026-11-04) ─────────────────────────────────────────────────────
// One person's month as money in and out: a day of salary for every day, what
// came off and why, commission, the rest of the payslip, and what finance paid.

export type WalletDayKind =
  | "on_time" | "late" | "early_out" | "half_day" | "absent" | "wfh"
  | "paid_leave" | "unpaid_leave" | "holiday" | "rest_day"
  | "no_record" | "upcoming" | "not_employed";

export interface WalletDeduction {
  kind: "lop" | "late" | "early_out";
  days: number;
  amount: number;
  reason: string;
}

export interface WalletDay {
  date: string;
  kind: WalletDayKind;
  label: string;
  checkIn: string | null;
  checkOut: string | null;
  lateMinutes: number;
  workedMinutes: number;
  credit: number;
  counted: boolean;
  deductions: WalletDeduction[];
  note: string | null;
}

export type WalletItemGroup =
  | "commission" | "slab" | "finance" | "reimbursement" | "overtime" | "one_time" | "paid_separately" | "loan" | "advance" | "structure";

export interface WalletItem {
  label: string;
  amount: number;
  direction: "credit" | "debit";
  group: WalletItemGroup;
  note: string | null;
  counted: boolean;
}

export interface WalletPayment {
  date: string | null;
  source: "payroll" | "separately" | "commission";
  label: string;
  method: string;
  account: string;
  reference: string;
  amount: number;
  reversed: boolean;
  note: string | null;
}

export interface WalletCommission {
  source: "crm" | "cs";
  name: string;
  detail: string | null;
  currency: string;
  amount: number;
  state: "earned" | "approved" | "on_payroll" | "paid";
  waiting: number;
  note: string | null;
  inBalance: boolean;
}

export type WalletStatus = "in_progress" | "awaiting_payroll" | "payslip" | "part_paid" | "paid" | "paused";

export interface Wallet {
  employee: { _id: string; name: string; employeeCode: string; designation: string };
  month: string;
  currency: string;
  status: WalletStatus;
  today: string;
  firstMonth: string | null;
  complete: boolean;
  salary: { monthly: number; perDay: number; monthTotal: number; structureName: string | null; employedShare: number; daysInMonth: number };
  muted: { reason: string } | null;
  payslip: { status: "draft" | "issued" | "paid"; netPay: number; issuedAt: string | null; paidAt: string | null } | null;
  days: WalletDay[];
  reconcile: Array<{ kind: "lop" | "late" | "early_out"; amount: number; reason: string }>;
  items: WalletItem[];
  commission: WalletCommission[];
  payments: WalletPayment[];
  totals: { credited: number; deducted: number; net: number; paid: number; balance: number; financePayable: number | null };
  finance: { connected: boolean; error: string | null; crmError: string | null; runNumbers: string[]; onHold: string | null };
}
