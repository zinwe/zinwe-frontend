/**
 * v1.4.1 — Chat prefs as data, "Make a task" from a message, group chats in the bell, leave rows in Needs you.
 * Run: npm test (node --test; Node strips the types, these modules have no runtime imports).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatGroup } from "../src/lib/api/chat.ts";
import { taskFromMessage, TASK_TITLE_MAX } from "../src/dashboard/chat/makeTask.ts";
import { EMPTY_PREFS, isEmptyPrefs, normalisePrefs, samePrefs, withMarked, withMute, withoutKey, withPin } from "../src/dashboard/chat/prefsModel.ts";
import { groupChatItems, groupLastLine } from "../src/dashboard/shell/bellGroups.ts";
import { leaveDay, leaveDoneText, leaveTitle } from "../src/dashboard/overview/leave.ts";
import { needsCounts } from "../src/dashboard/overview/needs.ts";

// ---- prefs ----

test("prefs: normalise keeps key shapes, drops repeats, caps pins at 3", () => {
  const p = normalisePrefs({ pins: ["p7", "g3", "p7", "x1", 5, "g4", "p9"], muted: ["g5", "nope"], marked: null });
  assert.deepEqual(p, { pins: ["p7", "g3", "g4"], muted: ["g5"], marked: [] });
  assert.deepEqual(normalisePrefs(null), EMPTY_PREFS);
  assert.ok(isEmptyPrefs(normalisePrefs({})));
});

test("prefs: a 4th pin is refused; unpin frees a place", () => {
  let p = normalisePrefs({ pins: ["p1", "p2", "g3"] });
  assert.equal(withPin(p, "p4"), null);
  p = withPin(p, "p2")!;
  assert.deepEqual(p.pins, ["p1", "g3"]);
  assert.deepEqual(withPin(p, "p4")!.pins, ["p1", "g3", "p4"]);
});

test("prefs: mute toggles, marking is a no-op when unchanged, a gone chat leaves every list", () => {
  const p = withMute(EMPTY_PREFS, "g5");
  assert.deepEqual(p.muted, ["g5"]);
  assert.deepEqual(withMute(p, "g5").muted, []);
  const m = withMarked(p, "p9", true);
  assert.deepEqual(m.marked, ["p9"]);
  assert.equal(withMarked(m, "p9", true), m);
  const all = normalisePrefs({ pins: ["g5", "p1"], muted: ["g5"], marked: ["g5"] });
  assert.deepEqual(withoutKey(all, "g5"), { pins: ["p1"], muted: [], marked: [] });
  assert.equal(withoutKey(all, "g9"), all);
  assert.ok(samePrefs(all, normalisePrefs({ pins: ["g5", "p1"], muted: ["g5"], marked: ["g5"] })));
  assert.ok(!samePrefs(all, withoutKey(all, "g5")));
});

// ---- Make a task ----

test("make a task: a short line is the title, no details, no @tags or full stop", () => {
  assert.deepEqual(taskFromMessage("  @Karan please send the logo files today.  "), { title: "please send the logo files today", details: "" });
  assert.deepEqual(taskFromMessage("Fix the login page!"), { title: "Fix the login page", details: "" });
});

test("make a task: a long or many-line message is cut to the first line, the full text goes to details", () => {
  const long = `${"Check the quarterly numbers for the Lumen client ".repeat(4)}and send them over`;
  const t = taskFromMessage(long);
  assert.ok(t.title.length <= TASK_TITLE_MAX);
  assert.ok(t.title.endsWith("…"));
  assert.ok(!t.title.includes("  "));
  assert.equal(t.details, long);
  const multi = taskFromMessage("Book the venue\nfor Friday, 40 people\nwith lunch");
  assert.equal(multi.title, "Book the venue");
  assert.equal(multi.details, "Book the venue\nfor Friday, 40 people\nwith lunch");
});

test("make a task: only an @tag still gives a title", () => {
  assert.equal(taskFromMessage("@Priya").title, "@Priya");
});

// ---- Bell: group chats ----

const group = (o: Partial<ChatGroup>): ChatGroup => ({
  id: 3,
  kind: "group",
  name: "Design",
  icon: "",
  announce: false,
  member_ids: [4, 9],
  unread: 2,
  mentioned: false,
  last_message: { text: "Starting after lunch", by: { kind: "member", member_id: null, name: "Karan" }, at: "2026-11-08T09:00:00Z", system: false, task_id: null },
  last_message_at: "2026-11-08T09:00:00Z",
  created_at: "",
  ...o,
});

test("bell: an unread group shows its name, the line and the count, and opens the group", () => {
  const [item, ...rest] = groupChatItems([group({}), group({ id: 4, name: "Everyone", unread: 0 })]);
  assert.equal(rest.length, 0);
  assert.equal(item.title, "Design · Karan: Starting after lunch");
  assert.equal(item.body, "2 unread in Chat.");
  assert.equal(item.href, "/app/chat/g-3");
  assert.equal(item.at, "2026-11-08T09:00:00Z");
});

test("bell: muted groups stay quiet; a new line gives a new id", () => {
  assert.equal(groupChatItems([group({})], ["g3"]).length, 0);
  const a = groupChatItems([group({})])[0].id;
  const b = groupChatItems([group({ unread: 3, last_message_at: "2026-11-08T09:05:00Z" })])[0].id;
  assert.notEqual(a, b);
});

test("bell: the owner's own line reads You, a task reads Task:, a system line as it is", () => {
  const own = group({ last_message: { text: "Over to you", by: { kind: "member", member_id: null, name: "Ananya" }, at: "", system: false, task_id: null } });
  assert.equal(groupLastLine(own, "Ananya"), "You: Over to you");
  const task = group({ last_message: { text: "Send the logo", by: { kind: "member", member_id: null, name: "Karan" }, at: "", system: false, task_id: 12 } });
  assert.equal(groupLastLine(task), "Karan: Task: Send the logo");
  const sys = group({ last_message: { text: "You added Emily.", by: null, at: "", system: true, task_id: null } });
  assert.equal(groupLastLine(sys), "You added Emily.");
});

// ---- Leave in Needs you ----

const NOW = new Date(2026, 10, 8, 11, 0, 0).getTime(); // Sun 8 Nov 2026

test("leave: the row says who, what and when", () => {
  assert.equal(leaveTitle({ member_name: "Sneha Reddy", date: "2026-11-12", half: true }, NOW), "Sneha Reddy asked for a half day off on Thu 12 Nov");
  assert.equal(leaveTitle({ member_name: "Karan Malhotra", date: "2026-11-09", half: false }, NOW), "Karan Malhotra asked for a day off tomorrow");
  assert.equal(leaveDay("2027-01-04", NOW), "Mon 4 Jan 2027");
  assert.equal(leaveDay("2026-11-08", NOW), "today");
  assert.equal(leaveDoneText({ member_name: "Sneha Reddy" }, "approve"), "Approved. Sneha sees it in the Zinwe window.");
  assert.equal(leaveDoneText({ member_name: "" }, "decline"), "Declined. They see it in the Zinwe window.");
});

test("leave: waiting requests count into Needs you with the other requests", () => {
  const c = needsCounts([], [], [], [{ status: "requested" }, { status: "approved" }, { status: "requested" }]);
  assert.deepEqual(c, { req: 2, alerts: 0, tasks: 0, total: 2 });
  assert.equal(needsCounts([], [], []).total, 0);
});
