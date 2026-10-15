/**
 * Client mirror of the server's repeat date engine (backend/app/services/recurrence.py).
 *
 * Used only to PREVIEW what will happen — the server creates the copies. Kept
 * deliberately identical in its rules so the live summary in the Add Task form
 * shows exactly the dates the scheduler will use:
 *   • dates are IST calendar days, anchored on the first day (today, or the
 *     chosen weekday / day of the month)
 *   • weekly = the chosen weekday(s) — several days repeat in the same order
 *     every week (week_offsets); monthly = the chosen day of month, clamped to the
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
 * Weekly on several days: days after the anchor of each chosen weekday within
 * one week, sorted (anchor Tue with Mon/Tue/Fri/Sun → [0, 3, 5, 6]). null for
 * one day. Mirrors week_offsets().
 */
export function weekOffsets(anchorISO: string, weekdays?: number[] | null): number[] | null {
  const days = [...new Set(weekdays ?? [])];
  if (days.length <= 1) return null;
  const a = serverWeekday(anchorISO);
  return days.map((d) => (((d - a) % 7) + 7) % 7).sort((x, y) => x - y);
}

/**
 * Date of occurrence `index` (0 = the anchor itself). Mirrors occurrence_date().
 * `monthDay` is the chosen day for monthly series (the anchor may be clamped);
 * `offsets` (weekOffsets) for weekly on several days.
 */
export function occurrenceDate(frequency: RepeatFrequency, anchorISO: string, index: number, monthDay?: number | null,
                               offsets?: number[] | null): string {
  const a = parse(anchorISO);
  // Daily with offsets = skipping Sundays: the same Mon–Sat arithmetic as weekly.
  if (frequency === "daily" && !offsets?.length) return toISO(new Date(a.getTime() + index * DAY_MS));
  if ((frequency === "weekly" || frequency === "daily") && offsets?.length) {
    const k = offsets.length;
    return toISO(new Date(a.getTime() + (Math.floor(index / k) * 7 + offsets[index % k]) * DAY_MS));
  }
  if (frequency === "weekly") return toISO(new Date(a.getTime() + index * 7 * DAY_MS));
  return addMonths(anchorISO, index, monthDay || a.getUTCDate());
}

/** Server weekday (Mon 0 … Sun 6) of a date. */
export function serverWeekday(iso: string): number {
  return (parse(iso).getUTCDay() + 6) % 7;
}

/** The series' first day: today, or the soonest chosen weekday / the day of month. Mirrors first_date(). */
export function firstDate(frequency: RepeatFrequency, todayISO: string, weekday?: number | null, monthDay?: number | null,
                          weekdays?: number[] | null, skipSundays = false): string {
  // A daily series that skips Sundays and is set up on a Sunday starts on Monday.
  if (frequency === "daily" && skipSundays && serverWeekday(todayISO) === 6) return addDays(todayISO, 1);
  if (frequency === "weekly" && weekdays?.length) {
    const t = serverWeekday(todayISO);
    return addDays(todayISO, Math.min(...weekdays.map((d) => (((d - t) % 7) + 7) % 7)));
  }
  if (frequency === "weekly" && weekday != null) {
    return addDays(todayISO, (weekday - serverWeekday(todayISO) + 7) % 7);
  }
  if (frequency === "monthly" && monthDay) {
    const thisMonth = addMonths(todayISO, 0, monthDay);
    return thisMonth >= todayISO ? thisMonth : addMonths(todayISO, 1, monthDay);
  }
  return todayISO;
}

/** A daily series that skips Sundays repeats on these (server weekdays, Mon 0 … Sat 5). */
export const MON_TO_SAT = [0, 1, 2, 3, 4, 5];

/** Offsets for a daily series: Mon–Sat when it skips Sundays, else none (every day). Mirrors series_offsets(). */
export function dailyOffsets(anchorISO: string, skipSundays?: boolean | null): number[] | null {
  return skipSundays ? weekOffsets(anchorISO, MON_TO_SAT) : null;
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

/** "Mon, Tue, Fri & Sun" — Monday-first. */
export function weekdayList(weekdays: number[]): string {
  const names = [...new Set(weekdays)].sort((a, b) => a - b).map((d) => WEEKDAY_SHORT[d]);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}` : names[0] ?? "";
}

/** "Every day" · "Every Friday" · "Every Mon, Tue & Fri" · "Every weekday" · "Every month on the 10th". */
export function describePattern(frequency: RepeatFrequency, anchorISO: string, monthDay?: number | null,
                                weekdays?: number[] | null, skipSundays?: boolean | null): string {
  const a = parse(anchorISO);
  if (frequency === "daily") return skipSundays ? "Every day except Sunday" : "Every day";
  if (frequency === "weekly") {
    const days = [...new Set(weekdays ?? [])].sort((x, y) => x - y);
    if (days.length === 7) return "Every day of the week";
    if (days.join() === "0,1,2,3,4") return "Every weekday (Mon–Fri)";
    if (days.length > 1) return `Every ${weekdayList(days)}`;
    return `Every ${WEEKDAYS[a.getUTCDay()]}`;
  }
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

/** "2 Oct" — or "2 Oct 2028" when it isn't in the same year as `fromISO` (a long series' end). */
export function shortDateFrom(iso: string, fromISO: string): string {
  if (iso.slice(0, 4) === fromISO.slice(0, 4)) return shortDate(iso);
  return parse(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
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
