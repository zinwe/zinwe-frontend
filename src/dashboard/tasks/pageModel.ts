/**
 * Tasks page rules (boards LabDashTasks, DashTasks and LabPhoneChatTasks drawn with page="Tasks"): the plain
 * "Updated" words, the short second line, the phone groups and sub lines, and what dragging a task onto a group or
 * column means. Read-only helpers on TaskView; every change still goes through useTasks' taskActions.
 */
import { dayName, isFinished, isOverdue, NUDGEABLE, whenOf } from "./model";
import { addDays, todayIso, type TaskLogEntry, type TaskView } from "./types";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** When it ended: a task's approve / cancel line (else its last change), a to-do's done time (todoView's updatedAt). */
export function finishedAt(t: TaskView): number {
  if (t.own) return t.updatedAt;
  const end = [...t.log].reverse().find((e) => e.k === "approved" || e.k === "cancelled");
  return end ? end.at : t.updatedAt;
}

/** "8:34 AM" today, else "Yesterday, 4:10 PM" / "Tue 3 Nov, 4:10 PM". */
function whenWords(e: TaskLogEntry): string {
  return e.day === todayIso() ? e.time : whenOf(e);
}

/** The Updated column in plain words: what happened last, and when (with the detail that matters). */
export function lastParts(t: TaskView, first: string, pcOn: boolean): [string, string] {
  if (t.own) return t.status === "approved" ? ["Done", "In their Zinwe app"] : ["Own to-do", "Added in their Zinwe app"];
  const e = t.log[t.log.length - 1];
  if (!e) return ["", ""];
  const w = whenWords(e);
  const q = (n = 40) => (e.text ? ` · “${clip(e.text, n)}”` : "");
  switch (e.k) {
    case "sent":
      return ["Sent", `${w}${pcOn ? " · not opened yet" : " · PC offline"}`];
    case "seen":
      return ["Seen", `${w} · not confirmed yet`];
    case "confirmed":
      return ["Confirmed", w];
    case "started":
      return ["Started", w];
    case "step":
      return ["Ticked a step", `${w}${q(28)}`];
    case "unstep":
      return ["Unticked a step", `${w}${q(28)}`];
    case "help":
      return ["Asked for help", `${w}${q()}`];
    case "done":
      return ["Marked done", t.status === "review" ? `${w} · waiting for your OK` : w];
    case "note":
      return [`${first} added a note`, `${w}${q()}`];
    case "approved":
      return ["Approved by you", w];
    case "reopened":
      return ["Reopened by you", `${w} · back in ${first}’s list`];
    case "cancelled":
      return ["Cancelled", w];
    case "nudged":
      return ["Nudged", w];
    case "edited":
      return ["Edited", w];
    case "due":
      return ["Due moved", w];
    default:
      return [e.k, w];
  }
}

/** The short second line under a title: the first sentence of the details. */
export function shortLine(t: TaskView): string {
  const d = t.details.trim();
  if (!d) return "";
  const line = d.split("\n")[0];
  const end = /[.!?]\s/.exec(line);
  return (end ? line.slice(0, end.index + 1) : line).trim();
}

/** The next step still to tick (desktop list, under the progress bar). */
export function nextStep(t: TaskView): string {
  if (!t.steps.length) return "";
  if (isFinished(t)) return "All done";
  const s = t.steps.find((x) => !x.done);
  return s ? `Next: ${s.label}` : "All steps ticked";
}

// ---- Phone (LabPhoneChatTasks, page="Tasks") ----

export type PhoneGroupId = "late" | "mine" | "today" | "week" | "later" | "done";
export const PHONE_GROUPS: ReadonlyArray<{ id: PhoneGroupId; label: string; dot: string }> = [
  { id: "late", label: "Late", dot: "#C0331C" },
  { id: "mine", label: "Waiting on you", dot: "#F26A0A" },
  { id: "today", label: "Today", dot: "#F26A0A" },
  { id: "week", label: "This week", dot: "#6B6B6B" },
  { id: "later", label: "Later", dot: "#A3A3A3" },
  { id: "done", label: "Done", dot: "#17663F" },
];

const isDoneOnPhone = (t: TaskView) => t.status === "approved" || t.status === "cancelled";

/** Days from today to the end of this week (the week ends on Sunday). */
function daysToSunday(today: string): number {
  return (7 - new Date(`${today}T00:00:00`).getDay()) % 7;
}

/** Each task sits in one phone group: done, waiting on you, late, then by due day (no due date = Later). */
export function phoneGroupOf(t: TaskView, today = todayIso()): PhoneGroupId {
  if (isDoneOnPhone(t)) return "done";
  if (!t.own && (t.status === "review" || t.status === "help")) return "mine";
  if (isOverdue(t)) return "late";
  if (!t.due) return "later";
  if (t.due === today) return "today";
  return t.due <= addDays(today, daysToSunday(today)) ? "week" : "later";
}

const lowerDay = (iso: string) => {
  const d = dayName(iso);
  return d === "Today" || d === "Tomorrow" || d === "Yesterday" ? d.toLowerCase() : d;
};
const isoOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** The grey line under a phone row ("Was due …" is red: see `late`). */
export function phoneSub(t: TaskView, first: string): { text: string; late: boolean } {
  const who = t.own ? `${first} · Own to-do` : first;
  if (!t.own && t.status === "review") return { text: `${first} marked it done`, late: false };
  if (!t.own && t.status === "help") return { text: `${first} asked for help`, late: false };
  if (isDoneOnPhone(t)) {
    const word = t.own ? "Done" : t.status === "cancelled" ? "Cancelled" : "Approved";
    return { text: `${who} · ${word} ${lowerDay(isoOf(finishedAt(t)))}`, late: false };
  }
  if (!t.due) return { text: `${who} · No due date`, late: false };
  const late = isOverdue(t);
  return { text: `${who} · ${late ? "Was due" : "Due"} ${lowerDay(t.due)}${t.time ? `, ${t.time}` : ""}`, late };
}

/** The stage chip on a phone row: [label, background, text]. */
export function phoneChip(t: TaskView): [string, string, string] {
  if (t.own) return t.status === "approved" ? ["Done", "#141210", "#FFFFFF"] : t.status === "progress" ? ["In progress", "#FFF6EE", "#A84505"] : ["To do", "#F5F5F5", "#404040"];
  switch (t.status) {
    case "sent":
      return ["Sent", "#F5F5F5", "#404040"];
    case "seen":
      return ["Seen", "#F5F5F5", "#404040"];
    case "accepted":
      return ["Confirmed", "#F5F5F5", "#404040"];
    case "progress":
      return ["In progress", "#FFF6EE", "#A84505"];
    case "help":
      return ["Needs help", "#F26A0A", "#141210"];
    case "review":
      return ["Waiting for your OK", "#E3F4EA", "#17663F"];
    case "approved":
      return ["Approved", "#17663F", "#FFFFFF"];
    default:
      return ["Cancelled", "#F5F5F5", "#6B6B6B"];
  }
}

// ---- Desktop drag and drop (DashTasks + LabDashTasks verdicts) ----

/** What dropping a task on a group / column means: reorder there, approve, reopen, or the reason it can't. */
export type Verdict = { kind: "move" } | { kind: "approve" } | { kind: "reopen" } | { kind: "no"; why: string };

export type ListGroupId = "needs" | "overdue" | "today" | "later" | "done";

/** List groups: each task sits in the first group it fits (Needs you, Overdue, Today, Later, Done). */
export function listGroupOf(t: TaskView): ListGroupId {
  if (t.status === "review" || t.status === "help") return "needs";
  if (isOverdue(t)) return "overdue";
  if (t.due === todayIso() && !isFinished(t)) return "today";
  if (!isFinished(t)) return "later";
  return "done";
}

export type BoardLaneId = "todo" | "confirmed" | "progress" | "review" | "done";

export function boardLaneOf(t: TaskView): BoardLaneId {
  switch (t.status) {
    case "sent":
    case "seen":
      return "todo";
    case "accepted":
      return "confirmed";
    case "progress":
    case "help":
      return "progress";
    case "review":
      return "review";
    default:
      return "done";
  }
}

const own = (first: string): Verdict => ({ kind: "no", why: `This is ${first}’s own to-do. They move it from their Zinwe app.` });

/** Board: same column = your order; Waiting for your OK → Done approves; an approved task → In progress reopens. */
export function boardVerdict(t: TaskView, lane: BoardLaneId, first: string): Verdict {
  const from = boardLaneOf(t);
  if (from === lane) return { kind: "move" };
  if (t.own) return own(first);
  if (lane === "done" && t.status === "review") return { kind: "approve" };
  if (from === "done" && t.status === "cancelled") return { kind: "no", why: "It was cancelled. Open it to reopen it with a note." };
  if (from === "done" && lane === "progress") return { kind: "reopen" };
  if (from === "done") return { kind: "no", why: "Drag it back to In progress to reopen it." };
  if (lane === "done") return { kind: "no", why: `${first} hasn’t marked “${t.title}” done yet. You approve it once it’s waiting for your OK.` };
  if (lane === "review") return { kind: "no", why: `Only ${first} can mark a task done, from their Zinwe app.` };
  if (lane === "progress") return { kind: "no", why: from === "review" ? "It’s waiting for your OK. Approve it, or reopen it with a note." : `Only ${first} can start a task. Nudge them instead.` };
  if (lane === "confirmed") return { kind: "no", why: `Only ${first} can confirm a task, from their Zinwe app.` };
  return { kind: "no", why: "A task can’t go back to To do. Edit it, or cancel it and send a new one." };
}

/** List: same group = your order; Done approves a task waiting for your OK; an approved task leaves Done to reopen. */
export function listVerdict(t: TaskView, lane: ListGroupId, first: string): Verdict {
  const from = listGroupOf(t);
  if (from === lane) return { kind: "move" };
  if (t.own) return own(first);
  if (lane === "done" && t.status === "review") return { kind: "approve" };
  if (from === "done" && t.status === "cancelled") return { kind: "no", why: "It was cancelled. Open it to reopen it with a note." };
  if (from === "done" && lane !== "needs") return { kind: "reopen" };
  if (lane === "done") return { kind: "no", why: `${first} hasn’t marked “${t.title}” done yet. You approve it once it’s waiting for your OK.` };
  return { kind: "no", why: "Groups follow the due day and the stage. Drag inside a group to set your order." };
}

/** A member's own to-do: its grey tag. */
export const OWN_TAG = { background: "#F5F5F5", color: "#6B6B6B" };

/** The hint under a board column's name. */
export const BOARD_HINTS: Partial<Record<BoardLaneId, string>> = {
  todo: "Sent or seen, not confirmed yet",
  review: "Drag to Done to approve",
  done: "Drag back to In progress to reopen",
};

/** Which buttons a task gets (LabDashTasks): Approve + Reopen, Reopen, Reply, Nudge (late or not started), else Open. */
export function actionsOf(t: TaskView): { approve: boolean; reopen: boolean; reply: boolean; nudge: boolean; open: boolean } {
  if (t.own) return { approve: false, reopen: false, reply: false, nudge: false, open: false };
  const nudge = NUDGEABLE.includes(t.status) && (t.status === "sent" || t.status === "seen" || isOverdue(t));
  return {
    approve: t.status === "review",
    reopen: t.status === "review" || t.status === "approved",
    reply: t.status === "help",
    nudge,
    open: t.status !== "review" && t.status !== "help" && t.status !== "approved" && !nudge,
  };
}

