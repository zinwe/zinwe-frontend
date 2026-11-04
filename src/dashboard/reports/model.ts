/**
 * Turns a real TeamReport (GET reports/) into what the Reports board draws: one stacked column per day
 * (per hour for a single day), one segment per person, each person in their own colour.
 */
import type { Member, ReportDay, ReportDayPerson, ReportPerson, TeamReport } from "../../lib/api";
import { hourLbl, MON, toDate, WD } from "./dates";

/** One colour per person in "Who worked when": orange plus warm neutrals only (brand rule). An ordered run from
 *  deep orange through tints to stone greys and ink; segments stack in this order, so every touching pair is a
 *  palette neighbour. Checked with the dataviz validator on white: adjacent pairs dE >= 18 normal vision and
 *  >= 16 under protan / deutan. The pale slots sit under 3:1 on white, so the legend, tooltip and table carry
 *  the names and values too. */
export const COLORS = ["#9C3A0A", "#F26A0A", "#FDBA8C", "#7A7470", "#D6D3D1", "#44403C", "#A8A29E", "#141210", "#F7D8BF", "#5E3418"] as const;

export type Metric = "worked" | "active";

/** Who a row / segment / legend chip is: "m12" for a member, "n:<name>" for a PC not linked to anyone. */
export function personKey(memberId: number | null | undefined, name: string): string {
  return memberId ? `m${memberId}` : `n:${name}`;
}

/** One person's whole day: what the hover card shows. */
export interface DayFacts {
  key: string;
  memberId: number | null;
  name: string;
  date: string;
  worked: number;
  active: number;
  breakSec: number;
  breaks: number;
  dataBytes: number;
  alerts: number;
  firstIn: number | null;
  lastOut: number | null;
}

export interface Segment {
  facts: DayFacts;
  /** Seconds this segment stands for (the day, or that hour). */
  value: number;
}

export interface Column {
  /** Axis label ("" when skipped). */
  label: string;
  /** Tooltip day line: "Wed, 28 Oct" (+ " · 9 AM to 10 AM" for an hour). */
  day: string;
  date: string;
  segs: Segment[];
  total: number;
}

/** A person's colour, plus their place in the report (0 = most worked) that the colour was picked from. */
export type ColorOf = ((key: string) => string) & { rank: (key: string) => number };

/** Colours for one report period, by rank: the people in the report by worked time, highest first (ties in the
 *  team's order), then the rest of the team. So the top 10 always wear the 10 distinct colours, the top 9 keep
 *  them in "Who worked when" (everyone after is "Others"), and By person / Performance share the same map; past
 *  the 10th the colours repeat there, next to the names. */
export function colorMap(members: readonly Member[] | undefined, report: TeamReport | undefined): ColorOf {
  const team = (members ?? []).filter((m) => m.is_active).map((m) => `m${m.id}`);
  const teamPos = new Map(team.map((k, i) => [k, i]));
  const here = (report?.people ?? []).map((p, i) => ({ key: personKey(p.member_id, p.name), worked: p.worked_seconds, i }));
  here.sort(
    (a, b) =>
      b.worked - a.worked || (teamPos.get(a.key) ?? team.length + a.i) - (teamPos.get(b.key) ?? team.length + b.i),
  );
  const order: string[] = [];
  for (const h of here) if (!order.includes(h.key)) order.push(h.key);
  for (const k of team) if (!order.includes(k)) order.push(k);
  const rank = (key: string) => {
    let i = order.indexOf(key);
    if (i < 0) {
      order.push(key);
      i = order.length - 1;
    }
    return i;
  };
  return Object.assign((key: string) => COLORS[rank(key) % COLORS.length], { rank });
}

function factsOf(p: ReportDayPerson, date: string): DayFacts {
  return {
    key: personKey(p.member_id, p.name),
    memberId: p.member_id,
    name: p.name,
    date,
    worked: p.worked_seconds,
    active: p.active_seconds,
    breakSec: p.break_seconds,
    breaks: p.breaks,
    dataBytes: p.data_bytes,
    alerts: p.alerts,
    firstIn: p.first_in,
    lastOut: p.last_out,
  };
}

