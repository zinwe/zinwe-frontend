/**
 * Team tasks v1.4 — the task engine, ported from the prototype (zinwe-wt/_v14/logic/panel.js, quickadd.js, page.js).
 *
 * Pure functions over a TTask (the API's TeamTaskJson, normalised with the people directory): the "What's happening"
 * sentence and its buttons for every state (owner and member wording), the status pill, the journey bar, each
 * person's state word, the steps relay, due chips, lanes, and the quick-add parser. Wording is copied from the
 * prototype; keep it plain and short.
 */
import type { Member, TeamTaskActivityJson, TeamTaskJson, TeamTaskRepeat, TeamTaskStatus, TaskGroupJson, TaskPersonState } from "../../lib/api";
import { MEMBER_ROLES } from "../../lib/api";

// ---------------------------------------------------------------------------------------------------------------
// People and groups
// ---------------------------------------------------------------------------------------------------------------

export interface Person {
  /** "m<member id>" for a member, "me" for the owner. */
  key: string;
  memberId: number | null;
  name: string;
  first: string;
  ini: string;
  /** Avatar background. */
  av: string;
  fg?: string;
  /** Department label ("Developer", "Design"…), "" = not set. */
  role: string;
  pc: "online" | "offline" | "";
  /** "2:30 PM" (offline since), "" otherwise. */
  pcSince: string;
}

export interface Group {
  id: number;
  key: string;
  name: string;
  people: string[];
}

export interface Directory {
  /** Everyone by key, the owner as "me". */
  byKey: Record<string, Person>;
  /** The team (not the owner), A–Z by name. */
  list: Person[];
  groups: Group[];
  owner: Person;
}

const TINTS = ["#FDEBDC", "#FFF1E4", "#EEEEEE", "#E3F4EA", "#F5F5F5"] as const;

export const keyOf = (memberId: number): string => `m${memberId}`;
export const memberIdOf = (key: string | null | undefined, dir: Directory): number | null =>
  key ? (dir.byKey[key]?.memberId ?? (/^m\d+$/.test(key) ? Number(key.slice(1)) : null)) : null;

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
}

const roleLabel = (role: string | undefined): string => MEMBER_ROLES.find((r) => r.value === role)?.label ?? "";

export function personOfMember(m: Pick<Member, "id" | "name"> & Partial<Pick<Member, "role" | "device">>, i = 0): Person {
  const name = m.name.trim() || "Someone";
  const dev = m.device ?? null;
  const pc: Person["pc"] = dev ? (dev.is_online ? "online" : "offline") : "";
  return {
    key: keyOf(m.id),
    memberId: m.id,
    name,
    first: name.split(/\s+/)[0],
    ini: initialsOf(name),
    av: TINTS[(m.id + i) % TINTS.length],
    role: roleLabel(m.role ?? ""),
    pc,
    pcSince: pc === "offline" && dev?.last_seen_at ? clock(Date.parse(dev.last_seen_at)) : "",
  };
}

/** The directory from the team, the groups, and the people named on tasks (so a removed member still has a name). */
export function buildDirectory(
  members: ReadonlyArray<Pick<Member, "id" | "name" | "is_active"> & Partial<Pick<Member, "role" | "device">>> | undefined,
  groups: readonly TaskGroupJson[],
  tasks: readonly TeamTaskJson[],
  ownerName: string,
): Directory {
  const byKey: Record<string, Person> = {};
  (members ?? []).forEach((m) => {
    byKey[keyOf(m.id)] = personOfMember(m);
  });
  tasks.forEach((t) =>
    peopleRowsOf(t).forEach((p) => {
      if (!byKey[keyOf(p.member_id)]) byKey[keyOf(p.member_id)] = { ...personOfMember({ id: p.member_id, name: p.name }), pc: "" };
    }),
  );
  const oName = ownerName.trim() || "You";
  const owner: Person = { key: "me", memberId: null, name: oName, first: oName.split(/\s+/)[0], ini: initialsOf(oName), av: "#141210", fg: "#fff", role: "Owner", pc: "online", pcSince: "" };
  byKey.me = owner;
  const active = new Set((members ?? []).filter((m) => m.is_active).map((m) => keyOf(m.id)));
  const list = Object.values(byKey)
    .filter((p) => p.key !== "me" && (active.size === 0 || active.has(p.key)))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    byKey,
    list,
    owner,
    groups: groups.map((g) => ({ id: g.id, key: `g${g.id}`, name: g.name, people: g.member_ids.map(keyOf).filter((k) => !!byKey[k]) })),
  };
}

export function personIn(dir: Directory, k: string | null | undefined): Person {
  return (k && dir.byKey[k]) || { key: k ?? "", memberId: null, name: "Anyone", first: "Anyone", ini: "", av: "#fff", role: "", pc: "", pcSince: "" };
}

export function groupIn(dir: Directory, key: string | number | null | undefined): Group | null {
  if (key == null) return null;
  return dir.groups.find((g) => g.key === key || g.id === key || g.name === key) ?? null;
}

