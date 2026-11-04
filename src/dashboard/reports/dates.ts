/** Dates and number formats for the Reports board (DashReports). Days are local ISO strings, "2026-10-28". */
import { isoDay, shiftDay } from "../features/workDay";

export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export const MONTH_FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;
export const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const WD_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function toDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export { isoDay, shiftDay };

/** "26 Oct 2026" */
export function dStr(iso: string): string {
  const d = toDate(iso);
  return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
}

/** "Mon 26 Oct" */
export function dMid(iso: string): string {
  const d = toDate(iso);
  return `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
}

/** "26 Oct" */
export function dDM(iso: string): string {
  const d = toDate(iso);
  return `${d.getDate()} ${MON[d.getMonth()]}`;
}

/** Days from a to b, both included. */
export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000) + 1;
}

/** "26 Oct 2026 to 28 Oct 2026 · 3 days" (the board's range line). */
export function rangeText(a: string, b: string): string {
  return a === b ? `${dStr(a)} · 1 day` : `${dStr(a)} to ${dStr(b)} · ${daysBetween(a, b)} days`;
}

/** "Mon 26 Oct to Wed 28 Oct" (tooltip / performance period). */
export function midRange(a: string, b: string): string {
  return a === b ? dMid(a) : `${dMid(a)} to ${dMid(b)}`;
}

export type Period = "today" | "yesterday" | "week" | "lastweek" | "month" | "custom";

export const PERIODS: ReadonlyArray<{ v: Period; label: string }> = [
  { v: "today", label: "Today" },
  { v: "yesterday", label: "Yesterday" },
  { v: "week", label: "This week" },
  { v: "lastweek", label: "Last week" },
  { v: "month", label: "This month" },
  { v: "custom", label: "Custom range" },
];

export function mondayOf(today: string): string {
  return shiftDay(today, -((toDate(today).getDay() + 6) % 7));
}

export function monthStart(iso: string): string {
  const d = toDate(iso);
  return isoDay(new Date(d.getFullYear(), d.getMonth(), 1));
}

/** First and last day of a preset (weeks start on Monday). */
export function periodFor(p: Exclude<Period, "custom">, today: string): [string, string] {
  const monday = mondayOf(today);
  switch (p) {
    case "today":
      return [today, today];
    case "yesterday":
      return [shiftDay(today, -1), shiftDay(today, -1)];
    case "week":
      return [monday, today];
    case "lastweek":
      return [shiftDay(monday, -7), shiftDay(monday, -1)];
    case "month":
      return [monthStart(today), today];
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Seconds as "7 h 05 min" (the board's fmt). */
export function fmt(seconds: number): string {
  const m = Math.round(Math.max(0, seconds) / 60);
  return `${Math.floor(m / 60)} h ${pad(m % 60)} min`;
}

/** Seconds as "45 min" under an hour, else "7 h 05 min". */
export function fmtS(seconds: number): string {
  const m = Math.round(Math.max(0, seconds) / 60);
  return m < 60 ? `${m} min` : fmt(seconds);
}

/** Axis label for seconds: "0", "30 min", "2 h". */
export function axisLbl(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m === 0) return "0";
  if (m < 60) return `${m} min`;
  const h = m / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
}

/** A local hour as "9 AM", "12 PM". */
export function hourLbl(h: number): string {
  const x = ((h % 24) + 24) % 24;
  return x < 12 ? `${x === 0 ? 12 : x} AM` : x === 12 ? "12 PM" : `${x - 12} PM`;
}
