/**
 * Team tasks v1.4 — the sample backend (Kitecrest Digital, owner Ananya Rao; the prototype's cast and story).
 *
 * Serves the exact v1.4 API shapes (lib/api/teamTasks.ts → TeamTasksSource) from a sample store, so every Tasks
 * screen, the Overview rows and the badges work without the v1.4 backend: in the dev server, or a build made with
 * VITE_SAMPLE_DATA=1 (SAMPLES_ON), when the API has no v1.4 tasks yet (404 / old shape), or when forced with
 * `?sample=tasks` / localStorage "zinwe.sample.tasks" = "1". Never in production.
 *
 * Times are laid out around "now" exactly as the prototype tells it at Sat 3:00 PM (so "Due today 6:00 PM · in 3 h",
 * "1 day late" read the same whenever you open it). The members play their part: a nudge makes them start or tick
 * their steps a few seconds later, a new task is seen shortly after it is sent.
 */
import type {
  Member,
  TaskChatLineJson,
  TaskGroupJson,
  TeamTaskAction,
  TeamTaskActivityJson,
  TeamTaskCreate,
  TeamTaskJson,
  TeamTaskPatch,
  TeamTasksSource,
  TeamTaskStepJson,
} from "../../lib/api";
import { sample, sampleStore, SAMPLES_ON } from "./index";

export const TASKS_CHANGED = "zinwe:tasks-changed";
const changed = () => window.dispatchEvent(new Event(TASKS_CHANGED));

// ---- the cast ----
type K = "priya" | "karan" | "emily" | "fatima" | "jake" | "arjun" | "vikram" | "olivia" | "michael" | "sneha";
const CAST: Record<K, { id: number; name: string; role: Member["role"]; online: boolean; since?: string }> = {
  priya: { id: 101, name: "Priya Nair", role: "designer", online: true },
  karan: { id: 102, name: "Karan Malhotra", role: "developer", online: true },
  emily: { id: 103, name: "Emily Carter", role: "designer", online: true },
  fatima: { id: 104, name: "Fatima Sheikh", role: "accounts", online: false, since: "2:30 PM" },
  jake: { id: 105, name: "Jake Thompson", role: "developer", online: true },
  arjun: { id: 106, name: "Arjun Mehta", role: "support", online: true },
  vikram: { id: 107, name: "Vikram Singh", role: "developer", online: true },
  olivia: { id: 108, name: "Olivia Martinez", role: "sales", online: true },
  michael: { id: 109, name: "Michael Chen", role: "sales", online: false, since: "11:20 AM" },
  sneha: { id: 110, name: "Sneha Reddy", role: "operations", online: true },
};
const ID = (k: K) => CAST[k].id;
const NAME_OF = (id: number) => Object.values(CAST).find((c) => c.id === id)?.name ?? "Someone";
export const SAMPLE_OWNER_NAME = "Ananya Rao";

/**
 * The story's "now" is Sat 3:00 PM. Every time keeps its distance from that "now", moved by the whole hours since 3 PM so the clock
 * times stay round ("Due today 6:00 PM · in 3 h" at 3 PM reads "Due today 7:00 PM · in 3 h" at 4 PM).
 */
function at(d: number, time: string): string {
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(time);
  const min = m ? ((Number(m[1]) % 12) + (/pm/i.test(m[3]) ? 12 : 0)) * 60 + Number(m[2]) : 15 * 60;
  const base = new Date();
  base.setMinutes(0, 0, 0);
  const shiftH = base.getHours() - 15;
  const x = new Date(base);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() + d);
  x.setMinutes(min + shiftH * 60);
  return x.toISOString();
}
const W: Record<string, number> = { Sat: 0, Fri: -1, Thu: -2, Wed: -3, Tue: -4, Mon: -5 };
/** "Thu 9:10 AM" or "2:20 PM" (today) as ISO. */
const ts = (s: string): string => {
  const m = /^(\w{3}) (.*)$/.exec(s);
  return m && m[1] in W ? at(W[m[1]], m[2]) : at(0, s);
};

export function sampleMembers(): Member[] {
  return (Object.keys(CAST) as K[]).map((k) => {
    const c = CAST[k];
    return {
      id: c.id,
      name: c.name,
      email: `${k}@kitecrest.example`,
      member_id: `ZM-${c.id}`,
      role: c.role,
      is_active: true,
      created_at: at(-40, "10:00 AM"),
      device: { hostname: `KC-${k.toUpperCase()}`, is_online: c.online, last_seen_at: c.online ? new Date().toISOString() : ts(c.since ?? "1:00 PM") },
    } as Member;
  });
}

