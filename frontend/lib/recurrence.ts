/**
 * Client mirror of the server's repeat date engine (backend/app/services/recurrence.py).
 *
 * Used only to PREVIEW what will happen — the server creates the copies. Kept
 * deliberately identical in its rules so the live summary in the Add Task form
 * shows exactly the dates the scheduler will use:
 *   • dates are IST calendar days, anchored on the first day (today, or the
 *     chosen weekday / day of the month)
 *   • weekly = same weekday; monthly = the chosen day of month, clamped to the
 *     last day of shorter months, always computed from the anchor (no drift)
 *   • weekdays use the SERVER's numbering: Monday 0 … Sunday 6
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

/** `iso` moved by `months`, landing on `day` or the month's last day. Mirrors add_months(). */
function addMonths(iso: string, months: number, day: number): string {
  const a = parse(iso);
  const total = a.getUTCMonth() + months;
  const year = a.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  return toISO(new Date(Date.UTC(year, month, Math.min(day, daysInMonth(year, month)))));
}

/**
 * Date of occurrence `index` (0 = the anchor itself). Mirrors occurrence_date().
 * `monthDay` is the chosen day for monthly series (the anchor may be clamped).
 */
export function occurrenceDate(frequency: RepeatFrequency, anchorISO: string, index: number, monthDay?: number | null): string {
  const a = parse(anchorISO);
  if (frequency === "daily") return toISO(new Date(a.getTime() + index * DAY_MS));
  if (frequency === "weekly") return toISO(new Date(a.getTime() + index * 7 * DAY_MS));
  return addMonths(anchorISO, index, monthDay || a.getUTCDate());
}

/** Server weekday (Mon 0 … Sun 6) of a date. */
export function serverWeekday(iso: string): number {
  return (parse(iso).getUTCDay() + 6) % 7;
}

/** The series' first day: today, or the next chosen weekday / day of month. Mirrors first_date(). */
export function firstDate(frequency: RepeatFrequency, todayISO: string, weekday?: number | null, monthDay?: number | null): string {
  if (frequency === "weekly" && weekday != null) {
    return addDays(todayISO, (weekday - serverWeekday(todayISO) + 7) % 7);
  }
  if (frequency === "monthly" && monthDay) {
    const thisMonth = addMonths(todayISO, 0, monthDay);
    return thisMonth >= todayISO ? thisMonth : addMonths(todayISO, 1, monthDay);
  }
  return todayISO;
}

/** Monday-first labels, indexed by server weekday. */
export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const WEEKDAY_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

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
export function describePattern(frequency: RepeatFrequency, anchorISO: string, monthDay?: number | null): string {
  const a = parse(anchorISO);
  if (frequency === "daily") return "Every day";
  if (frequency === "weekly") return `Every ${WEEKDAYS[a.getUTCDay()]}`;
  return `Every month on the ${ordinal(monthDay || a.getUTCDate())}`;
}

/** Monthly on the 29th–31st needs a word about shorter months. */
export function needsMonthEndNote(frequency: RepeatFrequency, anchorISO: string, monthDay?: number | null): boolean {
  return frequency === "monthly" && (monthDay || parse(anchorISO).getUTCDate()) > 28;
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
