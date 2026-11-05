/**
 * DashActivity rules on top of features/workDay (FIX-011 totals, carried_in, "Didn't log out", "After midnight"):
 * the table columns, the day strip's segments and the timeline lines, in the board's words.
 */
import { BREAK_NOTE_MAX, breakNoteLength, type Member } from "../../lib/api";
import type { BreakSpan, LogoutSpan, PersonDay } from "../features/workDay";
import { shiftDay } from "../features/workDay";
import { ordinal } from "../features/requests";
import { dateOf, dayLong, dayMonthOnly, dayShort, firstName, hm, hmDuration, weekday } from "../team/format";

export type Approval = "" | "pending" | "approved" | "denied";

/** A decision made on this page (Undo for 6 s, then it is sent). */
export interface LocalDecision {
  val: "approved" | "denied";
  note: string;
  phase: "undo" | "sending" | "done";
}

export interface DayRow {
  key: string;
  memberId: number | null;
  name: string;
  first: string;
  pc: string;
  person: PersonDay | undefined;
}

/** Everyone that day: people with a work log, then active members with nothing logged ("Not in"). */
export function buildRows(people: readonly PersonDay[], members: readonly Member[]): DayRow[] {
  const seen = new Set(people.map((p) => p.memberId).filter((id): id is number => id !== null));
  const byId = new Map(members.map((m) => [m.id, m] as const));
  const rows: DayRow[] = people.map((p) => {
    const m = p.memberId != null ? byId.get(p.memberId) : undefined;
    const name = m?.name ?? p.name;
    return { key: p.key, memberId: p.memberId, name, first: firstName(name), pc: p.lastHostname, person: p };
  });
  for (const m of members) {
    if (!m.is_active || seen.has(m.id)) continue;
    rows.push({ key: `m${m.id}`, memberId: m.id, name: m.name, first: firstName(m.name), pc: m.device?.hostname ?? "No PC yet", person: undefined });
  }
  return rows;
}

export interface DayInfo {
  label: string;
  short: string;
  date: string;
  tip: string;
  title: string;
}

export function dayInfo(day: string, today: string): DayInfo {
  const d = dateOf(day);
  const diff = Math.round((dateOf(today).getTime() - d.getTime()) / 86_400_000);
  const date = dayLong(d);
  const tip = dayShort(d);
  if (diff <= 0) return { label: "Today", short: "today", date, tip, title: "Today’s activity" };
  if (diff === 1) return { label: "Yesterday", short: "yesterday", date, tip, title: "Yesterday’s activity" };
  if (diff < 7) {
    const w = weekday(d);
    return { label: w, short: w, date, tip, title: `${w}’s activity` };
  }
  const dm = dayMonthOnly(d);
  return { label: dm, short: dm, date, tip, title: `Activity on ${dm}` };
}

export type NowStatus = "working" | "break" | "out" | "notin" | "noend" | "midnight";

export const NOW_PILL: Record<NowStatus, { label: string; cls: string }> = {
  working: { label: "Working", cls: "green" },
  break: { label: "On break", cls: "amber" },
  out: { label: "Day ended", cls: "" },
  notin: { label: "Not in", cls: "" },
  noend: { label: "Didn't log out", cls: "amber" },
  midnight: { label: "After midnight", cls: "" },
};

export function nowStatus(p: PersonDay | undefined, isToday: boolean): NowStatus {
  if (!p) return "notin";
  if (isToday) {
    if (p.current === "working") return "working";
    if (p.current === "on_break") return "break";
    return p.current === "ended" ? "out" : "notin";
  }
  if (p.openEnded) return "noend";
  if (p.continues) return "midnight";
  return "out";
}

/** The "Took a break" column: "None", "1 · 40 min", or "1 · now, 42 min" while a break runs today. */
export function breaksCell(p: PersonDay | undefined, isToday: boolean): string {
  if (!p) return "—";
  if (p.breakCount === 0 && p.breakSeconds === 0) return "None";
  const open = isToday && p.current === "on_break" ? p.breaks.find((b) => !b.end) : undefined;
  if (open) return `${p.breakCount} · now, ${hmDuration(open.seconds, "0 min")}`;
  return `${p.breakCount} · ${hmDuration(p.breakSeconds, "0 min")}`;
}

/** The "Ended day" column and whether it has something to show on a phone card. */
export function endedCell(p: PersonDay | undefined, isToday: boolean): { text: string; warn: boolean; has: boolean } {
  if (!p) return { text: "—", warn: false, has: false };
  if (p.endedAt) return { text: hm(p.endedAt), warn: false, has: true };
  if (p.openEnded) return { text: "Didn't log out", warn: true, has: true };
  if (p.continues && !isToday) return { text: "After midnight", warn: false, has: true };
  return { text: "—", warn: false, has: false };
}

export function startedCell(p: PersonDay | undefined): string {
  if (!p) return "—";
  if (p.startedAt) return hm(p.startedAt);
  return p.carriedIn ? "From yesterday" : "—";
}

/** One thing waiting for (or just given) the owner's OK. */
export interface AskItem {
  id: number;
  kind: "break" | "logout";
  approval: Approval;
  decisionNote: string;
  /** "Lunch break since 1:38 PM · 42 min so far". */
  line: string;
  /** What the member wrote. */
  note: string;
  /** "lunch break" / "end of day", for button labels. */
  what: string;
}

