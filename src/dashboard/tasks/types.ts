/**
 * Tasks on the real API (FR-20 v2, lib/api/tasks.ts), shaped for the screens drawn from the DashTasks / DashChat
 * boards: the Tasks page, the task cards in Chat, Overview's Needs you rows and the Tasks badge.
 *
 * `toView` turns an API Task into a TaskView: the due date split into a local day + "5:00 PM" (or "" = any time that
 * day), the activity as log lines, and the latest note worth showing (their help request, their "done" note, your
 * reopen note). Every change goes through useTasks.ts → lib/api and then fires TASKS_CHANGED_EVENT so the menu badge,
 * Overview and other open views refresh at once.
 */
import type { Task, TaskStatus } from "../../lib/api";

export type { TaskStatus } from "../../lib/api";

export type TaskLogKind =
  | "sent"
  | "seen"
  | "confirmed"
  | "started"
  | "step"
  | "unstep"
  | "help"
  | "done"
  | "note"
  | "approved"
  | "reopened"
  | "cancelled"
  | "nudged"
  | "edited"
  | "due";

export interface TaskLogEntry {
  k: TaskLogKind;
  /** Local ISO day, yyyy-mm-dd. */
  day: string;
  /** "9:20 AM" */
  time: string;
  /** When, as epoch ms. */
  at: number;
  by: "owner" | "member";
  text?: string;
}

export interface TaskStep {
  id: number;
  label: string;
  done: boolean;
}

export interface TaskView {
  id: number;
  memberId: number;
  /** The person's full name. */
  name: string;
  title: string;
  details: string;
  /** Local ISO day; "" = no due date. */
  due: string;
  /** "5:00 PM", or "" (any time that day). */
  time: string;
  high: boolean;
  status: TaskStatus;
  steps: TaskStep[];
  /** The latest note worth showing (their help request or done note, your reopen note), and who wrote it. */
  note: string;
  noteBy: "You" | "them" | "";
  /** They confirmed it before starting (the stage bar shows a Confirmed step). */
  confirm: boolean;
  /** Every task needs your OK when done (FR-20 v2: done → waiting for your OK → approved). */
  needsOk: boolean;
  /** Members can't add tasks for themselves yet (kept for the board's wording). */
  byMember: boolean;
  edited: boolean;
  /** "2:10 PM" when you nudged them in the last hour (the API allows one nudge an hour), else "". */
  nudgedAt: string;
  log: TaskLogEntry[];
  createdAt: number;
  updatedAt: number;
  messageId: number | null;
  /** v1.3.5 (F-17): chat lines said about this task (its thread in Chat). */
  talkCount: number;
  /**
   * A member's own to-do from their Zinwe app, shown among the tasks (Tasks page): read-only, no drawer or actions.
   * Its id is the to-do's id negated, so it never clashes with a task's.
   */
  own?: boolean;
}

/** Stage labels and colours (shared by Tasks, Chat and Overview): [label, text colour, background]. */
export const TASK_STATUS: Record<TaskStatus, readonly [string, string, string]> = {
  sent: ["Sent", "#6B6B6B", "#F5F5F5"],
  seen: ["Seen", "#6B6B6B", "#F5F5F5"],
  accepted: ["Confirmed", "#404040", "#F5F5F5"],
  progress: ["In progress", "#8A3A04", "#FDEBDC"],
  help: ["Needs help", "#141210", "#F26A0A"],
  review: ["Done · waiting for your OK", "#17663F", "#E3F4EA"],
  approved: ["Approved", "#FFFFFF", "#17663F"],
  cancelled: ["Cancelled", "#6B6B6B", "#F5F5F5"],
};

export const TASK_SHORT: Record<TaskStatus, string> = {
  sent: "Sent",
  seen: "Seen",
  accepted: "Confirmed",
  progress: "In progress",
  help: "Needs help",
  review: "Waiting for your OK",
  approved: "Approved",
  cancelled: "Cancelled",
};

/** Board columns (DashTasks COLS). */
export const TASK_COLUMNS = [
  { id: "todo", label: "To do", dot: "#6B6B6B", has: ["sent", "seen"], empty: "Nothing new. Tasks you send land here." },
  { id: "confirmed", label: "Confirmed", dot: "#404040", has: ["accepted"], empty: "No one is waiting to start." },
  { id: "progress", label: "In progress", dot: "#F26A0A", has: ["help", "progress"], empty: "Nobody is on a task right now." },
  { id: "review", label: "Waiting for your OK", dot: "#17663F", has: ["review"], empty: "Nothing to approve." },
  { id: "done", label: "Done", dot: "#17663F", has: ["approved", "cancelled"], empty: "Nothing finished yet." },
] as const satisfies ReadonlyArray<{ id: string; label: string; dot: string; has: readonly TaskStatus[]; empty: string }>;