const GROUPS: TaskGroupJson[] = [
  { id: 1, name: "Design", member_ids: [ID("priya"), ID("emily"), ID("fatima")] },
  { id: 2, name: "Development", member_ids: [ID("karan"), ID("arjun"), ID("jake"), ID("vikram")] },
  { id: 3, name: "Everyone", member_ids: (Object.keys(CAST) as K[]).map(ID) },
];

// ---- the seed ----
interface Seed {
  id: number;
  title: string;
  people: K[];
  mode?: "all" | "any";
  inOrder?: boolean;
  status: TeamTaskJson["status"];
  due: [number, string];
  high?: boolean;
  group?: number;
  repeat?: TeamTaskJson["repeat"];
  nextOn?: [number, string];
  steps: Array<[string, K, string?]>;
  details: string;
  chat: Array<[K | "me", string, string]>;
  unread?: number;
  /** [when, action, who?, note?] */
  act: Array<[string, string, (K | "me")?, string?]>;
  help?: string;
  cantdo?: string;
  reopen?: string;
}

const SEED: Seed[] = [
  { id: 1, title: "Prepare the Diwali office party", people: ["sneha", "fatima", "arjun"], status: "review", due: [2, "5:00 PM"], unread: 1,
    steps: [["Book the caterer for 40 people", "sneha", "Thu 10:05 AM"], ["Order the sweets boxes", "fatima", "Thu 3:40 PM"], ["Put up the lights and rangoli", "sneha", "12:30 PM"], ["Set up music and speakers", "arjun", "1:45 PM"], ["Send the invite to everyone", "fatima", "2:20 PM"]],
    details: "Party on Monday from 5 PM in the main hall. Budget ₹40,000. Veg menu only.",
    chat: [["sneha", "Caterer booked, they need the final count by Sunday.", "Thu 10:06 AM"], ["me", "Count is 38. Thanks Sneha!", "Thu 10:30 AM"], ["fatima", "Invite sent to the whole team.", "2:21 PM"]],
    act: [["Wed 11:00 AM", "created", "me"], ["Wed 11:20 AM", "seen", "sneha"], ["Wed 11:20 AM", "seen", "fatima"], ["Wed 11:20 AM", "seen", "arjun"], ["Thu 9:15 AM", "started", "sneha"], ["Thu 10:05 AM", "step_done", "sneha", "Book the caterer for 40 people"], ["Thu 3:40 PM", "step_done", "fatima", "Order the sweets boxes"], ["12:30 PM", "step_done", "sneha", "Put up the lights and rangoli"], ["1:45 PM", "step_done", "arjun", "Set up music and speakers"], ["2:20 PM", "step_done", "fatima", "Send the invite to everyone"], ["2:20 PM", "done", "fatima"]] },
  { id: 2, title: "Send the October invoices", people: ["fatima"], status: "review", due: [1, "6:00 PM"], unread: 1,
    steps: [["Make the invoices in Tally", "fatima", "Thu 4:10 PM"], ["Check the GST line on each", "fatima", "11:30 AM"], ["Email them to the 12 clients", "fatima", "1:55 PM"]],
    details: "", chat: [["fatima", "All 12 sent. Sunline Cafe asked for a PO number, added it.", "1:56 PM"]],
    act: [["Thu 8:34 AM", "created", "me"], ["Thu 8:41 AM", "seen", "fatima"], ["Thu 9:02 AM", "started", "fatima"], ["Thu 4:10 PM", "step_done", "fatima", "Make the invoices in Tally"], ["11:30 AM", "step_done", "fatima", "Check the GST line on each"], ["1:55 PM", "step_done", "fatima", "Email them to the 12 clients"], ["1:55 PM", "done", "fatima"]] },
  { id: 3, title: "Design the new landing page hero", people: ["emily"], status: "help", help: "Which hero image, A or B?", due: [1, "6:00 PM"], unread: 1,
    steps: [["Make two image options", "emily", "Fri 4:30 PM"], ["Pick one with Ananya", "emily"], ["Export it for web and phone", "emily"]],
    details: "Brand colours only. Headline stays “IT is OK”.",
    chat: [["emily", "Both options are in the Design folder: A is the office photo, B is the illustration.", "2:47 PM"]],
    act: [["Fri 10:00 AM", "created", "me"], ["Fri 10:12 AM", "seen", "emily"], ["Fri 11:00 AM", "started", "emily"], ["Fri 4:30 PM", "step_done", "emily", "Make two image options"], ["2:48 PM", "help", "emily", "Which hero image, A or B?"]] },
  { id: 4, title: "Renew the SSL certificates", people: ["arjun"], status: "cantdo", cantdo: "No admin access to the server.", due: [2, "6:00 PM"], high: true, unread: 1,
    steps: [["Get the new certificates from the provider", "arjun"], ["Install them on the web server", "arjun"], ["Check the site shows the lock", "arjun"]],
    details: "They expire on Wed 11 Nov.",
    chat: [["arjun", "I can’t log in to the server, my admin account was removed last month.", "1:10 PM"]],
    act: [["Fri 9:00 AM", "created", "me"], ["Fri 9:05 AM", "seen", "arjun"], ["1:10 PM", "cantdo", "arjun", "No admin access to the server."]] },
  { id: 5, title: "Fix the broken links on the Lumen site", people: ["jake"], status: "seen", due: [-1, "6:00 PM"],
    steps: [["Run the link checker", "jake"], ["Fix or remove each broken link", "jake"]], details: "", chat: [],
    act: [["Thu 4:00 PM", "created", "me"], ["Fri 9:15 AM", "seen", "jake"]] },
  { id: 6, title: "Launch the Lumen landing page", people: ["priya", "karan", "emily"], inOrder: true, status: "progress", due: [0, "6:00 PM"], high: true, group: 1,
    steps: [["Write the page copy", "priya", "Fri 10:02 AM"], ["Pick the hero images", "priya", "11:40 AM"], ["Build the hero section", "karan"], ["Connect the signup form", "karan"], ["Check it on phones", "emily"], ["Final check with Ananya", "emily"]],
    details: "Client demo on Monday morning. Use option B for the hero.",
    chat: [["priya", "Copy and images are in the Lumen folder. Karan, over to you.", "11:42 AM"], ["karan", "Thanks! Starting after lunch.", "12:10 PM"], ["me", "Great. Let’s aim for 6.", "12:15 PM"]],
    act: [["Thu 9:10 AM", "created", "me"], ["Thu 9:10 AM", "posted", "me", "Design"], ["Thu 9:30 AM", "seen", "priya"], ["Thu 9:30 AM", "seen", "karan"], ["Thu 9:30 AM", "seen", "emily"], ["Fri 10:02 AM", "step_done", "priya", "Write the page copy"], ["11:40 AM", "step_done", "priya", "Pick the hero images"]] },
  { id: 7, title: "Get the checkout fix live on staging", people: ["karan"], status: "progress", due: [0, "6:00 PM"], high: true,
    steps: [["Fix the coupon rounding", "karan", "Fri 5:20 PM"], ["Deploy to staging", "karan"], ["Ask the client to test", "karan"]],
    details: "The client tests tomorrow morning.", chat: [["karan", "Rounding fixed, deploying after the Lumen hero.", "1:30 PM"]],
    act: [["Fri 10:43 AM", "created", "me"], ["Fri 10:50 AM", "seen", "karan"], ["Fri 11:33 AM", "started", "karan"], ["Fri 5:20 PM", "step_done", "karan", "Fix the coupon rounding"]] },
  { id: 8, title: "Write the case study for Northwind", people: ["priya"], status: "seen", due: [1, "6:00 PM"],
    steps: [], details: "One page. Quote from their CTO is in the email thread.", chat: [],
    act: [["8:34 AM", "created", "me"], ["8:40 AM", "seen", "priya"]] },
  { id: 9, title: "Pay the office rent", people: ["fatima"], status: "sent", due: [3, "12:00 PM"], repeat: "month", nextOn: [24, "12:00 PM"],
    steps: [], details: "Landlord’s account details are in the Accounts sheet.", chat: [],
    act: [["2:45 PM", "repeat_made", "me"]] },
  { id: 10, title: "Back up the design files to the NAS", people: ["vikram"], status: "approved", due: [-4, "6:00 PM"],
    steps: [["Copy the 2026 folders", "vikram", "Tue 11:00 AM"], ["Check the copy opens", "vikram", "Tue 2:30 PM"]],
    details: "", chat: [["vikram", "Done, 212 GB copied and checked.", "Tue 2:31 PM"]],
    act: [["Mon 3:00 PM", "created", "me"], ["Mon 3:04 PM", "seen", "vikram"], ["Mon 5:10 PM", "started", "vikram"], ["Tue 11:00 AM", "step_done", "vikram", "Copy the 2026 folders"], ["Tue 2:30 PM", "step_done", "vikram", "Check the copy opens"], ["Tue 2:30 PM", "done", "vikram"], ["Tue 4:10 PM", "approved", "me"]] },
  { id: 11, title: "Send the Northwind proposal", people: ["karan", "priya"], inOrder: true, status: "progress", due: [2, "12:00 PM"],
    steps: [["Finalise the pricing table", "karan", "1:05 PM"], ["Design the cover and layout", "priya"], ["Export the PDF and email it to Northwind", "priya"]],
    details: "Use the new proposal template. Northwind wants it before their Monday call.",
    chat: [["karan", "Pricing is final, the numbers are in the sheet. Priya, over to you.", "1:06 PM"]],
    act: [["Fri 4:30 PM", "created", "me"], ["Fri 4:35 PM", "seen", "karan"], ["Fri 4:35 PM", "seen", "priya"], ["1:05 PM", "step_done", "karan", "Finalise the pricing table"]] },
  { id: 21, title: "Update the pricing page banner", people: ["priya"], status: "progress", reopen: "Use the new orange, not the old red.", due: [0, "6:00 PM"],
    steps: [["Make the new banner", "priya", "Tue 3:10 PM"], ["Export it for web and phone", "priya", "Tue 3:40 PM"], ["Swap to the new orange", "priya"]],
    details: "The banner sits above the plans table.",
    chat: [["priya", "Banner is up, both sizes exported.", "Tue 3:41 PM"], ["me", "Close! Use the new orange, not the old red. I added a step for it.", "12:20 PM"]],
    act: [["Tue 10:00 AM", "created", "me"], ["Tue 10:05 AM", "seen", "priya"], ["Tue 2:00 PM", "started", "priya"], ["Tue 3:10 PM", "step_done", "priya", "Make the new banner"], ["Tue 3:40 PM", "step_done", "priya", "Export it for web and phone"], ["Tue 3:40 PM", "done", "priya"], ["12:20 PM", "reopened", "me", "Use the new orange, not the old red."], ["12:20 PM", "step_added", "me", "Swap to the new orange"]] },
  { id: 22, title: "Resize the team photos for the website", people: ["priya"], status: "review", due: [0, "5:00 PM"], unread: 1,
    steps: [["Crop all 11 photos square", "priya", "11:40 AM"], ["Export them at 800 px", "priya", "1:15 PM"]],
    details: "", chat: [["priya", "All 11 are in the Website folder.", "1:16 PM"]],
    act: [["9:00 AM", "created", "me"], ["9:02 AM", "seen", "priya"], ["10:30 AM", "started", "priya"], ["11:40 AM", "step_done", "priya", "Crop all 11 photos square"], ["1:15 PM", "step_done", "priya", "Export them at 800 px"], ["1:15 PM", "done", "priya"]] },
  { id: 23, title: "Make the Diwali party poster", people: ["priya", "emily"], status: "approved", due: [-4, "6:00 PM"],
    steps: [["Draw the poster", "priya", "Mon 5:20 PM"], ["Print 10 copies", "emily", "Tue 1:30 PM"]],
    details: "", chat: [["me", "Lovely poster, thank you both!", "Tue 4:10 PM"]],
    act: [["Mon 11:00 AM", "created", "me"], ["Mon 11:05 AM", "seen", "priya"], ["Mon 11:05 AM", "seen", "emily"], ["Mon 2:00 PM", "started", "priya"], ["Mon 5:20 PM", "step_done", "priya", "Draw the poster"], ["Tue 1:30 PM", "step_done", "emily", "Print 10 copies"], ["Tue 1:30 PM", "done", "emily"], ["Tue 4:10 PM", "approved", "me"]] },
  { id: 24, title: "Fix the 2nd floor printer", people: ["priya", "emily", "fatima"], mode: "any", status: "sent", due: [0, "5:30 PM"], group: 1,
    steps: [], details: "Fatima says it’s out of toner. The new cartridge is in the store cupboard. Anyone in Design can take it.", chat: [],
    act: [["2:48 PM", "created", "me"], ["2:48 PM", "posted", "me", "Design"]] },
];

