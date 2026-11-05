import { useEffect, useRef, useState } from "react";
import { getWorkLog, type Message, type WorkLog } from "../../lib/api";
import { shiftDay, summarizeDay } from "../features/workDay";
import { isoDay, todayIso } from "../tasks/types";
import { clockTime } from "../ui/time";
import { decisionOf, type WorkDecision } from "./system";

/** How close the decision's time and its chat line are (decide_break saves one, then sends the other). */
const SAME_MS = 2 * 60 * 1000;
/** Days of work log one thread fetches at most. */
const MAX_DAYS = 12;

/** What the work log says about the break or End day a decision is about. */
export type WorkdaySpan =
  | { kind: "break"; start: string; end: string | null; seconds: number; memberNote: string }
  | { kind: "end"; at: string; reason: string; memberNote: string; workedSeconds: number | null };

/**
 * The work log of the days a thread's decisions fall on (the same API as Today's activity, getWorkLog per day and
 * member). A day that fails (plan history, an older API) stays null: its cards read from the chat line alone.
 */
export function useWorkLogs(memberId: number, lines: readonly Message[]): ReadonlyMap<string, WorkLog | null> {
  const [logs, setLogs] = useState<ReadonlyMap<string, WorkLog | null>>(() => new Map());
  // Days asked for (in flight or done), so each day is fetched once per open thread.
  const asked = useRef(new Set<string>());
  // The day each decision was sent; the day before only once the first day is in and doesn't have it.
  const days: string[] = [];
  for (const m of lines) {
    const d = decisionOf(m);
    if (!d) continue;
    const [day, before] = daysOf(m);
    days.push(day);
    if (logs.has(day) && !spanOf(m, d, memberId, logs)) days.push(before);
  }
  const key = [...new Set(days)].sort().join(",");

  useEffect(() => {
    const controller = new AbortController();
    const todo = (key ? key.split(",") : []).filter((d) => !asked.current.has(d)).slice(0, Math.max(0, MAX_DAYS - asked.current.size));
    const keep = (day: string, log: WorkLog | null) => setLogs((old) => new Map(old).set(day, log));
    for (const day of todo) {
      asked.current.add(day);
      getWorkLog({ date: day, member: memberId }, controller.signal).then(
        (log) => keep(day, log),
        () => {
          // Left before it came back: ask again next time.
          if (controller.signal.aborted) asked.current.delete(day);
          else keep(day, null);
        },
      );
    }
    return () => controller.abort();
  }, [memberId, key]);

  return logs;
}

/** The days a decision line may be about: the day it was sent, and the day before (decided the next morning). */
export function daysOf(m: Message): [string, string] {
  const day = isoDay(new Date(m.created_at));
  return [day, shiftDay(day, -1)];
}

/**
 * The break or End day this decision is about, from the work log: the change whose decision was saved with this
 * chat line, else the one that began at the time the line names. null when the log doesn't have it (yet).
 */
export function spanOf(m: Message, d: WorkDecision, memberId: number, logs: ReadonlyMap<string, WorkLog | null>): WorkdaySpan | null {
  const sent = Date.parse(m.created_at);
  for (const day of daysOf(m)) {
    const log = logs.get(day);
    if (!log) continue;
    const mine = log.entries.filter(
      (e) => e.member_id === memberId && e.state === (d.endDay ? "ended" : "on_break") && (d.endDay || (e.reason ?? "").trim().toLowerCase() === d.reason.toLowerCase()),
    );
    const hit =
      mine.find((e) => e.decided_at && Math.abs(Date.parse(e.decided_at) - sent) < SAME_MS) ?? mine.find((e) => clockTime(new Date(e.at)).toUpperCase() === d.when);
    if (!hit) continue;
    const person = summarizeDay(log, day === todayIso(), Date.now()).find((p) => p.memberId === memberId);
    if (d.endDay) {
      const out = person?.logouts.find((x) => x.id === hit.id);
      return { kind: "end", at: hit.at, reason: out?.reason ?? hit.reason ?? "", memberNote: (out?.note ?? hit.note ?? "").trim(), workedSeconds: person ? person.workedSeconds : null };
    }
    const b = person?.breaks.find((x) => x.id === hit.id);
    return { kind: "break", start: hit.at, end: b?.end ?? null, seconds: b?.seconds ?? 0, memberNote: (b?.note ?? hit.note ?? "").trim() };
  }
  return null;
}