export function askItems(p: PersonDay | undefined, isToday: boolean): AskItem[] {
  if (!p) return [];
  const brk = (b: BreakSpan, i: number): AskItem => {
    const name = b.reason ? `${b.reason} break` : "Break";
    // F-02: "2nd break today · …", so a new request doesn't read like the approved one coming back.
    const nth = i > 0 ? `${ordinal(i + 1)} break${isToday ? " today" : ""} · ` : "";
    const line =
      isToday && !b.end
        ? `${nth}${name} since ${hm(b.start)} · ${hmDuration(b.seconds, "0 min")} so far`
        : `${nth}${name} at ${hm(b.start)} · ${hmDuration(b.seconds, "0 min")}`;
    return { id: b.id, kind: "break", approval: b.approval, decisionNote: b.decisionNote, line, note: b.note, what: name.toLowerCase() };
  };
  const out = (l: LogoutSpan): AskItem => ({
    id: l.id,
    kind: "logout",
    approval: l.approval,
    decisionNote: l.decisionNote,
    line: `Ended day${l.reason ? ` (${l.reason})` : ""}, ${hm(l.at)}`,
    note: l.note,
    what: "end of day",
  });
  return [...p.breaks.map((b, i) => brk(b, i)), ...p.logouts.map(out)];
}

export interface Segment {
  kind: "work" | "break";
  why: string;
  /** Minutes after this day's midnight. */
  from: number;
  to: number;
  live: boolean;
  /** Break waiting for the owner's OK. */
  waiting: boolean;
}

function minutesOf(iso: string, day: string): number {
  return Math.max(0, Math.min(1440, (Date.parse(iso) - dateOf(day).getTime()) / 60_000));
}

/** The day strip: working and break stretches from the same timeline as the list below it. */
export function segmentsOf(p: PersonDay | undefined, day: string, isToday: boolean, nowMs: number): Segment[] {
  if (!p) return [];
  const items = p.timeline;
  const segs: Segment[] = [];
  const nowMin = minutesOf(new Date(nowMs).toISOString(), day);
  items.forEach((item, i) => {
    const state = item.kind === "carry" ? item.state : item.kind === "break" ? "on_break" : item.kind === "end" ? "ended" : "working";
    if (state === "ended") return;
    const from = item.kind === "carry" ? 0 : minutesOf(item.at, day);
    const next = items[i + 1];
    // A PC that had gone quiet before the day moved on stops where it left off (the server counts it that way too).
    const to = next ? minutesOf(next.leftOff ?? next.at, day) : isToday ? nowMin : p.continues ? 1440 : null;
    if (to === null || to < from) return;
    const brk = state === "on_break" ? p.breaks.find((b) => b.start === item.at) : undefined;
    segs.push({
      kind: state === "on_break" ? "break" : "work",
      why: item.reason || "Break",
      from,
      to,
      live: !next && isToday,
      waiting: brk?.approval === "pending",
    });
  });
  return segs;
}

/** The person card's two small tiles: time worked and time on breaks, added up from the strip's own parts. */
export interface DaySums {
  /** Minutes, each part rounded the way its hover shows it, so the tile is the sum of what the strip says. */
  workMin: number;
  breakMin: number;
  /** Every break they took (as the timeline lists them), including one whose time isn't counted (no log-out after it). */
  breaks: number;
}

export function sumsOf(p: PersonDay, segs: readonly Segment[]): DaySums {
  const sums: DaySums = { workMin: 0, breakMin: 0, breaks: 0 };
  for (const s of segs) {
    const m = Math.max(0, Math.round(s.to - s.from));
    if (s.kind === "work") sums.workMin += m;
    else sums.breakMin += m;
  }
  sums.breaks = p.timeline.filter((i) => i.kind === "break" || (i.kind === "carry" && i.state === "on_break")).length;
  return sums;
}

/** The strip's window: 9 AM to 7 PM, widened to whole hours when the day ran outside it. */
export function windowOf(segs: readonly Segment[], nowMin: number | null): { d0: number; d1: number; ticks: number[] } {
  let d0 = 9 * 60;
  let d1 = 19 * 60;
  for (const s of segs) {
    d0 = Math.min(d0, Math.floor(s.from / 60) * 60);
    d1 = Math.max(d1, Math.ceil(s.to / 60) * 60);
  }
  if (nowMin !== null && segs.length) d1 = Math.max(d1, Math.ceil(nowMin / 60) * 60);
  d0 = Math.max(0, d0);
  d1 = Math.min(1440, Math.max(d1, d0 + 60));
  // 9 AM–7 PM shows 12 PM and 3 PM (the board); a longer day steps by 6 hours so labels never collide.
  const span = d1 - d0;
  const step = span <= 12 * 60 ? 180 : 360;
  const gap = Math.max(90, span * 0.12);
  const ticks: number[] = [];
  for (let h = Math.ceil(d0 / step) * step; h < d1; h += step) {
    if (h - d0 >= gap && d1 - h >= gap) ticks.push(h);
  }
  return { d0, d1, ticks };
}

export function lengthLabel(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
}

/**
 * Keep a decision note within BREAK_NOTE_MAX as the API counts it (code points after trimming, FIX-012), so an
 * emoji counts once and leading or trailing spaces don't count. Longer text is cut, not refused.
 */
export function clampNote(value: string): string {
  if (breakNoteLength(value) <= BREAK_NOTE_MAX) return value;
  const start = value.length - value.trimStart().length;
  return value.slice(0, start) + [...value.slice(start)].slice(0, BREAK_NOTE_MAX).join("");
}

/** Phone filter sheet: today and the two days before, inside the plan's history. */
export function dayOptions(
  today: string,
  earliest: string | undefined,
  current: string,
): { day: string; label: string; tip: string; on: boolean }[] {
  return [0, -1, -2]
    .map((n) => shiftDay(today, n))
    .filter((d) => earliest === undefined || d >= earliest)
    .map((d) => ({ day: d, label: dayInfo(d, today).label, tip: dayShort(dateOf(d)), on: d === current }));
}
