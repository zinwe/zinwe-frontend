/**
 * v1.4 day status in Reports (GET reports/ → `attendance`; one person's `person_days[].status`): how each day counts
 * for each person, by the Rules' work hours (full / half / absent / leave / off / holiday, and late).
 */
import type { AttendanceDay, DayCounts, DayStatus, TeamReport } from "../../lib/api";
import { personKey } from "./model";

export const STATUS_LABEL: Record<DayStatus, string> = {
  full: "Full day",
  half: "Half day",
  absent: "Absent",
  leave: "Leave",
  off: "Day off",
  holiday: "Holiday",
};

/** The pill colour class of each status (as on Rules › How a day counts). */
export const STATUS_TONE: Record<DayStatus, "ok" | "warn" | "red" | "grey"> = {
  full: "ok",
  half: "warn",
  absent: "red",
  leave: "grey",
  off: "grey",
  holiday: "grey",
};

export interface Attendance {
  /** person key → date → that day. */
  day: (key: string, date: string) => AttendanceDay | undefined;
  /** person key → their counts over the period. */
  counts: (key: string) => DayCounts | undefined;
  totals: DayCounts | null;
}

const ZERO: DayCounts = { full: 0, half: 0, absent: 0, leave: 0, off: 0, holiday: 0, late: 0 };

/** Everything the report says about day status; empty when the backend (or the plan) has none. */
export function attendanceOf(report: TeamReport): Attendance {
  const days = new Map<string, Map<string, AttendanceDay>>();
  const counts = new Map<string, DayCounts>();
  for (const p of report.attendance?.people ?? []) {
    const key = personKey(p.member_id, p.name);
    days.set(key, new Map(p.days.map((d) => [d.date, d])));
    counts.set(key, p.counts);
  }
  // One person's report: their days carry the status themselves.
  if (report.member && !days.size && report.person_days?.some((d) => d.status)) {
    const key = personKey(report.member.id, report.member.name);
    const own = new Map<string, AttendanceDay>();
    const c = { ...ZERO };
    for (const d of report.person_days ?? []) {
      if (!d.status) continue;
      own.set(d.date, { date: d.date, status: d.status, late: Boolean(d.late), worked_min: d.worked_min ?? 0, break_min: d.break_min ?? 0 });
      c[d.status] += 1;
      if (d.late) c.late += 1;
    }
    days.set(key, own);
    counts.set(key, c);
  }
  const totals = report.attendance?.totals ?? (counts.size === 1 ? [...counts.values()][0] : null);
  return { day: (key, date) => days.get(key)?.get(date), counts: (key) => counts.get(key), totals };
}

/** "Full day", "Half day · Late". */
export function statusText(d: AttendanceDay | undefined): string {
  if (!d) return "";
  return `${STATUS_LABEL[d.status]}${d.late ? " · Late" : ""}`;
}

/** The counts worth showing, in order: full, half, absent, leave, holiday, late (off days are left out). */
export function countParts(c: DayCounts, long = false): Array<{ k: DayStatus | "late"; text: string; tone: "ok" | "warn" | "red" | "grey" | "late" }> {
  const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;
  const out: Array<{ k: DayStatus | "late"; text: string; tone: "ok" | "warn" | "red" | "grey" | "late" }> = [];
  if (c.full) out.push({ k: "full", text: long ? n(c.full, "full day", "full days") : `${c.full} full`, tone: "ok" });
  if (c.half) out.push({ k: "half", text: long ? n(c.half, "half day", "half days") : `${c.half} half`, tone: "warn" });
  if (c.absent) out.push({ k: "absent", text: `${c.absent} absent`, tone: "red" });
  if (c.leave) out.push({ k: "leave", text: long ? `${c.leave} on leave` : `${c.leave} leave`, tone: "grey" });
  if (c.holiday) out.push({ k: "holiday", text: n(c.holiday, "holiday", "holidays"), tone: "grey" });
  if (c.late) out.push({ k: "late", text: `${c.late} late`, tone: "late" });
  return out;
}
