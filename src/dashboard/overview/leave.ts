/**
 * Leave requests in Overview → Needs you (v1.4.1): the words for a row. No runtime imports, so the unit tests run it
 * under plain Node. A leave `date` is a calendar day ("2026-11-12"), read as that day wherever the browser is.
 */
import type { Leave } from "../../lib/api/rules";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayOf(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** "today", "tomorrow", "Thu 12 Nov" (with the year when it isn't this one). */
export function leaveDay(iso: string, now: number): string {
  const d = dayOf(iso);
  if (!d) return iso;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  const year = d.getFullYear() !== today.getFullYear() ? ` ${d.getFullYear()}` : "";
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}${year}`;
}

/** "Sneha Reddy asked for a half day off on Thu 12 Nov" / "… a day off tomorrow". */
export function leaveTitle(l: Pick<Leave, "member_name" | "date" | "half">, now: number): string {
  const day = leaveDay(l.date, now);
  const when = day === "today" || day === "tomorrow" ? day : `on ${day}`;
  return `${(l.member_name ?? "").trim() || "Someone"} asked for ${l.half ? "a half day" : "a day"} off ${when}`;
}

/** The toast after a decision: "Approved. Sneha sees it in the Zinwe window." */
export function leaveDoneText(l: Pick<Leave, "member_name">, decision: "approve" | "decline"): string {
  const first = (l.member_name ?? "").trim().split(/\s+/)[0] || "They";
  return `${decision === "approve" ? "Approved" : "Declined"}. ${first} ${first === "They" ? "see" : "sees"} it in the Zinwe window.`;
}
