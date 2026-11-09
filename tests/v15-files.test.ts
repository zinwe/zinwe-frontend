/**
 * v1.5 file sharing in chat, round 2 (files stay on the sender's device), owner dashboard: reading FileJSON (and
 * round-1 shapes), kinds, GB formatting and the plan limits, the pick limits, the send tray, the batch grid, the
 * bubble and download states, tickets and relay jobs, and the list of files this browser keeps.
 * Run: npm test (node --test; Node strips the types, the model has no runtime imports).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACCEPT,
  apiPathOf,
  batchRuns,
  bubbleOf,
  captionFor,
  checkPicks,
  dayText,
  dlView,
  durationText,
  extOf,
  FILE_COPY,
  fileTypeOf,
  fitWithin,
  formatSize,
  gbNumber,
  gridLayout,
  isLegacy,
  isRiskyName,
  kindOf,
  legacyPath,
  MAX_FILES,
  normaliseFile,
  parseHeld,
  parseJob,
  parseTicket,
  percent,
  planMaxBytes,
  previewOf,
  previewText,
  pruneHeld,
  relayOnline,
  ringDash,
  riskyText,
  sendFailure,
  settingsHelpText,
  sizeLine,
  ticketFresh,
  tileView,
  tooBigText,
  typeLabel,
  waitingText,
  type ChatFile,
  type HeldFile,
} from "../src/lib/chatFileModel.ts";

const GB = 1024 ** 3;

/** A round-2 FileJSON as the server sends it. */
const raw = (over: Record<string, unknown> = {}) => ({
  id: "6f1c",
  name: "Quote-Lumen.pdf",
  size: 2202009,
  mime: "application/pdf",
  kind: "document",
  caption: "Final version",
  risky: false,
  batch_id: null,
  width: null,
  height: null,
  duration_s: null,
  thumb_url: null,
  sender: { name: "Priya Sharma", first_name: "Priya" },
  mine: false,
  available: true,
  state: "ok",
  created_at: "2026-11-09T10:20:00Z",
  expires_at: "2026-12-09T10:20:00Z",
  expired: false,
  ...over,
});
const file = (over: Record<string, unknown> = {}): ChatFile => normaliseFile(raw(over)) as ChatFile;
const photo = (id: string, batch: string | null, over: Record<string, unknown> = {}) =>
  file({ id, name: `${id}.jpg`, mime: "image/jpeg", kind: "image", thumb_url: `https://backend.zinwe.io/api/chat/files/${id}/thumb/`, batch_id: batch, ...over });

// ---- sizes and the plan limit ----

test("size: bytes, KB rounded, MB and GB with one decimal (none when whole)", () => {
  assert.equal(formatSize(0), "0 B");
  assert.equal(formatSize(512), "512 B");
  assert.equal(formatSize(1024), "1 KB");
  assert.equal(formatSize(340 * 1024), "340 KB");
  assert.equal(formatSize(2202009), "2.1 MB");
  assert.equal(formatSize(25 * 1024 * 1024), "25 MB");
  assert.equal(formatSize(1.4 * GB), "1.4 GB");
  assert.equal(formatSize(3 * GB), "3 GB");
  assert.equal(formatSize(GB - 1000), "1 GB", "1023.99 MB rounds up into GB, never '1024 MB'");
  assert.equal(formatSize(-5), "0 B");
  assert.equal(formatSize(Number.NaN), "0 B");
});

test("plan limit: GB number, the too-big and settings copy, read from any field the server sends", () => {
  assert.equal(gbNumber(2 * GB), "2");
  assert.equal(gbNumber(1.5 * GB), "1.5");
  assert.equal(tooBigText(2 * GB), "Files can be up to 2 GB on your plan.");
  assert.equal(tooBigText(5120 * 1024 * 1024), "Files can be up to 5 GB on your plan.");
  assert.equal(settingsHelpText(3 * GB), "Files stay on the sender's PC or browser. Up to 3 GB each on your plan.");
  assert.equal(planMaxBytes({ file_max_bytes: 2 * GB }), 2 * GB);
  assert.equal(planMaxBytes({ max_bytes: 3 * GB }), 3 * GB);
  assert.equal(planMaxBytes({ file_max_mb: 1024 }), GB);
  assert.equal(planMaxBytes({ file_max_bytes: 0, file_max_mb: 2048 }), 2 * GB);
  assert.equal(planMaxBytes({}), null);
  assert.equal(planMaxBytes(null), null);
});