interface Line extends TaskChatLineJson {
  task: number;
}
interface Db {
  tasks: TeamTaskJson[];
  lines: Line[];
  /** The owner's last read per task (ms). */
  read: Record<number, number>;
  /** The stage a cancelled task goes back to. */
  prev: Record<number, TeamTaskJson["status"]>;
  nextId: number;
  nextLine: number;
}

function lineBy(who: K | "me"): TaskChatLineJson["by"] {
  return who === "me" ? { kind: "owner", member_id: null, name: SAMPLE_OWNER_NAME } : { kind: "member", member_id: ID(who), name: CAST[who].name };
}

function seedDb(): Db {
  const lines: Line[] = [];
  const read: Record<number, number> = {};
  let lineId = 1;
  const tasks = SEED.map((s) => {
    const steps: TeamTaskStepJson[] = s.steps.map(([title, owner, doneAt], i) => ({
      id: s.id * 100 + i + 1,
      title,
      done: !!doneAt,
      owner_id: ID(owner),
      done_by_id: doneAt ? ID(owner) : null,
      done_at: doneAt ? ts(doneAt) : null,
    }));
    const activity: TeamTaskActivityJson[] = s.act.map(([when, action, who, note]) => ({
      at: ts(when),
      by: who && who !== "me" ? "member" : "owner",
      action,
      note: note ?? (action === "help" ? (s.help ?? "") : ""),
      member_id: who && who !== "me" ? ID(who) : null,
      name: who && who !== "me" ? CAST[who].name : undefined,
    }));
    s.chat.forEach(([who, body, when]) => lines.push({ id: lineId++, task: s.id, by: lineBy(who), body, at: ts(when) }));
    const mine = lines.filter((l) => l.task === s.id);
    // Unread: the newest `unread` member lines; the owner read everything before them.
    const unreadFrom = s.unread ? mine.filter((l) => l.by.kind === "member").slice(-s.unread)[0] : undefined;
    read[s.id] = unreadFrom ? Date.parse(unreadFrom.at) - 1 : Date.now();
    const t: TeamTaskJson = {
      id: s.id,
      title: s.title,
      note: s.details,
      due_at: at(s.due[0], s.due[1]),
      priority: s.high ? "high" : "normal",
      status: s.status,
      mode: s.mode ?? "all",
      in_order: !!s.inOrder,
      repeat: s.repeat ?? "",
      next_on: s.nextOn ? at(s.nextOn[0], s.nextOn[1]).slice(0, 10) : null,
      group_id: s.group ?? null,
      group_name: s.group ? GROUPS.find((g) => g.id === s.group)?.name : undefined,
      people: [],
      steps,
      help_note: s.help ?? "",
      cantdo_note: s.cantdo ?? "",
      reopen_note: s.reopen ?? "",
      nudged_at: null,
      activity,
      member: ID(s.people[0]),
      member_id: ID(s.people[0]),
      member_name: CAST[s.people[0]].name,
      created_at: activity[0]?.at ?? at(-1, "9:00 AM"),
      updated_at: activity[activity.length - 1]?.at ?? at(0, "9:00 AM"),
    };
    t.people = s.people.map((k) => ({ member_id: ID(k), name: CAST[k].name, state: "sent", steps_total: 0, steps_done: 0, seen_at: null, done_at: null }));
    return settle(t, false);
  });
  const db: Db = { tasks, lines, read, prev: {}, nextId: 100, nextLine: lineId };
  db.tasks.forEach((t) => summarise(db, t));
  return db;
}