/** "Priya", "Priya and Karan", "Priya, Karan and Emily". */
export function listWords(names: readonly string[]): string {
  const n = names.filter(Boolean);
  if (n.length <= 1) return n[0] ?? "";
  return `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}
export const namesOf = (dir: Directory, keys: readonly string[]): string => listWords(keys.map((k) => personIn(dir, k).first));

// ---------------------------------------------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------------------------------------------

const DAY = 86_400_000;
/** "8:34 AM" */
export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}
function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
/** Calendar days from today to `ms` (0 = today, -1 = yesterday). */
export function dayDiff(ms: number, now: number): number {
  return Math.round((startOfDay(ms) - startOfDay(now)) / DAY);
}
/** "Mon 9 Nov" */
export function dayLabel(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString("en-GB", { weekday: "short" })} ${d.getDate()} ${d.toLocaleDateString("en-GB", { month: "short" })}`;
}
/** The day `d` days from today, at 00:00. */
export function dayAt(d: number, now: number): number {
  const x = new Date(startOfDay(now));
  x.setDate(x.getDate() + d);
  return x.getTime();
}
/** Labels for the day `d` days from today: label "Mon 9 Nov", word "Today", rel "today". */
export function dayWords(d: number, now: number): { label: string; word: string; rel: string } {
  const label = dayLabel(dayAt(d, now));
  const word = d === 0 ? "Today" : d === 1 ? "Tomorrow" : d === -1 ? "Yesterday" : label;
  return { label, word, rel: d === 0 ? "today" : d === 1 ? "tomorrow" : d === -1 ? "yesterday" : label };
}
/** Journey / chat times: "8:34 AM" today, "Thu 9:10 AM" this week, "Thu 5 Nov, 9:10 AM" before. */
export function when(ms: number | null | undefined, now: number): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  const d = dayDiff(ms, now);
  if (d === 0) return clock(ms);
  if (d > -7 && d < 0) return `${new Date(ms).toLocaleDateString("en-GB", { weekday: "short" })} ${clock(ms)}`;
  return `${dayLabel(ms)}, ${clock(ms)}`;
}
/** Meta line times: "Thu 5 Nov, 9:10 AM"; "today, 3:01 PM" for today. */
export function whenLong(ms: number | null | undefined, now: number): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  return dayDiff(ms, now) === 0 ? `today, ${clock(ms)}` : `${dayLabel(ms)}, ${clock(ms)}`;
}
/** "6:00 PM" → minutes after midnight. */
export function minutesOf(time: string): number | null {
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(time || "");
  if (!m) return null;
  return ((Number(m[1]) % 12) + (/pm/i.test(m[3]) ? 12 : 0)) * 60 + Number(m[2]);
}
/** "6:00 PM" from minutes after midnight. */
export function timeOf(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const mm = min % 60;
  return `${h % 12 || 12}:${mm < 10 ? "0" : ""}${mm} ${h >= 12 ? "PM" : "AM"}`;
}
/** A day offset + "6:00 PM" (or "Any time" = 11:59 PM, the API's "any time that day") as ISO. */
export function dueIso(d: number, time: string, now: number): string {
  const day = new Date(dayAt(d, now));
  const min = time && time !== "Any time" ? minutesOf(time) : null;
  if (min == null) day.setHours(23, 59, 0, 0);
  else day.setHours(Math.floor(min / 60), min % 60, 0, 0);
  return day.toISOString();
}

// ---------------------------------------------------------------------------------------------------------------
// The task, as the screens read it
// ---------------------------------------------------------------------------------------------------------------

export type Status = Exclude<TeamTaskStatus, "accepted">;

export interface TStep {
  id: number | null;
  text: string;
  owner: string | null;
  done: boolean;
  at: number | null;
  by: string | null;
}
export interface TRun {
  key: string;
  state: TaskPersonState;
  seenAt: number | null;
  doneAt: number | null;
}
export interface TNote {
  who: string;
  text: string;
  at: number | null;
}
export interface TEvent {
  text: string;
  at: number;
}
export interface TTask {
  id: number;
  title: string;
  details: string;
  people: string[];
  runs: Record<string, TRun>;
  mode: "all" | "any";
  inOrder: boolean;
  status: Status;
  dueAt: number | null;
  anyTime: boolean;
  high: boolean;
  group: { id: number; name: string } | null;
  repeat: TeamTaskRepeat;
  nextOn: number | null;
  sentAt: number;
  /** Journey times: sent, seen, working, done, your OK. */
  j: Array<number | null>;
  steps: TStep[];
  help: TNote | null;
  cantdo: TNote | null;
  reopenNote: string;
  /** Nudged in the last hour (the API allows one nudge an hour per task). */
  nudgedAt: number | null;
  editedAt: number | null;
  approvedAt: number | null;
  cancelledAt: number | null;
  /** Journey stage reached before it was cancelled. */
  prevIdx: number;
  took: string;
  replied: number | null;
  chat: { count: number; unread: number; last: { key: string | null; name: string; text: string; at: number | null } | null };
  events: TEvent[];
  updatedAt: number;
  raw: TeamTaskJson;
}

/** The task's people rows, also from an older backend (one person: member_id / member_name). */
export function peopleRowsOf(t: TeamTaskJson): Array<{ member_id: number; name: string; state: TaskPersonState; seen_at: string | null; done_at: string | null }> {
  if (t.people?.length) return t.people;
  const id = t.member_id ?? t.member;
  if (id == null) return [];
  const st = t.status;
  const state: TaskPersonState =
    st === "help" ? "help" : st === "cantdo" ? "cantdo" : st === "review" || st === "approved" ? "done" : st === "progress" ? "progress" : st === "sent" ? "sent" : "seen";
  return [{ member_id: id, name: t.member_name ?? "", state, seen_at: null, done_at: null }];
}

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const v = Date.parse(iso);
  return Number.isFinite(v) ? v : null;
};
const lastOf = (rows: TeamTaskActivityJson[], ...actions: string[]) => [...rows].reverse().find((a) => actions.includes(a.action));
const NUDGE_EVERY = 60 * 60 * 1000;