/** Everyone's facts for each day of the period (team: by_person; one person: their own days). */
function dayFacts(report: TeamReport): Array<{ date: string; people: DayFacts[] }> {
  if (report.member) {
    const m = report.member;
    const own = new Map((report.person_days ?? []).map((d) => [d.date, d]));
    return report.daily.map((d: ReportDay) => {
      const x = own.get(d.date) ?? d;
      const f: DayFacts = {
        key: personKey(m.id, m.name),
        memberId: m.id,
        name: m.name,
        date: d.date,
        worked: x.worked_seconds,
        active: x.active_seconds,
        breakSec: x.break_seconds,
        breaks: x.breaks,
        dataBytes: x.data_bytes,
        alerts: x.alerts,
        firstIn: x.first_in,
        lastOut: x.last_out,
      };
      return { date: d.date, people: [f] };
    });
  }
  return report.daily.map((d) => ({ date: d.date, people: (d.by_person ?? []).map((p) => factsOf(p, d.date)) }));
}

const HOURS_FROM = 7;
const HOURS_TO = 19;

/**
 * One day: spread each person's time over the hours they were there (first log-in to last log-out), never more
 * than the minutes they were there in an hour, with lunch (1 PM) counted lighter, the same rule as the board.
 * The API gives the day's totals and start / finish; the hour split is drawn from those.
 */
function spread(total: number, start: number, finish: number, hours: number[]): number[] {
  const ov = hours.map((h) => Math.max(0, Math.min(finish, (h + 1) * 60) - Math.max(start, h * 60)) * 60);
  const wts = ov.map((o, k) => o * (hours[k] === 13 ? 0.45 : 1));
  const out = hours.map(() => 0);
  let left = total;
  for (let pass = 0; pass < 6 && left > 0.5; pass++) {
    const open = wts.map((w, k) => (out[k] < ov[k] - 1e-6 ? w : 0));
    const sw = open.reduce((t, x) => t + x, 0);
    if (!sw) break;
    let used = 0;
    open.forEach((w, k) => {
      if (!w) return;
      const add = Math.min(ov[k] - out[k], (left * w) / sw);
      out[k] += add;
      used += add;
    });
    left -= used;
  }
  return out;
}

export function buildColumns(report: TeamReport, metric: Metric): { columns: Column[]; hourly: boolean } {
  const days = dayFacts(report);
  const val = (f: DayFacts) => (metric === "worked" ? f.worked : f.active);
  const hourly = days.length === 1;

  if (hourly) {
    const d = days[0];
    const timed = d.people.filter((f) => f.firstIn !== null && f.lastOut !== null && val(f) > 0);
    let lo = HOURS_FROM;
    let hi = HOURS_TO;
    for (const f of timed) {
      const s = f.firstIn ?? 0;
      const e = Math.max(s, (f.lastOut ?? 0) < s ? 24 * 60 : (f.lastOut ?? 0));
      lo = Math.min(lo, Math.floor(s / 60));
      hi = Math.max(hi, Math.min(23, Math.ceil(e / 60) - 1));
    }
    const hours = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    const per = timed.map((f) => {
      const s = f.firstIn ?? 0;
      const e = (f.lastOut ?? 0) < s ? 24 * 60 : (f.lastOut ?? 0);
      return { f, parts: spread(val(f), s, e, hours) };
    });
    const dt = toDate(d.date);
    const tipDate = `${WD[dt.getDay()]}, ${dt.getDate()} ${MON[dt.getMonth()]}`;
    const columns = hours.map((h, k) => {
      const segs = per.map(({ f, parts }) => ({ facts: f, value: parts[k] })).filter((s) => s.value >= 30);
      return {
        label: hourLbl(h),
        day: `${tipDate} · ${hourLbl(h)} to ${hourLbl(h + 1)}`,
        date: d.date,
        segs,
        total: segs.reduce((t, s) => t + s.value, 0),
      };
    });
    return { columns, hourly };
  }

  const n = days.length;
  const every = n > 16 ? 3 : 1;
  const columns = days.map((d, k) => {
    const dt = toDate(d.date);
    const dom = dt.getDate();
    const label = n <= 10 ? `${WD[dt.getDay()]} ${dom}` : k === 0 || dom === 1 ? `${dom} ${MON[dt.getMonth()]}` : String(dom);
    const segs = d.people.map((f) => ({ facts: f, value: val(f) })).filter((s) => s.value >= 30);
    return {
      label: k % every === 0 ? label : "",
      day: `${WD[dt.getDay()]}, ${dom} ${MON[dt.getMonth()]}`,
      date: d.date,
      segs,
      total: segs.reduce((t, s) => t + s.value, 0),
    };
  });
  return { columns, hourly };
}

/** The By person row of the report for a person key. */
export function rowKey(p: ReportPerson): string {
  return personKey(p.member_id, p.name);
}
