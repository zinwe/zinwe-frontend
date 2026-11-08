/**
 * Team tasks v1.4 — the engine's sentences, buttons, lanes and quick-add parsing (src/dashboard/tasks2/engine.ts).
 * Run: npm test (node --test; Node strips the types, the engine has no runtime imports).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { TeamTaskJson } from "../src/lib/api/teamTasks.ts";
import { buildDirectory, dueOf, happen, journey, laneOf, personState, qaParse, toTask } from "../src/dashboard/tasks2/engine.ts";

const NOW = new Date(2026, 10, 7, 15, 0, 0).getTime(); // Sat 7 Nov 2026, 3:00 PM
const at = (d: number, h: number, m = 0) => new Date(2026, 10, 7 + d, h, m).toISOString();

const members = [
  { id: 4, name: "Priya Nair", role: "designer" as const, is_active: true, device: null },
  { id: 7, name: "Karan Malhotra", role: "developer" as const, is_active: true, device: null },
  { id: 9, name: "Emily Carter", role: "designer" as const, is_active: true, device: null },
  { id: 12, name: "Jake Thompson", role: "developer" as const, is_active: true, device: { hostname: "KC", last_seen_at: at(0, 8, 34), is_online: false } },
];
const dir = buildDirectory(members as never, [{ id: 3, name: "Design", member_ids: [4, 9] }], [], "Ananya Rao");

function task(o: Partial<TeamTaskJson> & { people?: TeamTaskJson["people"] }): TeamTaskJson {
  return {
    id: 1,
    title: "A task",
    note: "",
    due_at: at(0, 18),
    priority: "normal",
    status: "sent",
    mode: "all",
    in_order: false,
    repeat: "",
    next_on: null,
    group_id: null,
    steps: [],
    activity: [{ at: at(0, 8, 34), by: "owner", action: "created", note: "" }],
    created_at: at(0, 8, 34),
    updated_at: at(0, 8, 34),
    people: [{ member_id: 12, name: "Jake Thompson", state: "sent", steps_total: 0, steps_done: 0, seen_at: null, done_at: null }],
    ...o,
  };
}
const person = (id: number, name: string, state: string, extra: object = {}) =>
  ({ member_id: id, name, state, steps_total: 0, steps_done: 0, seen_at: at(-2, 9, 30), done_at: null, ...extra }) as NonNullable<TeamTaskJson["people"]>[number];
const H = (raw: TeamTaskJson) => happen(toTask(raw, dir, NOW), dir, NOW);

test("sent, not seen, PC offline: the offline sentence, the email line and Nudge", () => {
  const h = H(task({}));
  assert.equal(h.text, "Not seen yet. Jake’s PC has been offline since 8:34 AM.");
  assert.ok(h.sub.some((s) => s.startsWith("A copy went to Jake’s email")));
  assert.deepEqual(h.btns.map((b) => b.label), ["Nudge"]);
});

test("seen, not started", () => {
  const h = H(task({ status: "seen", due_at: at(1, 18), people: [person(4, "Priya Nair", "seen", { seen_at: at(0, 8, 40) })] }));
  assert.equal(h.text, "Priya saw it at 8:40 AM but hasn’t started.");
  assert.equal(h.btns[0].label, "Nudge");
});

test("team relay: whose turn it is, Nudge that person, people words", () => {
  const raw = task({
    status: "progress",
    in_order: true,
    people: [person(4, "Priya Nair", "done"), person(7, "Karan Malhotra", "progress"), person(9, "Emily Carter", "seen")],
    steps: [
      { id: 1, title: "Write the page copy", done: true, owner_id: 4, done_by_id: 4, done_at: at(-1, 10, 2) },
      { id: 2, title: "Pick the hero images", done: true, owner_id: 4, done_by_id: 4, done_at: at(0, 11, 40) },
      { id: 3, title: "Build the hero section", done: false, owner_id: 7 },
      { id: 4, title: "Connect the signup form", done: false, owner_id: 7 },
      { id: 5, title: "Check it on phones", done: false, owner_id: 9 },
      { id: 6, title: "Final check with Ananya", done: false, owner_id: 9 },
    ],
  });
  const t = toTask(raw, dir, NOW);
  const h = happen(t, dir, NOW);
  assert.equal(h.text, "Karan’s turn: step 3 of 6, Build the hero section.");
  assert.equal(h.btns[0].label, "Nudge Karan");
  assert.equal(personState(t, "m4", dir).word, "Done");
  assert.equal(personState(t, "m7", dir).word, "Their turn");
  assert.equal(personState(t, "m9", dir).word, "Waits for Karan");
  assert.deepEqual(journey(t, dir, NOW).map((j) => j.label), ["Sent", "Seen 3/3", "Working", "Done 1/3", "Your OK"]);
  // Member side (Windows wording)
  assert.equal(happen(t, dir, NOW, "member", "m7", "Ananya").btns[0].label, "Tick step 3");
  assert.equal(happen(t, dir, NOW, "member", "m9", "Ananya").text, "Waits for Karan: step 3 (Build the hero section).");
});

test("needs help: the quote and Reply", () => {
  const h = H(task({ status: "help", help_note: "Which hero image, A or B?", people: [person(9, "Emily Carter", "help")] }));
  assert.equal(h.text, "Emily needs help: “Which hero image, A or B?”");
  assert.deepEqual(h.btns.map((b) => [b.label, b.pri]), [["Reply", true]]);
});

test("can't do it: Reassign + Reply, a Needs you lane", () => {
  const raw = task({ status: "cantdo", cantdo_note: "No admin access to the server.", people: [person(12, "Jake Thompson", "cantdo")] });
  const h = H(raw);
  assert.equal(h.text, "Jake can’t do it: “No admin access to the server.”");
  assert.deepEqual(h.btns.map((b) => b.label), ["Reassign", "Reply"]);
  assert.equal(laneOf(toTask(raw, dir, NOW), NOW), "needs");
});

test("everyone done: Approve + Reopen…", () => {
  const h = H(task({ status: "review", people: [person(4, "Priya Nair", "done"), person(9, "Emily Carter", "done")] }));
  assert.equal(h.text, "Everyone is done. Check the work and give your OK.");
  assert.deepEqual(h.btns.map((b) => b.label), ["Approve", "Reopen…"]);
});

test("late: the day count, Nudge + Move due date, the Late lane", () => {
  const raw = task({ status: "seen", due_at: at(-1, 18), people: [person(12, "Jake Thompson", "seen")] });
  const t = toTask(raw, dir, NOW);
  assert.equal(dueOf(t, NOW).chip, "1 day late");
  assert.equal(happen(t, dir, NOW).text, "1 day late. Jake hasn’t started.");
  assert.deepEqual(happen(t, dir, NOW).btns.map((b) => b.label), ["Nudge", "Move due date"]);
  assert.equal(laneOf(t, NOW), "late");
});

test("nudged in the last hour: a disabled Nudged button", () => {
  const h = H(task({ status: "seen", nudged_at: at(0, 14, 30), people: [person(12, "Jake Thompson", "seen")] }));
  assert.ok(h.btns.some((b) => b.label === "Nudged" && b.off));
});

test("approved, cancelled, reopened, repeat", () => {
  const ok = H(task({ status: "approved", activity: [{ at: at(-2, 15), by: "owner", action: "created", note: "" }, { at: at(-1, 16, 10), by: "owner", action: "approved", note: "" }], created_at: at(-2, 15) }));
  assert.match(ok.text, /^You approved it Fri 6 Nov, 4:10 PM\. 1 day, 1 person\.$/);
  assert.equal(ok.btns[0].label, "Reopen");
  const gone = H(task({ status: "cancelled", activity: [{ at: at(0, 9), by: "owner", action: "cancelled", note: "" }] }));
  assert.equal(gone.btns[0].label, "Restore");
  const again = H(task({ status: "progress", reopen_note: "Use the new orange.", repeat: "month", next_on: "2026-12-01", people: [person(4, "Priya Nair", "progress")] }));
  assert.ok(again.sub.includes("You reopened it: “Use the new orange.”"));
  assert.ok(again.sub.some((s) => s.startsWith("Repeats every month · next on Tue 1 Dec")));
});

test("an older backend's task (no people) still reads as one person", () => {
  const raw = task({ people: undefined, member_id: 12, member_name: "Jake Thompson", status: "progress" });
  const t = toTask(raw, dir, NOW);
  assert.deepEqual(t.people, ["m12"]);
  assert.equal(happen(t, dir, NOW).text, "Jake is on it.");
});

test("quick add: @name, date words, time and !", () => {
  const p = qaParse("Send the October invoices @Priya tomorrow 5pm !", dir, NOW);
  assert.equal(p.title, "Send the October invoices");
  assert.deepEqual(p.keys, ["m4"]);
  assert.deepEqual(p.due, { d: 1, time: "5:00 PM" });
  assert.equal(p.high, true);
  const g = qaParse("Fix the printer @Design fri", dir, NOW);
  assert.deepEqual(g.keys, ["m4", "m9"]);
  assert.equal(g.due.d, 6);
  assert.equal(qaParse("Call them @Pr", dir, NOW).atFrag, "pr");
});