function took(from: number, to: number): string {
  const h = Math.max(1, Math.round((to - from) / 3_600_000));
  if (h < 24) return h === 1 ? "1 h" : `${h} h`;
  const d = Math.max(1, Math.round(h / 24));
  return d === 1 ? "1 day" : `${d} days`;
}

/** TeamTaskJson → TTask (the people keys, notes, journey times and the activity in words). */
export function toTask(raw: TeamTaskJson, dir: Directory, now: number): TTask {
  const rows = peopleRowsOf(raw);
  const people = rows.map((p) => keyOf(p.member_id));
  const runs: Record<string, TRun> = {};
  rows.forEach((p) => {
    runs[keyOf(p.member_id)] = { key: keyOf(p.member_id), state: p.state, seenAt: ms(p.seen_at), doneAt: ms(p.done_at) };
  });
  const act = raw.activity ?? [];
  const actKey = (a: TeamTaskActivityJson | undefined): string | null => {
    if (!a) return null;
    if (a.member_id != null) return keyOf(a.member_id);
    if (a.by === "owner") return "me";
    return people.length === 1 ? people[0] : null;
  };
  const status: Status = raw.status === "accepted" ? "seen" : raw.status;
  const dueAt = ms(raw.due_at);
  const anyTime = dueAt != null && new Date(dueAt).getHours() === 23 && new Date(dueAt).getMinutes() === 59;
  const steps: TStep[] = (raw.steps ?? []).map((s) => ({
    id: s.id,
    text: s.title,
    owner: s.owner_id != null ? keyOf(s.owner_id) : null,
    done: s.done,
    at: ms(s.done_at),
    by: s.done_by_id != null ? keyOf(s.done_by_id) : null,
  }));
  const whoIn = (state: TaskPersonState, action: string): string => {
    const r = rows.find((p) => p.state === state);
    if (r) return keyOf(r.member_id);
    return actKey(lastOf(act, action)) ?? people[0] ?? "";
  };
  const helpA = lastOf(act, "help");
  const cantA = lastOf(act, "cantdo");
  const help = status === "help" ? { who: whoIn("help", "help"), text: raw.help_note || helpA?.note || "", at: ms(helpA?.at) } : null;
  const cantdo = status === "cantdo" ? { who: whoIn("cantdo", "cantdo"), text: raw.cantdo_note || cantA?.note || "", at: ms(cantA?.at) } : null;
  const reopenA = lastOf(act, "reopened");
  const nudge = raw.nudged_at !== undefined ? ms(raw.nudged_at) : ms(lastOf(act, "nudged")?.at);
  const approvedAt = status === "approved" ? (ms(lastOf(act, "approved")?.at) ?? ms(raw.updated_at)) : null;
  const cancelledAt = status === "cancelled" ? (ms(lastOf(act, "cancelled")?.at) ?? ms(raw.updated_at)) : null;
  const sentAt = ms(raw.created_at) ?? now;
  const since = reopenA ? Date.parse(reopenA.at) : 0;
  const after = act.filter((a) => Date.parse(a.at) >= since);

  // Journey: sent · seen · working · done · your OK
  const seenTimes = rows.map((p) => ms(p.seen_at)).filter((x): x is number => x != null);
  const firstSeenA = ms(act.find((a) => a.action === "seen" || a.action === "accepted")?.at);
  const seen = status === "sent" ? null : seenTimes.length === rows.length && seenTimes.length ? Math.max(...seenTimes) : (seenTimes.length ? Math.min(...seenTimes) : firstSeenA);
  const workA = act.find((a) => ["started", "step_done", "taken", "help", "cantdo", "done"].includes(a.action));
  const working = ["sent", "seen"].includes(status) ? null : (ms(workA?.at) ?? seen ?? sentAt);
  const doneTimes = rows.map((p) => ms(p.done_at)).filter((x): x is number => x != null);
  const doneA = lastOf(after, "done", "review");
  const doneAt = status === "review" || status === "approved" ? (doneTimes.length ? Math.max(...doneTimes) : (ms(doneA?.at) ?? ms(raw.updated_at))) : null;
  const j = [sentAt, seen, working, doneAt, approvedAt];

  let prevIdx = 1;
  if (status === "cancelled") {
    const before = act.filter((a) => a.action !== "cancelled");
    prevIdx = before.some((a) => a.action === "done" || a.action === "review")
      ? 3
      : before.some((a) => ["started", "step_done", "help", "cantdo", "taken"].includes(a.action))
        ? 2
        : before.some((a) => a.action === "seen" || a.action === "accepted")
          ? 1
          : 0;
  }
  const repliedA = lastOf(act, "replied");
  const lastAsk = lastOf(act, "help", "cantdo");
  const replied = repliedA && (!lastAsk || Date.parse(repliedA.at) >= Date.parse(lastAsk.at)) ? ms(repliedA.at) : null;

  const chatRaw = raw.chat ?? { count: raw.talk_count ?? 0, unread: 0, last: null };
  const lastBy = chatRaw.last?.by ?? "";
  const lastKey = chatRaw.last
    ? (Object.values(dir.byKey).find((p) => p.first === lastBy || p.name === lastBy)?.key ?? (/^(you|owner)$/i.test(lastBy) ? "me" : null))
    : null;

  const t: TTask = {
    id: raw.id,
    title: raw.title,
    details: raw.note ?? "",
    people,
    runs,
    mode: raw.mode === "any" ? "any" : "all",
    inOrder: !!raw.in_order,
    status,
    dueAt,
    anyTime,
    high: raw.priority === "high",
    group: raw.group_id ? { id: raw.group_id, name: raw.group_name || groupIn(dir, raw.group_id)?.name || "group" } : null,
    repeat: raw.repeat ?? "",
    nextOn: ms(raw.next_on),
    sentAt,
    j,
    steps,
    help,
    cantdo,
    reopenNote: status === "progress" ? raw.reopen_note || reopenA?.note || "" : "",
    nudgedAt: nudge != null && now - nudge < NUDGE_EVERY ? nudge : null,
    editedAt: ms(lastOf(act, "edited")?.at),
    approvedAt,
    cancelledAt,
    prevIdx,
    took: approvedAt ? took(sentAt, approvedAt) : "",
    replied,
    chat: {
      count: chatRaw.count ?? 0,
      unread: chatRaw.unread ?? 0,
      last: chatRaw.last ? { key: lastKey, name: lastBy, text: chatRaw.last.text, at: ms(chatRaw.last.at) } : null,
    },
    events: [],
    updatedAt: ms(raw.updated_at) ?? sentAt,
    raw,
  };
  t.events = act.map((a) => ({ text: eventText(a, t, dir, actKey(a)), at: Date.parse(a.at) }));
  return t;
}