// ---- kinds, icons, names ----

test("kinds from extension + mime: image | video | audio | document | file (SVG is a file)", () => {
  assert.equal(kindOf("site.PNG"), "image");
  assert.equal(kindOf("clip.mov"), "video");
  assert.equal(kindOf("call.m4a"), "audio");
  assert.equal(kindOf("Quote.pdf"), "document");
  assert.equal(kindOf("Budget.xlsx"), "document");
  assert.equal(kindOf("all.7z"), "document");
  assert.equal(kindOf("logo.svg", "image/svg+xml"), "file");
  assert.equal(kindOf("setup.exe"), "file");
  assert.equal(kindOf("scan", "application/pdf"), "document");
  assert.equal(kindOf("blob", "video/mp4"), "video");
  assert.ok(ACCEPT.document.includes(".docx") && ACCEPT.document.includes(".7z"));
  assert.ok(ACCEPT.media.includes("image/*") && ACCEPT.media.includes(".mkv"));
});

test("size line, type label, type icon, risky", () => {
  assert.equal(sizeLine({ name: "Quote-Lumen.pdf", size: 2202009 }), "2.1 MB · PDF");
  assert.equal(sizeLine({ name: "README", size: 2048 }), "2 KB · File");
  assert.equal(typeLabel("Plan.DOCX"), "DOCX");
  assert.equal(extOf("archive.tar.gz"), "gz");
  assert.equal(extOf(".env"), "");
  assert.equal(fileTypeOf("Budget.xlsx"), "sheet");
  assert.equal(fileTypeOf("Deck.pptx"), "slide");
  assert.equal(fileTypeOf("demo.mov"), "video");
  assert.equal(fileTypeOf("data.bin"), "other");
  for (const n of ["setup.exe", "run.BAT", "x.ps1", "app.msix"]) assert.ok(isRiskyName(n), n);
  for (const n of ["a.pdf", "exe", "photo.png"]) assert.ok(!isRiskyName(n), n);
  assert.equal(riskyText("Karan"), "This is a program file. Open it only if you trust Karan.");
});

test("video length and preview size", () => {
  assert.equal(durationText(42), "0:42");
  assert.equal(durationText(62), "1:02");
  assert.equal(durationText(3723), "1:02:03");
  assert.equal(durationText(0), "0:00");
  assert.equal(durationText(null), "");
  assert.equal(durationText(undefined), "");
  assert.deepEqual(fitWithin(4000, 3000), { w: 320, h: 240 });
  assert.deepEqual(fitWithin(1080, 1920), { w: 180, h: 320 });
  assert.deepEqual(fitWithin(100, 50), { w: 100, h: 50 }, "never scaled up");
  assert.deepEqual(fitWithin(0, 50), { w: 0, h: 0 });
});

// ---- reading FileJSON ----

test("normaliseFile: missing or null = no file (an older backend renders lines as today)", () => {
  assert.equal(normaliseFile(undefined), null);
  assert.equal(normaliseFile(null), null);
  assert.equal(normaliseFile({}), null);
});

test("normaliseFile: the round-2 shape", () => {
  const f = file({ kind: "video", name: "walk.mp4", mime: "video/mp4", duration_s: 42, width: 1920, height: 1080, batch_id: "b1", thumb_url: "https://x/api/chat/files/6f1c/thumb/", mine: true });
  assert.equal(f.kind, "video");
  assert.equal(f.duration_s, 42);
  assert.equal(f.batch_id, "b1");
  assert.equal(f.mine, true);
  assert.equal(f.available, true);
  assert.equal(f.state, "ok");
  assert.deepEqual(f.sender, { name: "Priya Sharma", first_name: "Priya" });
  assert.equal(isLegacy(f), false);
  const stopped = file({ available: false, state: "stopped" });
  assert.equal(stopped.available, false);
  assert.equal(stopped.state, "stopped");
  assert.equal(file({ available: false, state: "ok" }).state, "old", "not available is never ok");
  assert.equal(file({ state: "nonsense" }).state, "ok");
  assert.equal(file({ sender: { name: "Rahul Verma" } }).sender?.first_name, "Rahul");
  assert.equal(file({ kind: "weird", name: "x.zip" }).kind, "document");
});