/** People's states and step counts from the steps, the activity and the status (no status change). */
function settle(t: TeamTaskJson, move = true): TeamTaskJson {
  const act = t.activity;
  const people = t.people ?? [];
  people.forEach((p) => {
    const mine = t.steps.filter((s) => s.owner_id === p.member_id);
    p.steps_total = mine.length;
    p.steps_done = mine.filter((s) => s.done).length;
    const seen = act.find((a) => (a.action === "seen" || a.action === "accepted") && a.member_id === p.member_id);
    p.seen_at = seen?.at ?? p.seen_at ?? null;
    const lastDone = mine.filter((s) => s.done && s.done_at).map((s) => s.done_at as string).sort().pop();
    const markedDone = [...act].reverse().find((a) => a.action === "done" && a.member_id === p.member_id);
    let state: typeof p.state = p.seen_at ? "seen" : "sent";
    const touched = act.some((a) => ["started", "step_done", "taken"].includes(a.action) && a.member_id === p.member_id);
    if (touched) state = "progress";
    if ((mine.length && p.steps_done === mine.length) || (!t.steps.length && markedDone)) state = "done";
    if (t.status === "review" || t.status === "approved") state = "done";
    if (t.status === "help" && t.help_note && [...act].reverse().find((a) => a.action === "help")?.member_id === p.member_id) state = "help";
    if (t.status === "cantdo" && [...act].reverse().find((a) => a.action === "cantdo")?.member_id === p.member_id) state = "cantdo";
    p.state = state;
    p.done_at = state === "done" ? (lastDone ?? markedDone?.at ?? p.done_at ?? null) : null;
  });
  if (move && ["progress", "seen", "sent"].includes(t.status)) {
    const allDone = t.steps.length ? t.steps.every((s) => s.done) : people.length > 0 && people.every((p) => p.state === "done");
    if (allDone) {
      t.status = "review";
      const last = [...t.activity].reverse().find((a) => a.by === "member" && a.member_id != null);
      t.activity.push({ at: new Date().toISOString(), by: "member", action: "done", note: "", member_id: last?.member_id ?? people[0]?.member_id, name: last?.name ?? people[0]?.name });
    }
  }
  const first = people[0];
  if (first) {
    t.member = first.member_id;
    t.member_id = first.member_id;
    t.member_name = first.name;
  }
  return t;
}

