/** Report-schedule wording shared by Scheduled and Sent. */
import type { ReportFrequency, ReportSchedule } from "../../lib/api";
import { dMid, isoDay } from "./dates";

const FREQ_WORD: Record<ReportFrequency, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", custom: "Regular" };

/** "9:00 AM" */
export function clock(h: number, m = 0): string {
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** A send time from the API as "Today, 9:00 AM" / "Mon 2 Nov, 9:00 AM". */
export function whenText(iso: string, today: string): string {
  const d = new Date(iso);
  const day = isoDay(d);
  return `${day === today ? "Today" : dMid(day)}, ${clock(d.getHours(), d.getMinutes())}`;
}

/** "Weekly team report", "Monthly report · Priya Sharma". */
export function scheduleName(s: Pick<ReportSchedule, "frequency" | "member_name"> & { every_days?: number }): string {
  // "Pick dates" once (every_days 0, F-09): a one-time report.
  const word = s.frequency === "custom" && s.every_days === 0 ? "One-time" : FREQ_WORD[s.frequency];
  return s.member_name ? `${word} report · ${s.member_name}` : `${word} team report`;
}