test("normaliseFile: a round-1 file (a url, no `available`) still renders without crashing", () => {
  const r1 = normaliseFile({ id: "ab", name: "site.png", size: 340, mime: "image/png", kind: "image", caption: "", risky: false, expires_at: "2026-11-16T10:20:00Z", expired: false, url: "https://backend.zinwe.io/api/chat/files/ab/" });
  assert.ok(r1);
  assert.equal(isLegacy(r1), true);
  assert.equal(r1.available, true);
  assert.equal(r1.kind, "image");
  assert.equal(r1.thumb_url, null);
  assert.equal(r1.mine, null);
  const gone = normaliseFile({ id: "ab", name: "setup.exe", size: "10", kind: "file", url: null, expired: true });
  assert.ok(gone);
  assert.equal(gone.available, false);
  assert.equal(gone.risky, true, "risky falls back to the extension");
  assert.equal(gone.kind, "file");
  assert.equal(normaliseFile({ id: "ab", name: "a.pdf", kind: "file", url: "x" })?.kind, "document", "round 1's 'file' maps to the round-2 kind");
  assert.equal(normaliseFile({ id: "ab", name: "x.png", kind: "image" })?.legacy_url, "", "round 1 without url: build the owner route");
  assert.equal(bubbleOf(r1, { mine: false, sender: "Karan" }).kind, "media", "a round-1 picture is still a thumbnail");
  assert.equal(bubbleOf(gone, { mine: false, sender: "Karan" }).kind, "gone");
});

test("paths: the token only goes to our API base", () => {
  assert.equal(apiPathOf("https://backend.zinwe.io/api/chat/files/6f1c/thumb/"), "/api/chat/files/6f1c/thumb/");
  assert.equal(apiPathOf("https://evil.example/steal"), null);
  assert.equal(apiPathOf(null), null);
  assert.equal(legacyPath({ id: "6f1c", legacy_url: "https://backend.zinwe.io/api/chat/files/6f1c/" }, true), "/api/chat/files/6f1c/?inline=1");
  assert.equal(legacyPath({ id: "6f1c", legacy_url: "https://evil.example/x" }), "/api/chat/files/6f1c/");
  assert.equal(legacyPath({ id: "6f1c", legacy_url: "" }), "/api/chat/files/6f1c/");
  assert.equal(legacyPath({ id: "6f1c", legacy_url: null }), null);
});

test("previewText: a file line previews as 📎 <name> (GB too)", () => {
  assert.equal(previewText("📎 Quote-Lumen.pdf (2.1 MB)\nFinal version", { name: "Quote-Lumen.pdf" }), "📎 Quote-Lumen.pdf");
  assert.equal(previewText("📎 Walk.mp4 (1.4 GB)"), "📎 Walk.mp4");
  assert.equal(previewText("📎 My (draft) plan.docx (340 KB)"), "📎 My (draft) plan.docx");
  assert.equal(previewText("Starting after lunch", null), "Starting after lunch");
});

// ---- picking: limits ----

test("picks: up to 10 in all, refused per file over the plan or empty, with the exact copy", () => {
  const f = (name: string, size: number) => ({ name, size });
  const max = 2 * GB;
  const ok = checkPicks([f("a.pdf", 10), f("b.jpg", 20)], 0, max);
  assert.deepEqual(ok, { take: [0, 1], notes: [] });
  const big = checkPicks([f("huge.mov", max + 1), f("a.pdf", 10)], 0, max);
  assert.deepEqual(big.take, [1]);
  assert.deepEqual(big.notes, [{ name: "huge.mov", text: "Files can be up to 2 GB on your plan." }]);
  assert.deepEqual(checkPicks([f("e.txt", 0)], 0, max).notes, [{ name: "e.txt", text: FILE_COPY.empty }]);
  const twelve = Array.from({ length: 12 }, (_, i) => f(`p${i}.jpg`, 1));
  const many = checkPicks(twelve, 0, max);
  assert.equal(many.take.length, MAX_FILES);
  assert.deepEqual(many.notes, [{ name: "", text: "You can send up to 10 files at a time." }]);
  const topUp = checkPicks([f("x.jpg", 1), f("y.jpg", 1), f("z.jpg", 1)], 8, max);
  assert.deepEqual(topUp.take, [0, 1]);
  assert.equal(topUp.notes[0].text, FILE_COPY.tooMany);
  assert.deepEqual(checkPicks([f("x.jpg", 1)], 10, max).take, []);
});

