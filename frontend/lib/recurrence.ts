/**
 * Client mirror of the server's repeat date engine (backend/app/services/recurrence.py).
 *
 * Used only to PREVIEW what will happen — the server creates the copies. Kept
 * deliberately identical in its rules so the live summary in the Add Task form
 * shows exactly the dates the scheduler will use:
 *   • dates are IST calendar days, anchored on today (IST)
 *   • weekly = same weekday; monthly = same day of month, clamped to the last
 *     day of shorter months, and always computed from the anchor (no drift)
 */
import type { RepeatFrequency } from "@/types/project";

const DAY_MS = 86_400_000;

/** Parse "YYYY-MM-DD" as a calendar date (UTC midnight — no timezone drift). */
function parse(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Date of occurrence `index` (0 = the anchor itself). Mirrors occurrence_date(). */
export function occurrenceDate(frequency: RepeatFrequency, anchorISO: string, index: number): string {
  const a = parse(anchorISO);
  if (frequency === "daily") return toISO(new Date(a.getTime() + index * DAY_MS));
  if (frequency === "weekly") return toISO(new Date(a.getTime() + index * 7 * DAY_MS));
  const total = a.getUTCMonth() + index;
  const year = a.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const day = Math.min(a.getUTCDate(), daysInMonth(year, month));
  return toISO(new Date(Date.UTC(year, month, day)));
}

export function addDays(iso: string, days: number): string {
  return toISO(new Date(parse(iso).getTime() + days * DAY_MS));
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** "Every day" · "Every Friday" · "Every month on the 10th". */
export function describePattern(frequency: RepeatFrequency, anchorISO: string): string {
  const a = parse(anchorISO);
  if (frequency === "daily") return "Every day";
  if (frequency === "weekly") return `Every ${WEEKDAYS[a.getUTCDay()]}`;
  return `Every month on the ${ordinal(a.getUTCDate())}`;
}

/** Monthly on the 29th–31st needs a word about shorter months. */
export function needsMonthEndNote(frequency: RepeatFrequency, anchorISO: string): boolean {
  return frequency === "monthly" && parse(anchorISO).getUTCDate() > 28;
}

/** "10 Oct" — short, unambiguous, for the summary line. */
export function shortDate(iso: string): string {
  return parse(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "Fri 24 Oct" — for "next on …". */
export function shortDateWithDay(iso: string): string {
  return parse(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function unitFor(frequency: RepeatFrequency, n: number): string {
  const base = frequency === "daily" ? "day" : frequency === "weekly" ? "week" : "month";
  return n === 1 ? base : `${base}s`;
}

export const MAX_COUNT: Record<RepeatFrequency, number> = { daily: 365, weekly: 104, monthly: 36 };

export const DUE_OFFSET_OPTIONS = [
  { value: 0, label: "Same day" },
  { value: 1, label: "Next day" },
  { value: 2, label: "2 days later" },
  { value: 3, label: "3 days later" },
  { value: 7, label: "1 week later" },
];