/** One activity row in words, from the owner's side. */
export function eventText(a: TeamTaskActivityJson, t: Pick<TTask, "people" | "steps" | "mode" | "group">, dir: Directory, who: string | null): string {
  const first = who && who !== "me" ? personIn(dir, who).first : a.name?.split(/\s+/)[0] || (t.people.length === 1 ? personIn(dir, t.people[0]).first : "They");
  const stepN = () => {
    const i = t.steps.findIndex((s) => s.text === a.note);
    return i >= 0 ? `step ${i + 1}` : a.note ? `“${a.note}”` : "a step";
  };
  switch (a.action) {
    case "created":
      return `You sent it to ${namesOf(dir, t.people)}${t.mode === "any" ? ": the first to start takes it" : ""}`;
    case "posted":
      return `Posted in the ${a.note || t.group?.name || "group"} chat`;
    case "seen":
      return `${first} saw it`;
    case "accepted":
      return `${first} confirmed it`;
    case "started":
      return `${first} started`;
    case "taken":
      return `${first} took it. The others were told`;
    case "step_done":
      return `${first} ticked ${stepN()}`;
    case "step_undone":
      return `${first} unticked ${stepN()}`;
    case "step_added":
      return `You added a step: ${a.note}`;
    case "help":
      return `${first} asked for help`;
    case "cantdo":
      return `${first} can’t do it`;
    case "done":
      return `${first} marked it done`;
    case "review":
      return "Everyone is done. Waiting for your OK";
    case "approved":
      return "You approved it";
    case "reopened":
      return a.note ? `You reopened it: “${a.note}”` : "You reopened it";
    case "cancelled":
      return "You cancelled it";
    case "restored":
      return "You restored it";
    case "nudged":
      return `You nudged ${a.name?.split(/\s+/)[0] || namesOf(dir, t.people)}`;
    case "replied":
      return "You replied";
    case "reassigned":
      return a.note ? `You moved it ${a.note}` : `You gave it to ${a.name?.split(/\s+/)[0] || first}`;
    case "due":
    case "move_due":
      return a.note ? `You moved the due date to ${a.note}` : "You moved the due date";
    case "repeat":
      return a.note ? `You set it to repeat every ${a.note}` : "You turned repeat off";
    case "edited":
      return a.note === "due_at" ? "You moved the due date" : "You edited it";
    case "note":
      return `${first}: “${a.note}”`;
    case "repeat_made":
      return `Repeat made a new copy and sent it to ${namesOf(dir, t.people)}`;
    default:
      return a.by === "owner" ? `You: ${a.action.replace(/_/g, " ")}` : `${first}: ${a.action.replace(/_/g, " ")}`;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Derived values (ported 1:1 from panel.js)
// ---------------------------------------------------------------------------------------------------------------

export const isClosed = (t: Pick<TTask, "status">): boolean => t.status === "approved" || t.status === "cancelled";

export interface Due {
  chip: string;
  short: string;
  kind: "" | "today" | "over";
  late: boolean;
  /** "today 6:00 PM" */
  text: string;
  /** Day offset from today (null = no due date). */
  d: number | null;
  time: string;
}

export function dueOf(t: Pick<TTask, "dueAt" | "anyTime" | "status">, now: number): Due {
  if (t.dueAt == null) return { chip: "No due date", short: "No due date", kind: "", late: false, text: "any day", d: null, time: "" };
  const d = dayDiff(t.dueAt, now);
  const day = dayWords(d, now);
  const time = t.anyTime ? "" : clock(t.dueAt);
  const done = isClosed(t);
  const late = !done && t.status !== "review" && (t.anyTime ? d < 0 : t.dueAt < now);
  let short = d === 0 || d === 1 ? day.word + (time ? ` ${time}` : "") : day.label + (time ? `, ${time}` : "");
  let chip = `Due ${day.rel}${time ? (d === 0 || d === 1 ? " " : ", ") + time : ""}`;
  if (d === 0 && !done && time && !late) {
    const left = Math.round((t.dueAt - now) / 60_000);
    if (left > 0) chip += ` · in ${left >= 60 ? `${Math.round(left / 60)} h` : `${left} min`}`;
  }
  if (late) {
    if (d < 0) chip = d === -1 ? "1 day late" : `${-d} days late`;
    else {
      const over = Math.max(1, Math.round((now - t.dueAt) / 60_000));
      chip = over >= 60 ? `${Math.round(over / 60)} h late` : `${over} min late`;
    }
    short = chip;
  }
  return { chip, short, kind: late ? "over" : d === 0 && !done ? "today" : "", late, text: day.rel + (time ? ` ${time}` : ""), d, time };
}

export function stepInfo(t: Pick<TTask, "steps">): { n: number; done: number; cur: number } {
  const st = t.steps;
  const done = st.filter((s) => s.done).length;
  const cur = st.findIndex((s) => !s.done);
  return { n: st.length, done, cur };
}

export interface PersonWord {
  d: number;
  n: number;
  word: string;
  tone: "" | "ok" | "red" | "work";
}

/** Each person's state word on the People rows: Done / Their turn / Waits for Priya / On it / Not seen… */
export function personState(t: TTask, k: string, dir: Directory): PersonWord {
  const st = t.steps;
  const mine = st.filter((s) => s.owner === k);
  const md = mine.filter((s) => s.done).length;
  const info = stepInfo(t);
  const r: PersonWord = { d: md, n: mine.length, word: "", tone: "" };
  const run = t.runs[k];
  if (t.status === "approved") return { ...r, word: "Approved", tone: "ok" };
  if (t.status === "cancelled") return { ...r, word: "Cancelled" };
  if (t.help && t.help.who === k && t.status === "help") return { ...r, word: "Needs help", tone: "red" };
  if (t.cantdo && t.cantdo.who === k && t.status === "cantdo") return { ...r, word: "Can’t do it", tone: "red" };
  if (t.status === "review" || (mine.length && md === mine.length) || (!st.length && run?.state === "done")) return { ...r, word: "Done", tone: "ok" };
  if (t.status === "sent" || run?.state === "sent") return { ...r, word: "Not seen" };
  if (t.inOrder && info.cur >= 0) {
    const ow = st[info.cur].owner;
    if (ow === k) return { ...r, word: "Their turn", tone: "work" };
    const firstMine = st.findIndex((s) => s.owner === k && !s.done);
    if (firstMine > info.cur) return { ...r, word: `Waits for ${personIn(dir, ow).first}` };
  }
  if (md > 0 || run?.state === "progress" || (t.status === "progress" && t.people.length === 1)) return { ...r, word: "On it", tone: "work" };
  return { ...r, word: "Seen" };
}

export type Tone = "neutral" | "work" | "red" | "needs" | "ok" | "grey";

export interface HapButton {
  label: string;
  /** approve · reopen · nudge · reply · reassign · due · restore · start · finish · tick:<i> · none */
  act: string;
  pri: boolean;
  off?: boolean;
}

export interface Happening {
  tone: Tone;
  text: string;
  sub: string[];
  btns: HapButton[];
  short: string;
}

/**
 * THE "What's happening" sentence + at most two buttons. side "owner" (dashboard) or "member" (Windows wording,
 * `me` = the member's key). `bossFirst` = the owner's first name for the member side.
 */
export function happen(t: TTask, dir: Directory, now: number, side: "owner" | "member" = "owner", me = "", bossFirst = "your admin"): Happening {
  const P = (k: string | null | undefined) => personIn(dir, k).first;
  const info = stepInfo(t);
  const due = dueOf(t, now);
  const team = t.people.length > 1;
  const who = namesOf(dir, t.people);
  const one = P(t.people[0]);
  const h: Happening = { tone: "neutral", text: "", sub: [], btns: [], short: "" };
  const B = (label: string, act: string, pri = false) => h.btns.push({ label, act, pri });
  if (t.repeat) h.sub.push(`Repeats every ${t.repeat}${t.nextOn ? ` · next on ${dayLabel(t.nextOn)}` : ""}`);
  if (t.reopenNote && t.status === "progress") h.sub.push(`You reopened it: “${t.reopenNote}”`);
  if (t.replied && t.status !== "help") h.sub.push(`You replied at ${clock(t.replied)}.`);
  if (side === "member") return happenMember(t, dir, me, h, info, due, bossFirst);

  if (t.status === "cancelled") {
    h.tone = "grey";
    h.text = `You cancelled it ${whenLong(t.cancelledAt, now)}.`;
    h.short = "Cancelled";
    B("Restore", "restore");
    return h;
  }
  if (t.status === "approved") {
    h.tone = "ok";
    h.text = `You approved it ${whenLong(t.approvedAt, now)}.${t.took ? ` ${t.took}, ${t.people.length}${t.people.length === 1 ? " person." : " people."}` : ""}`;
    h.short = `Approved ${t.approvedAt ? (dayDiff(t.approvedAt, now) === 0 ? "today" : dayLabel(t.approvedAt)) : ""}`.trim();
    B("Reopen", "reopen");
    return h;
  }
  if (t.status === "review") {
    h.tone = "needs";
    h.text = `${team ? "Everyone is done." : `${one} is done.`} Check the work and give your OK.`;
    h.short = `${team ? "Everyone is done" : `${one} is done`} · check and approve`;
    B("Approve", "approve", true);
    B("Reopen…", "reopen");
    return h;
  }
  if (t.status === "help" && t.help) {
    h.tone = "red";
    h.text = `${P(t.help.who)} needs help${t.help.text ? `: “${t.help.text}”` : "."}`;
    h.short = `${P(t.help.who)} needs help`;
    B("Reply", "reply", true);
    return h;
  }
  if (t.status === "cantdo" && t.cantdo) {
    h.tone = "red";
    h.text = `${P(t.cantdo.who)} can’t do it${t.cantdo.text ? `: “${t.cantdo.text}”` : "."}`;
    h.short = `${P(t.cantdo.who)} can’t do it`;
    B("Reassign", "reassign", true);
    B("Reply", "reply");
    return h;
  }
  const nud = (lbl = "Nudge") => {
    if (t.nudgedAt) {
      h.sub.unshift(`Nudged ${clock(t.nudgedAt)}. Zinwe reminded them on their PC.`);
      h.btns.push({ label: "Nudged", act: "none", pri: false, off: true });
    } else B(lbl, "nudge");
  };
  if (due.late) {
    h.tone = "red";
    h.text = `${due.chip}. ${t.status === "progress" ? `${one} is on it: ${info.done} of ${info.n} steps done.` : team ? "Nobody has started." : `${one} hasn’t started.`}`;
    if (t.status === "progress" && !info.n) h.text = `${due.chip}. ${team ? `${who} are on it.` : `${one} is on it.`}`;
    h.short = `${due.chip} · ${t.status === "progress" ? "on it" : "not started"}`;
    nud();
    B("Move due date", "due");
    return h;
  }
  if (t.status === "sent") {
    const off = t.people.filter((k) => personIn(dir, k).pc === "offline");
    const since = off.length ? personIn(dir, off[0]).pcSince : "";
    h.text = `Not seen yet. ${
      off.length && !team
        ? `${one}’s PC has been offline${since ? ` since ${since}` : ""}.`
        : t.mode === "any"
          ? `The first of ${who} to start takes it.`
          : `It’s waiting in ${team ? "their" : `${one}’s`} Zinwe app.`
    }`;
    h.short = off.length && !team ? "Not seen · PC offline" : "Not seen yet";
    if (off.length) h.sub.push(`A copy went to ${team ? "their" : `${one}’s`} email, so it isn’t lost.`);
    nud();
    return h;
  }
  if (t.status === "seen") {
    const at = t.j[1] != null ? (dayDiff(t.j[1], now) === 0 ? `at ${clock(t.j[1])}` : when(t.j[1], now)) : "";
    h.text = team ? `All ${t.people.length} saw it but nobody has started.` : `${one} saw it${at ? ` ${at}` : ""} but hasn’t started.`;
    h.short = `Seen${t.j[1] != null ? ` ${when(t.j[1], now)}` : ""} · not started`;
    nud();
    return h;
  }
  // In progress
  h.tone = "work";
  if (team && t.inOrder && info.cur >= 0) {
    const ow = t.steps[info.cur].owner;
    if (ow) {
      h.text = `${P(ow)}’s turn: step ${info.cur + 1} of ${info.n}, ${t.steps[info.cur].text}.`;
      h.short = `${P(ow)}’s turn · step ${info.cur + 1} of ${info.n}`;
      nud(`Nudge ${P(ow)}`);
    } else {
      h.text = `Step ${info.cur + 1} of ${info.n} is next: ${t.steps[info.cur].text}. Anyone can take it.`;
      h.short = `Step ${info.cur + 1} of ${info.n} is next`;
      nud();
    }
    return h;
  }
  if (info.n && info.done === info.n) {
    h.text = `Waiting for ${who} to take another look.`;
    h.short = `Reopened · waiting for ${who}`;
    nud();
    return h;
  }
  if (team) {
    const on = t.people.filter((k) => personState(t, k, dir).word !== "Done");
    if (info.n) {
      h.text = `${info.done} of ${info.n} steps done. ${namesOf(dir, on)}${on.length === 1 ? " is" : " are"} on it.`;
      h.short = `${info.done} of ${info.n} steps · ${namesOf(dir, on)}`;
    } else {
      h.text = `${namesOf(dir, on)}${on.length === 1 ? " is" : " are"} on it.`;
      h.short = `${namesOf(dir, on)} on it`;
    }
    nud();
    return h;
  }
  h.text = `${one} is on it${info.n ? `: ${info.done} of ${info.n} steps done.` : "."}`;
  h.short = `${one} is on it${info.n ? ` · ${info.done} of ${info.n}` : ""}`;
  if (t.nudgedAt) nud();
  return h;
}

function happenMember(t: TTask, dir: Directory, me: string, h: Happening, info: ReturnType<typeof stepInfo>, due: Due, boss: string): Happening {
  const B = (label: string, act: string, pri = false) => h.btns.push({ label, act, pri });
  if (t.status === "cancelled") return { ...h, tone: "grey", text: `${boss} cancelled this task.`, short: "Cancelled" };
  if (t.status === "approved") return { ...h, tone: "ok", text: `Approved by ${boss}. Nice work.`, short: "Approved" };
  if (t.status === "review") return { ...h, tone: "ok", text: `You’re done. Waiting for ${boss}’s OK.`, short: `Waiting for ${boss}’s OK` };
  const started = t.runs[me]?.state === "progress" || t.steps.some((s) => s.done && s.by === me);
  if (t.reopenNote && t.status === "progress" && !started) {
    h.tone = "red";
    h.text = `${boss} reopened it: “${t.reopenNote}”`;
    h.short = "Reopened";
    h.sub = [];
    B("Start again", "start", true);
    return h;
  }
  if (t.status === "help" && t.help) return { ...h, tone: "red", text: `You asked ${boss} for help: “${t.help.text}”`, short: "Waiting for help" };
  if (t.status === "cantdo" && t.cantdo) return { ...h, tone: "red", text: `You told ${boss} you can’t do it: “${t.cantdo.text}”`, short: "You can’t do it" };
  if (t.status === "sent" || t.status === "seen") {
    h.tone = "needs";
    h.text = `New from ${boss}. ${due.chip}.`;
    h.short = `New · ${due.short}`;
    B("Start", "start", true);
    return h;
  }
  h.tone = "work";
  if (t.inOrder && info.cur >= 0) {
    const ow = t.steps[info.cur].owner;
    if (!ow || ow === me) {
      h.text = `Your turn: step ${info.cur + 1} of ${info.n}, ${t.steps[info.cur].text}.`;
      h.short = `Your turn · step ${info.cur + 1}`;
      B(`Tick step ${info.cur + 1}`, `tick:${info.cur}`, true);
      return h;
    }
    const myLeft = t.steps.some((s) => s.owner === me && !s.done);
    if (!myLeft) return { ...h, tone: "ok", text: `Your part is done. ${personIn(dir, ow).first} is next.`, short: "Your part is done" };
    return { ...h, tone: "neutral", text: `Waits for ${personIn(dir, ow).first}: step ${info.cur + 1} (${t.steps[info.cur].text}).`, short: `Waits for ${personIn(dir, ow).first}` };
  }
  const next = t.steps.findIndex((s) => !s.done && (!s.owner || s.owner === me));
  if (next >= 0) {
    h.text = `You’re on it: ${info.done} of ${info.n} steps done.`;
    h.short = `On it · ${info.done} of ${info.n}`;
    B(`Tick step ${next + 1}`, `tick:${next}`, true);
    return h;
  }
  if (t.people.length > 1 && info.n) {
    const left = t.people.filter((k) => k !== me && personState(t, k, dir).word !== "Done");
    return { ...h, tone: "ok", text: `Your part is done. Waiting for ${namesOf(dir, left)}.`, short: "Your part is done" };
  }
  h.text = "You’re on it.";
  h.short = "On it";
  B("Mark it done", "finish", true);
  return h;
}

export function pillOf(t: Pick<TTask, "status">): { label: string; tone: Tone } {
  const M: Record<Status, [string, Tone]> = {
    sent: ["Sent", "grey"],
    seen: ["Seen", "grey"],
    progress: ["In progress", "work"],
    help: ["Needs help", "red"],
    cantdo: ["Can’t do it", "red"],
    review: ["Waiting for your OK", "needs"],
    approved: ["Approved", "ok"],
    cancelled: ["Cancelled", "grey"],
  };
  const m = M[t.status] ?? ["Draft", "grey"];
  return { label: m[0], tone: m[1] };
}

export interface JourneyStep {
  label: string;
  time: string;
  st: "past" | "now" | "next" | "ok" | "red";
}

/** Sent · Seen · Working · Done · Your OK; a team shows counts ("Seen 3/3", "Done 1/3"). */
export function journey(t: TTask, dir: Directory, now: number): JourneyStep[] {
  const IDX: Record<Status, number> = { sent: 0, seen: 1, progress: 2, help: 2, cantdo: 2, review: 3, approved: 4, cancelled: -1 };
  let idx = IDX[t.status];
  if (t.status === "cancelled") idx = t.prevIdx;
  const team = t.people.length > 1;
  const seenN = t.status === "sent" ? 0 : team ? Math.max(t.people.filter((k) => t.runs[k]?.state !== "sent").length, 0) : 1;
  let doneN = t.people.filter((k) => personState(t, k, dir).word === "Done").length;
  if (t.status === "approved" || t.status === "review") doneN = t.people.length;
  const L = ["Sent", team ? `Seen ${seenN}/${t.people.length}` : "Seen", "Working", team ? `Done ${doneN}/${t.people.length}` : "Done", "Your OK"];
  return L.map((label, i) => {
    let st: JourneyStep["st"] = i < idx ? "past" : i === idx ? "now" : "next";
    if (t.status === "approved") st = "ok";
    if (i === 2 && (t.status === "help" || t.status === "cantdo")) st = "red";
    return { label, time: i <= idx ? when(t.j[i], now) : "", st };
  });
}

/** List lanes: Needs you · Late · Today · Later · Done. */
export type Lane = "needs" | "late" | "today" | "later" | "done";
export const LANES: ReadonlyArray<{ key: Lane; label: string; hint: string; dot: string }> = [
  { key: "needs", label: "Needs you", hint: "Waiting for your OK, a reply or a decision", dot: "#F26A0A" },
  { key: "late", label: "Late", hint: "Past the due time", dot: "#C0331C" },
  { key: "today", label: "Today", hint: "Due later today", dot: "#141210" },
  { key: "later", label: "Later", hint: "Due tomorrow or after", dot: "#A3A3A3" },
  { key: "done", label: "Done", hint: "Approved or cancelled", dot: "#17663F" },
];

export function laneOf(t: TTask, now: number): Lane {
  if (isClosed(t)) return "done";
  if (t.status === "review" || t.status === "help" || t.status === "cantdo") return "needs";
  const d = dueOf(t, now);
  if (d.late) return "late";
  return d.d === 0 ? "today" : "later";
}

/** Waiting on the owner: their OK, a reply to a help request, or a decision on "can't do it". */
export const needsYou = (t: Pick<TTask, "status">): boolean => t.status === "review" || t.status === "help" || t.status === "cantdo";

/** The mini journey's label under a list row: "Working · 1/3". */
export function progressLabel(t: TTask, dir: Directory, now: number): string {
  const jr = journey(t, dir, now);
  let nowI = 0;
  jr.forEach((x, i) => {
    if (x.st !== "next") nowI = i;
  });
  const info = stepInfo(t);
  const base = t.status === "approved" ? "Approved" : t.status === "cancelled" ? "Cancelled" : ["Sent", "Seen", "Working", "Done", "Approved"][nowI];
  return base + (info.n ? ` · ${info.done}/${info.n}` : "");
}

/** Next date for a repeat (for the preview and the sample backend). */
export function nextOnFrom(base: number, repeat: TeamTaskRepeat): number | null {
  if (!repeat) return null;
  const d = new Date(base);
  if (repeat === "day") d.setDate(d.getDate() + 1);
  else if (repeat === "week") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d.getTime();
}

// ---------------------------------------------------------------------------------------------------------------
// Quick add: the text is the single source of truth (@names and groups, date words, "!")
// ---------------------------------------------------------------------------------------------------------------

export interface QaSeg {
  t: string;
  cls: "" | "who" | "due" | "prio" | "at";
}
export interface QaParse {
  title: string;
  who: string[];
  groups: string[];
  keys: string[];
  due: { d: number; time: string };
  dueSet: boolean;
  high: boolean;
  segs: QaSeg[];
  atFrag: string | null;
}

const DATE_RE = /\b(?:today|tonight|tomorrow|tmrw|next week|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thu|friday|fri|saturday|sat|sunday|sun)\b|\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\bnoon\b/gi;

/** "Monday after next" when next Monday is within 2 days, else next Monday (prototype: Sat → Mon 16). */
function nextWeekOffset(now: number): number {
  const dow = new Date(now).getDay();
  const toMon = (1 - dow + 7) % 7 || 7;
  return toMon <= 2 ? toMon + 7 : toMon;
}

export function qaTime(s: string): number {
  const m = /(\d{1,2})(?::(\d{2}))?\s?(am|pm)/i.exec(s);
  if (!m) return 18 * 60;
  return ((Number(m[1]) % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0)) * 60 + (m[2] ? Number(m[2]) : 0);
}

export function qaParse(text: string, dir: Directory, now: number): QaParse {
  const segs: QaSeg[] = [];
  const who: string[] = [];
  const groups: string[] = [];
  let high = false;
  let atFrag: string | null = null;
  let at = 0;
  let dayD: number | null = null;
  let time: string | null = null;
  let clean = text;
  const DOW: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const re = /@[A-Za-z]*|\b(?:today|tonight|tomorrow|tmrw|next week|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thu|friday|fri|saturday|sat|sunday|sun)\b|\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\bnoon\b|(?:^|\s)!(?:high)?(?=\s|$)/gi;
  const todayDow = new Date(now).getDay();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let tok = m[0];
    let start = m.index;
    if (/^\s/.test(tok)) {
      start += 1;
      tok = tok.slice(1);
    }
    if (start > at) segs.push({ t: text.slice(at, start), cls: "" });
    const low = tok.toLowerCase();
    let cls: QaSeg["cls"] = "";
    if (tok[0] === "@") {
      const name = low.slice(1);
      const pk = dir.list.find((p) => p.first.toLowerCase() === name);
      const gk = dir.groups.find((g) => g.name.toLowerCase() === name);
      if (pk) {
        if (!who.includes(pk.key)) who.push(pk.key);
        cls = "who";
      } else if (gk) {
        if (!groups.includes(gk.key)) groups.push(gk.key);
        cls = "who";
      } else if (start + tok.length === text.length) {
        atFrag = name;
        cls = "at";
      }
    } else if (tok[0] === "!") {
      high = true;
      cls = "prio";
    } else if (/am|pm|noon/.test(low) && !/^(mon|tue|wed|thu|fri|sat|sun)/.test(low)) {
      if (time === null) time = low === "noon" ? "12:00 PM" : timeOf(qaTime(low));
      cls = "due";
    } else {
      if (dayD === null) {
        if (low === "today") dayD = 0;
        else if (low === "tonight") {
          dayD = 0;
          if (time === null) time = "8:00 PM";
        } else if (low === "tomorrow" || low === "tmrw") dayD = 1;
        else if (low === "next week") dayD = nextWeekOffset(now);
        else {
          const dw = DOW[low.slice(0, 3)];
          const diff = (dw - todayDow + 7) % 7;
          dayD = diff === 0 ? 7 : diff;
        }
      }
      cls = "due";
    }
    segs.push({ t: tok, cls });
    at = start + tok.length;
    if (cls && cls !== "at") clean = clean.replace(tok, " ");
  }
  if (at < text.length) segs.push({ t: text.slice(at), cls: "" });
  if (atFrag !== null) clean = clean.replace(/@[A-Za-z]*$/, " ");
  const dueSet = dayD !== null || time !== null;
  const due = { d: dayD ?? 0, time: time ?? "6:00 PM" };
  let title = clean
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+(by|at|on|before|for|due)$/i, "")
    .replace(/[,;:\-–]+$/, "")
    .trim();
  if (title) title = title[0].toUpperCase() + title.slice(1);
  const keys = [...who];
  groups.forEach((g) => groupIn(dir, g)?.people.forEach((k) => !keys.includes(k) && keys.push(k)));
  return { title, who, groups, keys, due, dueSet, high, segs, atFrag };
}

/** Drop every date word from the text (the Due menu replaces them). */
export function qaStripDates(text: string): string {
  return text.replace(DATE_RE, "").replace(/\s{2,}/g, " ").replace(/\s*$/, "");
}