test("caption goes on the last file of a batch only", () => {
  assert.equal(captionFor(0, 3, "Site photos"), "");
  assert.equal(captionFor(1, 3, "Site photos"), "");
  assert.equal(captionFor(2, 3, "Site photos"), "Site photos");
  assert.equal(captionFor(0, 1, "Just one"), "Just one");
});

// ---- the send tray ----

test("tray tile: size, the copy %, sending, and failures (the server's words win)", () => {
  assert.deepEqual(tileView({ s: "ready" }, 2202009), { note: "2.1 MB", error: false, ring: null, busy: false });
  const holding = tileView({ s: "holding", progress: 0.42 }, 2202009);
  assert.equal(holding.ring, 0.42);
  assert.equal(holding.note, "2.1 MB · 42%");
  assert.ok(holding.busy);
  assert.equal(tileView({ s: "holding", progress: 7 }, 1).ring, 1);
  assert.equal(tileView({ s: "registering" }, 1).ring, "spin");
  assert.equal(tileView({ s: "posting" }, 1024).note, "1 KB · Sending…");
  const failed = tileView({ s: "failed", message: FILE_COPY.failed, retry: true }, 1);
  assert.ok(failed.error && !failed.busy);
  assert.deepEqual(sendFailure({ status: 0 }), { s: "failed", message: "Couldn't send. Try again.", retry: true });
  assert.deepEqual(sendFailure({ status: 500 }), { s: "failed", message: FILE_COPY.failed, retry: true });
  assert.deepEqual(sendFailure({ status: 400, message: "Files can be up to 2 GB on your plan." }), { s: "failed", message: "Files can be up to 2 GB on your plan.", retry: false });
  assert.deepEqual(sendFailure({ status: 400, message: "Too many files waiting. Send or remove some first." }).retry, true);
  assert.deepEqual(sendFailure({ status: 403, message: "Your admin has turned off file sharing." }), { s: "failed", message: FILE_COPY.off, retry: false });
  assert.deepEqual(sendFailure({ noRoom: true }), { s: "failed", message: "This browser can't share files this big. Use the Zinwe app or Chrome.", retry: false });
});

// ---- the batch grid ----

test("grid layout: one, two side by side, three with a wide top, 2 × 2 with +N on the 4th", () => {
  assert.deepEqual(gridLayout(0), []);
  assert.deepEqual(gridLayout(1), [{ index: 0, wide: false, more: 0 }]);
  assert.deepEqual(gridLayout(2).map((c) => c.wide), [false, false]);
  assert.deepEqual(gridLayout(3).map((c) => c.wide), [true, false, false]);
  const four = gridLayout(4);
  assert.equal(four.length, 4);
  assert.ok(four.every((c) => c.more === 0));
  const seven = gridLayout(7);
  assert.equal(seven.length, 4);
  assert.deepEqual(seven.map((c) => c.more), [0, 0, 0, 4], "the 4th shows itself and the 3 hidden ones");
  assert.equal(gridLayout(5)[3].more, 2);
});

test("batch runs: neighbouring photos/videos from one sender with one batch_id show on the run's last line", () => {
  const runs = batchRuns([
    { key: "a", from: "owner", file: null },
    { key: "b", from: "owner", file: photo("p1", "B1") },
    { key: "c", from: "owner", file: photo("p2", "B1", { kind: "video", name: "p2.mp4", mime: "video/mp4" }) },
    { key: "d", from: "owner", file: photo("p3", "B1", { caption: "Site visit" }) },
    { key: "e", from: "member", file: photo("p4", "B1") },
    { key: "f", from: "member", file: photo("p5", "B2") },
    { key: "g", from: "member", file: photo("p6", null) },
    { key: "h", from: "member", file: photo("p7", null) },
  ]);
  assert.deepEqual(runs.get("b"), { role: "skip" });
  assert.deepEqual(runs.get("c"), { role: "skip" });
  const lead = runs.get("d");
  assert.equal(lead?.role, "lead");
  if (lead?.role === "lead") assert.deepEqual(lead.files.map((f) => f.id), ["p1", "p2", "p3"]);
  for (const k of ["a", "e", "f", "g", "h"]) assert.equal(runs.get(k), undefined, `${k} stands alone`);
});

test("batch runs: documents, round-1 files and a break in the run don't group", () => {
  const doc = file({ id: "d1", batch_id: "B1" });
  const runs = batchRuns([
    { key: "1", from: "o", file: photo("p1", "B1") },
    { key: "2", from: "o", file: doc },
    { key: "3", from: "o", file: photo("p3", "B1") },
  ]);
  assert.equal(runs.size, 0);
  const legacy = normaliseFile({ id: "L", name: "a.png", kind: "image", url: "x", batch_id: "B9" });
  assert.equal(batchRuns([{ key: "1", from: "o", file: legacy }, { key: "2", from: "o", file: legacy }]).size, 0);
});

