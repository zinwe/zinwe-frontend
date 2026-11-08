/**
 * Reports day status (v1.4 `attendance`), sample stand-in: only when samples are on AND the report came from a backend
 * without it. Worked out here from the report's own numbers with the default work hours (Mon to Sat, 10:00 to 19:00,
 * 15 min grace, 8 h full day, half day after 13:00 / before 14:00). No leave and no holidays. Production builds never
 * use it; with the v1.4 backend the server's answer is used as it is.
 */
import { WORK_HOURS_DEFAULTS, type AttendanceDay, type AttendancePerson, type DayCounts, type TeamReport } from "../../lib/api";
import { SAMPLES_ON } from "./index";

const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function dayOf(date: string, worked: number, breakSec: number, firstIn: number | null, lastOut: number | null, today: string): AttendanceDay | null {
  if (date > today) return null;
  const h = WORK_HOURS_DEFAULTS;
  const dow = (new Date(`${date}T00:00:00`).getDay() + 6) % 7;
  const working = h.days[dow] === "1";
  const late = working && firstIn !== null && firstIn > mins(h.start) + h.late_grace_min;
  const base = { date, late, worked_min: Math.round(worked / 60), break_min: Math.round(breakSec / 60) };
  if (!working) return { ...base, status: "off" };
  const full = h.full_day_hours * 3600;
  if (worked >= full && (firstIn ?? 0) <= mins(h.half_start_after) && (lastOut ?? 24 * 60) >= mins(h.half_end_before))
    return { ...base, status: "full" };
  if (worked >= full / 2) return { ...base, status: "half" };
  return { ...base, status: "absent" };
}

function countsOf(days: AttendanceDay[]): DayCounts {
  const c: DayCounts = { full: 0, half: 0, absent: 0, leave: 0, off: 0, holiday: 0, late: 0 };
  for (const d of days) {
    c[d.status] += 1;
    if (d.late) c.late += 1;
  }
  return c;
}

/** The report with a sample `attendance` added when samples are on and the backend sent none. */
export function withSampleAttendance(report: TeamReport, today: string): TeamReport {
  if (!SAMPLES_ON || report.attendance || report.person_days?.some((d) => d.status)) return report;
  if (report.member) {
    const own = new Map((report.person_days ?? []).map((d) => [d.date, d]));
    const person_days = report.daily.map((d) => {
      const x = own.get(d.date) ?? { ...d, worked_seconds: 0, break_seconds: 0, first_in: null, last_out: null };
      const s = dayOf(d.date, x.worked_seconds, x.break_seconds, x.first_in, x.last_out, today);
      return s ? { ...x, date: d.date, status: s.status, late: s.late, worked_min: s.worked_min, break_min: s.break_min } : x;
    });
    return { ...report, person_days };
  }
  const people: AttendancePerson[] = report.people
    .filter((p) => p.member_id !== null)
    .map((p) => {
      const days = report.daily
        .map((d) => {
          const x = d.by_person?.find((b) => b.member_id === p.member_id);
          return dayOf(d.date, x?.worked_seconds ?? 0, x?.break_seconds ?? 0, x?.first_in ?? null, x?.last_out ?? null, today);
        })
        .filter((x): x is AttendanceDay => x !== null);
      return { member_id: p.member_id, name: p.name, days, counts: countsOf(days) };
    });
  const totals = countsOf(people.flatMap((p) => p.days));
  return { ...report, attendance: { people, totals } };
}
