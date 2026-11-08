/**
 * Rules › Work hours (logic/rules_hours.js): the wording and small sums the tab shows. The API keeps times as
 * "HH:MM" (24 h) and the working days as "1111110" (Mon..Sun); the tab shows "10:00 AM" and day chips.
 */
import type { WorkHours } from "../../lib/api";

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function minutesOf(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

function hhmmOf(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "13:30" → "1:30 PM". */
export function clock12(hhmm: string): string {
  const mins = minutesOf(hhmm);
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

/** Half-hour options from `from` to `to` (hours), as "HH:MM", plus `keep` when it isn't one of them. */
export function timeOptions(from: number, to: number, keep?: string): string[] {
  const out: string[] = [];
  for (let m = from * 60; m <= to * 60; m += 30) out.push(hhmmOf(m));
  if (keep && !out.includes(keep)) {
    out.push(keep);
    out.sort((a, b) => minutesOf(a) - minutesOf(b));
  }
  return out;
}

/** Fixed options (minutes / hours) plus the saved value when it isn't one of them. */
export function withValue(values: readonly number[], keep: number): number[] {
  return values.includes(keep) ? [...values] : [...values, keep].sort((a, b) => a - b);
}

export function daysOf(mask: string): boolean[] {
  return DAY_NAMES.map((_, i) => mask[i] === "1");
}

export function maskOf(days: readonly boolean[]): string {
  return days.map((d) => (d ? "1" : "0")).join("");
}

/** "Mon to Sat", "every day", "no days", or "Mon, Wed, Fri". */
export function daysLine(mask: string): string {
  const days = daysOf(mask);
  const on = DAY_NAMES.filter((_, i) => days[i]);
  if (on.length === 7) return "every day";
  if (on.length === 0) return "no days";
  const first = days.indexOf(true);
  const last = days.lastIndexOf(true);
  const run = days.slice(first, last + 1).every(Boolean);
  return run && on.length > 2 ? `${DAY_NAMES[first]} to ${DAY_NAMES[last]}` : on.join(", ");
}

/** Department day presets on the By department rows. */
export const DAY_PRESETS: ReadonlyArray<[string, string]> = [
  ["1111100", "Mon to Fri"],
  ["1111110", "Mon to Sat"],
  ["1111111", "Every day"],
];

/** "10:00 AM to 7:00 PM, Mon to Sat". */
export function hoursLine(h: WorkHours): string {
  return `${clock12(h.start)} to ${clock12(h.end)}, ${daysLine(h.days)}`;
}

/** "Start day after 10:15 AM counts as late. Working days: Mon to Sat." */
export function lateLine(h: WorkHours): string {
  return `Start day after ${clock12(hhmmOf(minutesOf(h.start) + h.late_grace_min))} counts as late. Working days: ${daysLine(h.days)}.`;
}

/** 75 → "1 h 15 min", 60 → "1 h", 45 → "45 min" (the member's note). */
export function shortMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** 75 → "1 hour 15 minutes" (the select's options). */
export function longMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const hs = h ? `${h} ${h === 1 ? "hour" : "hours"}` : "";
  const ms = m ? `${m} ${m === 1 ? "minute" : "minutes"}` : "";
  return [hs, ms].filter(Boolean).join(" ") || "0 minutes";
}

function joinAnd(items: readonly string[]): string {
  return items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "Sun every week", "Sat and Sun every week", or "No weekly day off". */
export function offDaysLine(mask: string): string {
  const days = daysOf(mask);
  const off = DAY_NAMES.filter((_, i) => !days[i]);
  return off.length ? `${joinAnd(off)} every week` : "No weekly day off";
}

/** The Work hours tab's pill: "10–7 · Mon–Sat". */
export function hoursPill(h: WorkHours): string {
  const short = (hhmm: string) => {
    const mins = minutesOf(hhmm);
    const hr = Math.floor(mins / 60) % 12 || 12;
    return mins % 60 ? `${hr}:${String(mins % 60).padStart(2, "0")}` : String(hr);
  };
  const line = daysLine(h.days);
  const days = line === "every day" ? "Every day" : line.replace(/ to /, "–");
  return `${short(h.start)}–${short(h.end)} · ${days}`;
}

/** "2026-10-20" → "20 Oct". */
export function holidayDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : iso;
}

/**
 * A typed holiday date → "YYYY-MM-DD", or null. Takes "4 Mar", "4 March", "Mar 4", "4 Mar 2027", "4/3", "2027-03-04".
 * Without a year: the next time that day comes (today counts).
 */
export function parseHolidayDate(raw: string, today: Date = new Date()): string | null {
  const s = raw.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!s) return null;
  let day: number;
  let month: number;
  let year: number | null = null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const num = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(s);
  const monIdx = (w: string) => MONTHS.findIndex((m) => w.startsWith(m.toLowerCase()));
  const dm = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)(?: (\d{4}))?$/.exec(s);
  const md = /^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/.exec(s);
  if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (num) {
    // Day first, as in India and the UK.
    [day, month] = [Number(num[1]), Number(num[2])];
    if (num[3]) year = num[3].length === 2 ? 2000 + Number(num[3]) : Number(num[3]);
  } else if (dm && monIdx(dm[2]) >= 0 && dm[2].length >= 3) {
    [day, month] = [Number(dm[1]), monIdx(dm[2]) + 1];
    if (dm[3]) year = Number(dm[3]);
  } else if (md && monIdx(md[1]) >= 0 && md[1].length >= 3) {
    [day, month] = [Number(md[2]), monIdx(md[1]) + 1];
    if (md[3]) year = Number(md[3]);
  } else return null;
  if (month < 1 || month > 12 || day < 1) return null;
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let y = year ?? t0.getFullYear();
  const valid = (yy: number) => new Date(yy, month - 1, day).getMonth() === month - 1;
  if (year === null && (new Date(y, month - 1, day) < t0 || !valid(y))) y += 1;
  if (!valid(y)) return null;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