/** Nothing more for them to do: waiting for your OK, approved or cancelled. */
export const FINISHED: readonly TaskStatus[] = ["review", "approved", "cancelled"];
/** Not open any more. */
export const CLOSED: readonly TaskStatus[] = ["approved", "cancelled"];

/** Fired after any task change, so the menu badge and other open views refresh. */
export const TASKS_CHANGED_EVENT = "zinwe:tasks-changed";
export function tasksChanged(): void {
  window.dispatchEvent(new Event(TASKS_CHANGED_EVENT));
}

const pad = (n: number) => String(n).padStart(2, "0");
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}
export function todayIso(): string {
  return isoDay(new Date());
}

/** "5:00 PM" */
export function clockLabel(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

/** A due day + "5:00 PM" (or "" = the end of that day) as the API's ISO date-time, in this browser's time zone. */
export function dueAtOf(day: string, time: string): string | null {
  if (!day) return null;
  const [y, m, d] = day.split("-").map(Number);
  const hit = /^(\d+):(\d+)\s*(AM|PM)$/.exec(time || "");
  let h = 23;
  let min = 59;
  if (hit) {
    h = (Number(hit[1]) % 12) + (hit[3] === "PM" ? 12 : 0);
    min = Number(hit[2]);
  }
  return new Date(y, m - 1, d, h, min, 0, 0).toISOString();
}

/** The API's due_at as [local day, "5:00 PM" | ""]. 11:59 PM means "any time that day". */
export function dueParts(dueAt: string | null): [string, string] {
  if (!dueAt) return ["", ""];
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return ["", ""];
  const endOfDay = d.getHours() === 23 && d.getMinutes() === 59;
  return [isoDay(d), endOfDay ? "" : clockLabel(d)];
}

const KIND: Record<string, TaskLogKind> = {
  created: "sent",
  seen: "seen",
  accepted: "confirmed",
  started: "started",
  step_done: "step",
  step_undone: "unstep",
  help: "help",
  done: "done",
  note: "note",
  approved: "approved",
  reopened: "reopened",
  cancelled: "cancelled",
  nudged: "nudged",
  edited: "edited",
};

const NUDGE_EVERY_MS = 60 * 60 * 1000;

export function toView(t: Task, now = Date.now()): TaskView {
  const [due, time] = dueParts(t.due_at);
  const log: TaskLogEntry[] = t.activity.map((a) => {
    const at = new Date(a.at);
    const k = a.action === "edited" && a.note === "due_at" ? "due" : (KIND[a.action] ?? "edited");
    return { k, day: isoDay(at), time: clockLabel(at), at: at.getTime(), by: a.by, text: a.note || undefined };
  });
  // The note on the card: their help request while they need help, else the newest note-carrying line.
  let note = "";
  let noteBy: TaskView["noteBy"] = "";
  if (t.status === "help" && t.help_note) {
    note = t.help_note;
    noteBy = "them";
  } else {
    const hit = [...t.activity].reverse().find((a) => a.note && ["help", "done", "note", "reopened", "approved"].includes(a.action));
    if (hit) {
      note = hit.note;
      noteBy = hit.by === "owner" ? "You" : "them";
    }
  }
  const nudge = [...t.activity].reverse().find((a) => a.action === "nudged");
  const nudgedMs = nudge ? new Date(nudge.at).getTime() : 0;
  return {
    id: t.id,
    memberId: t.member_id,
    name: t.member_name,
    title: t.title,
    details: t.note,
    due,
    time,
    high: t.priority === "high",
    status: t.status,
    steps: t.steps.map((s) => ({ id: s.id, label: s.title, done: s.done })),
    note,
    noteBy,
    confirm: t.status === "accepted" || t.activity.some((a) => a.action === "accepted"),
    needsOk: true,
    byMember: false,
    edited: t.activity.some((a) => a.action === "edited"),
    nudgedAt: nudge && now - nudgedMs < NUDGE_EVERY_MS ? clockLabel(new Date(nudgedMs)) : "",
    log,
    createdAt: new Date(t.created_at).getTime(),
    updatedAt: new Date(t.updated_at).getTime(),
    messageId: t.message_id,
    talkCount: t.talk_count ?? 0,
  };
}
