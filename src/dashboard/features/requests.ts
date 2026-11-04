import type { WorkLogEntry } from "../../lib/api";
import { formatTime } from "../alerts/alertModel";

/**
 * Requests waiting for the owner's OK (breaks, early End day) are listed on Overview, Today's activity and in the bell.
 * F-02: a decision made in one place hides the request in all of them at once (the shell keeps the decided ids), and a
 * person's second request of the same kind on the same day says so ("2nd break today · 2:10 PM"), so it doesn't read
 * like the one just approved coming back.
 */

export type Decision = "approved" | "denied";

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

function personKey(e: WorkLogEntry): string {
  return e.member_id != null ? `m${e.member_id}` : `d${e.device_id}`;
}

function dayOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Which of this person's requests of the same kind today `entry` is (1 = the first), counted from `entries`. */
export function requestNumber(entry: WorkLogEntry, entries: readonly WorkLogEntry[]): number {
  const who = personKey(entry);
  const day = dayOf(entry.at);
  const at = Date.parse(entry.at);
  const earlier = entries.filter(
    (e) => e.id !== entry.id && !!e.approval && e.state === entry.state && personKey(e) === who && dayOf(e.at) === day && Date.parse(e.at) < at,
  );
  return earlier.length + 1;
}

/** "2nd break today · 2:10 PM" for a second (or later) request of the same kind today; "" for the first. */
export function repeatLabel(entry: WorkLogEntry, entries: readonly WorkLogEntry[]): string {
  const n = requestNumber(entry, entries);
  if (n < 2) return "";
  const what = entry.state === "ended" ? "early End day" : "break";
  return `${ordinal(n)} ${what} today · ${formatTime(entry.at)}`;
}