function summarise(db: Db, t: TeamTaskJson): void {
  const mine = db.lines.filter((l) => l.task === t.id);
  const last = mine[mine.length - 1];
  const readAt = db.read[t.id] ?? 0;
  t.chat = {
    count: mine.length,
    unread: mine.filter((l) => l.by.kind === "member" && Date.parse(l.at) > readAt).length,
    last: last ? { text: last.body, by: last.by.kind === "owner" ? "You" : last.by.name.split(" ")[0], at: last.at } : null,
  };
}

const store = sampleStore<Db>("teamTasks.v14", seedDb);

function save(db: Db): void {
  db.tasks.forEach((t) => summarise(db, t));
  store.set(db);
}

function find(db: Db, id: number): TeamTaskJson {
  const t = db.tasks.find((x) => x.id === id);
  if (!t) throw new Error("That task is gone.");
  return t;
}

const nowIso = () => new Date().toISOString();
function log(t: TeamTaskJson, action: string, note = "", memberId: number | null = null): void {
  t.activity.push({ at: nowIso(), by: memberId == null ? "owner" : "member", action, note, member_id: memberId, name: memberId == null ? undefined : NAME_OF(memberId) });
  t.updated_at = nowIso();
}
function say(db: Db, t: TeamTaskJson, by: TaskChatLineJson["by"], body: string): Line {
  const line: Line = { id: db.nextLine++, task: t.id, by, body, at: nowIso() };
  db.lines.push(line);
  if (by.kind === "owner") db.read[t.id] = Date.now();
  t.updated_at = line.at;
  return line;
}
const out = <T,>(v: T, ms = 140) => sample(v, undefined, ms);