// ---- the bubble ----

test("bubble: no file = the line as today", () => {
  assert.deepEqual(bubbleOf(null, { mine: false, sender: "Karan" }), { kind: "text" });
  assert.deepEqual(bubbleOf(undefined, { mine: true, sender: "You" }), { kind: "text" });
});

test("bubble: a document card with size, type, caption; PDFs open in a tab", () => {
  const b = bubbleOf(file(), { mine: false, sender: "Priya" });
  assert.equal(b.kind, "doc");
  if (b.kind !== "doc") return;
  assert.equal(b.sizeLine, "2.1 MB · PDF");
  assert.equal(b.type, "pdf");
  assert.equal(b.caption, "Final version");
  assert.equal(b.preview, "tab");
  assert.equal(b.own, null);
  assert.equal(previewOf({ kind: "document", name: "Plan.docx", mime: "" }), null);
});

test("bubble: a photo or video with a preview is a tile (lightbox); without one it is a card", () => {
  const p = bubbleOf(photo("p1", null), { mine: false, sender: "Priya" });
  assert.equal(p.kind, "media");
  assert.equal(p.kind === "media" ? p.preview : null, "lightbox");
  const v = bubbleOf(photo("v1", null, { kind: "video", name: "walk.mov", thumb_url: null }), { mine: false, sender: "Priya" });
  assert.equal(v.kind, "doc");
  assert.equal(v.kind === "doc" ? v.preview : null, "lightbox", "still opens in the lightbox from its name");
});

test("bubble: stopped, gone or too old = Not shared any more.", () => {
  for (const state of ["stopped", "gone", "old"]) assert.equal(bubbleOf(file({ available: false, state }), { mine: false, sender: "Priya" }).kind, "gone");
  assert.equal(FILE_COPY.notShared, "Not shared any more.");
});

test("bubble: your own file kept in this browser says so; one kept elsewhere doesn't", () => {
  const here = bubbleOf(file({ mine: true }), { mine: true, sender: "You", heldHere: true });
  assert.equal(here.kind === "doc" ? here.own : "", "Kept in this browser. Others can download it while Zinwe is open here.");
  const elsewhere = bubbleOf(file({ mine: true }), { mine: true, sender: "You", heldHere: false });
  assert.equal(elsewhere.kind === "doc" ? elsewhere.own : "x", null);
  const theirs = bubbleOf(file({ mine: false }), { mine: false, sender: "Priya", heldHere: true });
  assert.equal(theirs.kind === "doc" ? theirs.own : "x", null);
});

test("bubble: a risky file from someone else carries the caution (named from the file's sender); your own doesn't", () => {
  const theirs = bubbleOf(file({ name: "setup.exe", risky: true, kind: "file" }), { mine: false, sender: "Someone" });
  assert.equal(theirs.kind === "doc" ? theirs.risky : "", "This is a program file. Open it only if you trust Priya.");
  const mine = bubbleOf(file({ name: "setup.exe", risky: true, kind: "file", mine: true }), { mine: false, sender: "You" });
  assert.equal(mine.kind === "doc" ? mine.risky : "x", null, "the server's `mine` wins");
});

// ---- downloading ----

test("download states: confirm, checking, waiting for the sender, saving with %, errors, gone", () => {
  assert.deepEqual(dlView({ s: "idle" }, "Priya"), { label: "Download", disabled: false, ring: null, note: null, noteKind: null, cancel: false });
  assert.equal(dlView({ s: "confirm" }, "Priya").label, "Download anyway");
  const checking = dlView({ s: "checking" }, "Priya");
  assert.ok(checking.disabled);
  assert.equal(checking.ring, "spin");
  const waiting = dlView({ s: "waiting" }, "Priya");
  assert.ok(waiting.disabled, "Download is off while the sender is away");
  assert.equal(waiting.note, "Waiting for Priya's PC…");
  assert.equal(waiting.noteKind, "wait");
  const saving = dlView({ s: "saving", progress: 0.375 }, "Priya");
  assert.equal(saving.ring, 0.375);
  assert.ok(saving.cancel && saving.disabled);
  assert.equal(dlView({ s: "saving", progress: null }, "Priya").ring, "spin");
  assert.equal(dlView({ s: "error", message: "Couldn't reach Zinwe." }, "Priya").noteKind, "error");
  assert.equal(dlView({ s: "gone" }, "Priya").note, "Not shared any more.");
  assert.equal(waitingText(""), "Waiting for the sender's PC…");
});

test("ring: % and stroke", () => {
  assert.equal(percent(0.424), "42%");
  assert.equal(percent(2), "100%");
  assert.equal(percent(-1), "0%");
  const full = ringDash(1, 10);
  assert.equal(full.dashoffset, "0.00");
  const half = ringDash(0.5, 10);
  assert.equal(Number(half.dashoffset), Number((Math.PI * 10).toFixed(2)));
});

// ---- tickets and the relay ----

test("tickets: parsed, inline_url made when missing, fresh while a minute is left", () => {
  const t = parseTicket({ url: "https://r/relay/file/1?t=abc", status_url: "https://r/relay/status/1?t=abc", expires_at: "2026-11-09T10:15:00Z" });
  assert.equal(t?.inline_url, "https://r/relay/file/1?t=abc&inline=1");
  assert.equal(parseTicket({ url: "" }), null);
  assert.equal(parseTicket(null), null);
  const now = Date.parse("2026-11-09T10:00:00Z");
  assert.ok(ticketFresh("2026-11-09T10:15:00Z", now));
  assert.ok(!ticketFresh("2026-11-09T10:00:30Z", now));
  assert.ok(!ticketFresh(null, now));
  assert.ok(ticketFresh("2026-11-10T10:00:00Z", now, 60 * 60 * 1000), "a serve ticket with a day left");
});

test("relay: online only when the status says so; jobs need a job and a file", () => {
  assert.equal(relayOnline({ online: false }), false);
  assert.equal(relayOnline({ online: true }), true);
  assert.equal(relayOnline(null), true, "an unreadable status lets the download say");
  assert.deepEqual(parseJob({ job: "j1", file_id: "f1", offset: 1048576 }), { job: "j1", file_id: "f1", offset: 1048576 });
  assert.deepEqual(parseJob({ job: "j1", file_id: "f1" }), { job: "j1", file_id: "f1", offset: 0 });
  assert.equal(parseJob({ job: "j1" }), null);
  assert.equal(parseJob(null), null);
});

// ---- files this browser keeps ----

test("kept files: read leniently, dropped after 30 days", () => {
  const now = Date.parse("2026-11-09T10:00:00Z");
  const h = (id: string, daysAgo: number): HeldFile => ({ id, ref: `r-${id}`, name: `${id}.pdf`, size: 1, mime: "", kind: "document", at: now - daysAgo * 86_400_000, chat: "Design" });
  const { keep, drop } = pruneHeld([h("a", 1), h("b", 31), h("c", 29)], now);
  assert.deepEqual(keep.map((x) => x.id), ["a", "c"]);
  assert.deepEqual(drop.map((x) => x.id), ["b"]);
  assert.deepEqual(parseHeld(null), []);
  assert.deepEqual(parseHeld("not json"), []);
  assert.deepEqual(parseHeld('{"a":1}'), []);
  const read = parseHeld(JSON.stringify([h("a", 1), { id: 5 }, { id: "x" }, { id: "y", ref: "r", kind: "odd" }]));
  assert.deepEqual(read.map((x) => x.id), ["a", "y"]);
  assert.equal(read[1].kind, "file");
  assert.equal(dayText(new Date(2026, 10, 9).getTime()), "9 Nov");
});

// ---- the bell's group line ----

test("bell: a group's newest file line reads 📎 <name> (from file.name, or the fallback text of an older JSON)", async () => {
  const { groupLastLine } = await import("../src/dashboard/shell/bellGroups.ts");
  const by = { kind: "member" as const, member_id: 4, name: "Karan" };
  const withFile = { last_message: { text: "📎 Quote.pdf (2.1 MB)\nFinal", by, at: "", system: false, task_id: null, file: { name: "Quote.pdf" } } };
  assert.equal(groupLastLine(withFile), "Karan: 📎 Quote.pdf");
  const fallbackOnly = { last_message: { text: "📎 Walk.mp4 (1.4 GB)\nFinal", by, at: "", system: false, task_id: null } };
  assert.equal(groupLastLine(fallbackOnly), "Karan: 📎 Walk.mp4");
});