// ---- the members play their part ----
const timers: number[] = [];
function later(fn: (db: Db) => void, ms: number): void {
  timers.push(
    window.setTimeout(() => {
      const db = store.get();
      fn(db);
      save(db);
      changed();
    }, ms),
  );
}

function memberTick(db: Db, id: number, stepId: number, memberId: number): void {
  const t = db.tasks.find((x) => x.id === id);
  const s = t?.steps.find((x) => x.id === stepId);
  if (!t || !s || s.done || !["sent", "seen", "progress"].includes(t.status)) return;
  s.done = true;
  s.done_by_id = memberId;
  s.done_at = nowIso();
  if (t.status !== "progress") t.status = "progress";
  log(t, "step_done", s.title, memberId);
  settle(t);
}

/** After a nudge: the person starts, or (relay) whoever's turn it is ticks their run of steps and hands over. */
function afterNudge(id: number, target: number | null): void {
  const db = store.get();
  const t0 = db.tasks.find((x) => x.id === id);
  if (!t0) return;
  let wait = 2000;
  if (t0.status === "sent" || t0.status === "seen") {
    later((d) => {
      const t = d.tasks.find((x) => x.id === id);
      if (!t || !["sent", "seen"].includes(t.status)) return;
      (t.people ?? []).forEach((p) => {
        if (!p.seen_at) log(t, "seen", "", p.member_id);
      });
      t.status = "progress";
      log(t, "started", "", t.people?.[0]?.member_id ?? null);
      settle(t);
    }, wait);
    wait += 2000;
  }
  const cur = t0.steps.findIndex((s) => !s.done);
  if (t0.in_order && target != null && cur >= 0) {
    const run: number[] = [];
    for (let i = cur; i < t0.steps.length && t0.steps[i].owner_id === target; i++) run.push(t0.steps[i].id);
    run.forEach((sid) => {
      later((d) => memberTick(d, id, sid, target), wait);
      wait += 2000;
    });
    later((d) => {
      const t = d.tasks.find((x) => x.id === id);
      if (!t) return;
      t.nudged_at = null;
      const next = t.steps.find((s) => !s.done);
      if (next?.owner_id) say(d, t, { kind: "member", member_id: target, name: NAME_OF(target) }, `My part is done. ${NAME_OF(next.owner_id).split(" ")[0]}, over to you.`);
    }, wait);
  } else if (!t0.in_order && (t0.people?.length ?? 0) === 1 && cur >= 0 && t0.status === "progress") {
    const who = t0.people?.[0]?.member_id ?? 0;
    later((d) => memberTick(d, id, t0.steps[cur].id, who), wait);
  }
}

// ---- the source ----
export const teamTasksSample: TeamTasksSource = {
  list(signal) {
    const db = store.get();
    db.tasks.forEach((t) => summarise(db, t));
    return sample([...db.tasks].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)), signal);
  },
  create(input: TeamTaskCreate) {
    const db = store.get();
    const id = Math.max(db.nextId, ...db.tasks.map((t) => t.id + 1));
    db.nextId = id + 1;
    const people = input.member_ids.map((m) => ({ member_id: m, name: NAME_OF(m), state: "sent" as const, steps_total: 0, steps_done: 0, seen_at: null, done_at: null }));
    const group = input.group_id ? GROUPS.find((g) => g.id === input.group_id) : undefined;
    const t: TeamTaskJson = {
      id,
      title: input.title,
      note: input.note,
      due_at: input.due_at,
      priority: input.priority,
      status: "sent",
      mode: input.member_ids.length > 1 ? input.mode : "all",
      in_order: input.in_order && input.steps.length > 1,
      repeat: input.repeat,
      next_on: null,
      group_id: group && input.post_in_group ? group.id : null,
      group_name: group && input.post_in_group ? group.name : undefined,
      people,
      steps: input.steps.map((s, i) => ({ id: id * 100 + i + 1, title: s.title, done: false, owner_id: s.owner_id, done_by_id: null, done_at: null })),
      help_note: "",
      cantdo_note: "",
      reopen_note: "",
      nudged_at: null,
      activity: [],
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    if (input.repeat && input.due_at) {
      const d = new Date(input.due_at);
      if (input.repeat === "day") d.setDate(d.getDate() + 1);
      else if (input.repeat === "week") d.setDate(d.getDate() + 7);
      else d.setMonth(d.getMonth() + 1);
      t.next_on = d.toISOString().slice(0, 10);
    }
    log(t, "created");
    if (t.group_id) log(t, "posted", group?.name ?? "");
    settle(t);
    db.tasks.unshift(t);
    save(db);
    // They see it in their Zinwe app shortly after.
    later((d) => {
      const x = d.tasks.find((y) => y.id === id);
      if (!x || x.status !== "sent") return;
      (x.people ?? []).filter((p) => CAST[(Object.keys(CAST) as K[]).find((k) => CAST[k].id === p.member_id) ?? "priya"]?.online).forEach((p) => log(x, "seen", "", p.member_id));
      if (x.activity.some((a) => a.action === "seen")) x.status = "seen";
      settle(x);
    }, 6000);
    return out(structuredClone(t));
  },
  patch(id: number, patch: TeamTaskPatch) {
    const db = store.get();
    const t = find(db, id);
    let edited = false;
    if (patch.title !== undefined && patch.title !== t.title) {
      t.title = patch.title;
      edited = true;
    }
    if (patch.note !== undefined && patch.note !== t.note) {
      t.note = patch.note;
      edited = true;
    }
    if (patch.priority !== undefined && patch.priority !== t.priority) {
      t.priority = patch.priority;
      edited = true;
    }
    if (patch.mode !== undefined) t.mode = patch.mode;
    if (patch.due_at !== undefined && patch.due_at !== t.due_at) {
      t.due_at = patch.due_at;
      t.nudged_at = null;
      edited = true;
    }
    if (patch.in_order !== undefined) t.in_order = patch.in_order;
    if (patch.repeat !== undefined && patch.repeat !== (t.repeat ?? "")) {
      t.repeat = patch.repeat;
      const d = new Date(t.due_at ?? Date.now());
      if (patch.repeat === "day") d.setDate(d.getDate() + 1);
      else if (patch.repeat === "week") d.setDate(d.getDate() + 7);
      else if (patch.repeat === "month") d.setMonth(d.getMonth() + 1);
      t.next_on = patch.repeat ? d.toISOString().slice(0, 10) : null;
      log(t, "repeat", patch.repeat);
    }
    if (patch.steps) {
      const old = t.steps;
      let next = Math.max(id * 100, ...old.map((s) => s.id)) + 1;
      const added: string[] = [];
      t.steps = patch.steps.map((s) => {
        const o = s.id != null ? old.find((x) => x.id === s.id) : undefined;
        if (o) {
          if (o.title !== s.title) edited = true;
          return { ...o, title: s.title, owner_id: s.owner_id };
        }
        added.push(s.title);
        return { id: next++, title: s.title, done: false, owner_id: s.owner_id, done_by_id: null, done_at: null };
      });
      if (old.some((o) => !t.steps.find((s) => s.id === o.id))) edited = true;
      added.forEach((title) => log(t, "step_added", title));
      if (added.length && t.status === "review") t.status = "progress";
      // A step owner who isn't on the task yet joins it.
      t.steps.forEach((s) => {
        if (s.owner_id != null && !t.people?.some((p) => p.member_id === s.owner_id)) {
          t.people?.push({ member_id: s.owner_id, name: NAME_OF(s.owner_id), state: "sent", steps_total: 0, steps_done: 0, seen_at: null, done_at: null });
        }
      });
    }
    if (edited) log(t, "edited");
    settle(t);
    save(db);
    return out(structuredClone(t));
  },
  act(id: number, body: TeamTaskAction) {
    const db = store.get();
    const t = find(db, id);
    const owner = lineBy("me");
    switch (body.action) {
      case "approve": {
        t.status = "approved";
        log(t, "approved");
        if (t.repeat) {
          const nid = Math.max(db.nextId, ...db.tasks.map((x) => x.id + 1));
          db.nextId = nid + 1;
          const due = new Date(t.due_at ?? Date.now());
          if (t.repeat === "day") due.setDate(due.getDate() + 1);
          else if (t.repeat === "week") due.setDate(due.getDate() + 7);
          else due.setMonth(due.getMonth() + 1);
          const copy: TeamTaskJson = structuredClone(t);
          Object.assign(copy, { id: nid, status: "sent", due_at: due.toISOString(), activity: [], created_at: nowIso(), updated_at: nowIso(), nudged_at: null, help_note: "", cantdo_note: "", reopen_note: "" });
          copy.steps = copy.steps.map((s, i) => ({ ...s, id: nid * 100 + i + 1, done: false, done_by_id: null, done_at: null }));
          copy.people = (copy.people ?? []).map((p) => ({ ...p, state: "sent", seen_at: null, done_at: null }));
          log(copy, "repeat_made");
          settle(copy);
          db.tasks.unshift(copy);
        }
        break;
      }
      case "reopen": {
        const note = body.note.trim() || "Please take another look.";
        t.status = "progress";
        t.reopen_note = note;
        (t.people ?? []).forEach((p) => p.state === "done" && (p.state = "progress"));
        say(db, t, owner, `Reopened: ${note}`);
        log(t, "reopened", note);
        break;
      }
      case "nudge": {
        t.nudged_at = nowIso();
        const cur = t.steps.find((s) => !s.done);
        const target = body.member_id ?? (t.in_order && cur?.owner_id ? cur.owner_id : null);
        t.activity.push({ at: nowIso(), by: "owner", action: "nudged", note: "", member_id: null, name: target ? NAME_OF(target) : undefined });
        save(db);
        afterNudge(id, target);
        return out(structuredClone(t));
      }
      case "reply": {
        say(db, t, owner, body.note);
        if (t.status === "help") {
          t.status = "progress";
          t.help_note = "";
        }
        log(t, "replied");
        break;
      }
      case "reassign": {
        const from = (t.people ?? []).map((p) => p.name.split(" ")[0]).join(" and ");
        const to = NAME_OF(body.member_id);
        t.people = [{ member_id: body.member_id, name: to, state: "sent", steps_total: 0, steps_done: 0, seen_at: null, done_at: null }];
        t.steps.forEach((s) => {
          if (!s.done) s.owner_id = body.member_id;
        });
        t.status = "sent";
        t.cantdo_note = "";
        t.help_note = "";
        t.nudged_at = null;
        log(t, "reassigned", `from ${from} to ${to.split(" ")[0]}`);
        t.activity[t.activity.length - 1].name = to;
        break;
      }
      case "move_due": {
        t.due_at = body.due_at;
        t.nudged_at = null;
        const d = new Date(body.due_at);
        log(t, "due_moved", `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "")}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`);
        break;
      }
      case "cancel": {
        db.prev[id] = t.status;
        t.status = "cancelled";
        log(t, "cancelled");
        break;
      }
      case "restore": {
        t.status = db.prev[id] && db.prev[id] !== "cancelled" ? db.prev[id] : "progress";
        log(t, "restored");
        break;
      }
    }
    settle(t, body.action !== "reopen" && body.action !== "restore");
    save(db);
    return out(structuredClone(t));
  },
  chat(id, signal) {
    return sample(
      store.get().lines.filter((l) => l.task === id).map(({ id: lid, by, body, at: when }) => ({ id: lid, by, body, at: when })),
      signal,
      120,
    );
  },
  say(id, body) {
    const db = store.get();
    const t = find(db, id);
    const line = say(db, t, lineBy("me"), body);
    save(db);
    return out({ id: line.id, by: line.by, body: line.body, at: line.at }, 80);
  },
  read(id) {
    const db = store.get();
    db.read[id] = Date.now();
    save(db);
    return out(undefined, 20);
  },
  groups(signal) {
    return sample(structuredClone(GROUPS), signal, 60);
  },
  copyToChat() {
    return out(undefined, 120);
  },
};

/** Forced sample tasks (`?sample=tasks` or localStorage "zinwe.sample.tasks" = "1"), only where samples may show. */
export function teamTasksSampleForced(): boolean {
  if (!SAMPLES_ON) return false;
  try {
    return new URLSearchParams(window.location.search).get("sample") === "tasks" || window.localStorage.getItem("zinwe.sample.tasks") === "1";
  } catch {
    return false;
  }
}

/** Start the story again (the sample store keeps changes for the tab's life). */
export function resetTeamTasksSample(): void {
  timers.splice(0).forEach((t) => window.clearTimeout(t));
  store.set(seedDb());
  changed();
}
