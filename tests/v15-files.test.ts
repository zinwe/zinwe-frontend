/**
 * v1.5 — file sharing in chat (owner dashboard): size formatting, the file chip's states, the file bubble's states,
 * previews in chat lists, and reading FileJSON leniently (an older backend has no `file`).
 * Run: npm test (node --test; Node strips the types, the model has no runtime imports).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bubbleOf,
  chipFailure,
  chipFor,
  chipView,
  extOf,
  FILE_COPY,
  FILE_MAX_BYTES,
  filePath,
  fileTypeOf,
  formatSize,
  isRiskyName,
  keptText,
  normaliseFile,
  previewText,
  riskyText,
  sizeLine,
  typeLabel,
  type ChatFile,
} from "../src/lib/chatFileModel.ts";

const file = (over: Partial<ChatFile> = {}): ChatFile => ({
  id: "6f1c",
  name: "Quote-Lumen.pdf",
  size: 2202009,
  mime: "application/pdf",
  kind: "file",
  caption: "Final version",
  risky: false,
  expires_at: new Date(2026, 10, 16, 10, 20).toISOString(),
  expired: false,
  url: "https://backend.zinwe.io/api/chat/files/6f1c/",
  ...over,
});

// ---- size formatting ----

test("size: bytes, KB rounded, MB with one decimal (no .0), GB", () => {
  assert.equal(formatSize(0), "0 B");
  assert.equal(formatSize(512), "512 B");
  assert.equal(formatSize(1023), "1023 B");
  assert.equal(formatSize(1024), "1 KB");
  assert.equal(formatSize(340 * 1024), "340 KB");
  assert.equal(formatSize(2202009), "2.1 MB");
  assert.equal(formatSize(FILE_MAX_BYTES), "25 MB");
  assert.equal(formatSize(1024 * 1024 - 100), "1 MB");
  assert.equal(formatSize(3 * 1024 ** 3), "3 GB");
  assert.equal(formatSize(-5), "0 B");
  assert.equal(formatSize(Number.NaN), "0 B");
});

test("size line, type label and type icon", () => {
  assert.equal(sizeLine({ name: "Quote-Lumen.pdf", size: 2202009 }), "2.1 MB · PDF");
  assert.equal(sizeLine({ name: "README", size: 2048 }), "2 KB · File");
  assert.equal(typeLabel("Plan.DOCX"), "DOCX");
  assert.equal(extOf("archive.tar.gz"), "gz");
  assert.equal(extOf(".env"), "");
  assert.equal(fileTypeOf("Budget.xlsx"), "sheet");
  assert.equal(fileTypeOf("Deck.pptx"), "slide");
  assert.equal(fileTypeOf("notes.docx"), "doc");
  assert.equal(fileTypeOf("logo.svg"), "image");
  assert.equal(fileTypeOf("all.zip"), "zip");
  assert.equal(fileTypeOf("call.m4a"), "audio");
  assert.equal(fileTypeOf("demo.mov"), "video");
  assert.equal(fileTypeOf("data.bin"), "other");
  assert.equal(fileTypeOf("scan", "application/pdf"), "pdf");
});

test("risky extensions and the copy", () => {
  for (const n of ["setup.exe", "run.BAT", "x.ps1", "tool.jar", "a.js", "app.msix"]) assert.ok(isRiskyName(n), n);
  for (const n of ["a.pdf", "exe", "photo.png", "script.json"]) assert.ok(!isRiskyName(n), n);
  assert.equal(riskyText("Karan"), "This is a program file. Open it only if you trust Karan.");
  assert.equal(keptText(new Date(2026, 10, 16, 10, 20).toISOString()), "Kept until 16 Nov");
  assert.equal(keptText(null), "");
  assert.equal(keptText("not a date"), "");
});

// ---- reading FileJSON ----

test("normaliseFile: missing or null = no file (an older backend renders lines as today)", () => {
  assert.equal(normaliseFile(undefined), null);
  assert.equal(normaliseFile(null), null);
  assert.equal(normaliseFile({}), null);
  const f = normaliseFile({ id: "ab", name: "setup.exe", size: "10", kind: "weird", url: null, expired: true });
  assert.ok(f);
  assert.equal(f.kind, "file");
  assert.equal(f.size, 10);
  assert.equal(f.risky, true, "risky falls back to the extension when the server leaves it out");
  assert.equal(f.url, null);
  assert.equal(normaliseFile({ id: "ab", name: "x.png", kind: "image" })?.url, "", "a missing url = build the route from the id");
  assert.equal(normaliseFile({ id: "ab", name: "x.exe", risky: false })?.risky, false, "the server's risky wins");
});

test("filePath: the token only goes to our API base; inline adds ?inline=1; null when gone", () => {
  assert.equal(filePath(file()), "/api/chat/files/6f1c/");
  assert.equal(filePath(file(), true), "/api/chat/files/6f1c/?inline=1");
  assert.equal(filePath(file({ url: "https://evil.example/steal" })), "/api/chat/files/6f1c/");
  assert.equal(filePath(file({ url: "" })), "/api/chat/files/6f1c/");
  assert.equal(filePath(file({ url: null })), null);
});

test("previewText: a file line previews as 📎 <name>", () => {
  assert.equal(previewText("📎 Quote-Lumen.pdf (2.1 MB)\nFinal version", { name: "Quote-Lumen.pdf" }), "📎 Quote-Lumen.pdf");
  assert.equal(previewText("📎 Quote-Lumen.pdf (2.1 MB)\nFinal version"), "📎 Quote-Lumen.pdf");
  assert.equal(previewText("📎 My (draft) plan.docx (340 KB)"), "📎 My (draft) plan.docx");
  assert.equal(previewText("Starting after lunch", null), "Starting after lunch");
  assert.equal(previewText("📎 just a clip emoji"), "📎 just a clip emoji");
});

// ---- the chip ----

test("chip: a file over 25 MB or empty is refused at once; Send stays off", () => {
  assert.deepEqual(chipFor({ size: FILE_MAX_BYTES + 1 }), { status: "too_big" });
  assert.deepEqual(chipFor({ size: FILE_MAX_BYTES }), { status: "ready" });
  assert.deepEqual(chipFor({ size: 0 }), { status: "empty" });
  const big = chipView({ status: "too_big" }, FILE_MAX_BYTES + 1);
  assert.equal(big.note, FILE_COPY.tooBig);
  assert.equal(big.note, "Files can be up to 25 MB.");
  assert.ok(big.error && big.blocksSend && !big.retry && !big.busy);
});

test("chip: ready shows the size; uploading shows the bar and waits; sending is full", () => {
  const ready = chipView({ status: "ready" }, 2202009);
  assert.deepEqual(ready, { note: "2.1 MB", error: false, bar: null, retry: false, blocksSend: false, busy: false });
  const up = chipView({ status: "uploading", progress: 0.42 }, 2202009);
  assert.equal(up.bar, 0.42);
  assert.equal(up.note, "2.1 MB · 42%");
  assert.ok(up.busy && up.blocksSend);
  assert.equal(chipView({ status: "uploading", progress: 7 }, 1).bar, 1);
  const sending = chipView({ status: "sending" }, 2202009);
  assert.equal(sending.bar, 1);
  assert.ok(sending.busy);
});

test("chip: a failed send says Couldn't send with Retry; the server's own words win", () => {
  const net = chipFailure({ status: 0, message: "Couldn't reach Zinwe." });
  assert.deepEqual(net, { status: "failed", message: "Couldn't send. Try again.", retry: true });
  const v = chipView(net, 10);
  assert.ok(v.error && v.retry && !v.blocksSend);
  assert.equal(chipFailure({ status: 500 }).status, "failed");
  assert.deepEqual(chipFailure({ status: 400, message: "Too many files waiting. Send or remove some first." }), {
    status: "failed",
    message: "Too many files waiting. Send or remove some first.",
    retry: true,
  });
  assert.deepEqual(chipFailure({ status: 400, message: "Files can be up to 25 MB." }), { status: "too_big" });
  assert.deepEqual(chipFailure({ status: 413 }), { status: "too_big" });
  assert.deepEqual(chipFailure({ status: 400, message: "That file is empty." }), { status: "empty" });
  const off = chipFailure({ status: 403, message: "Your admin has turned off file sharing." });
  assert.deepEqual(off, { status: "failed", message: FILE_COPY.off, retry: false });
  assert.ok(chipView(off, 1).blocksSend);
});

// ---- the bubble ----

test("bubble: no file = the line as today", () => {
  assert.deepEqual(bubbleOf(null, { mine: false, sender: "Karan" }), { kind: "text" });
  assert.deepEqual(bubbleOf(undefined, { mine: true, sender: "You" }), { kind: "text" });
});

test("bubble: a file card with size, type, caption and the kept line", () => {
  const b = bubbleOf(file(), { mine: false, sender: "Karan" });
  assert.equal(b.kind, "file");
  if (b.kind !== "file") return;
  assert.equal(b.sizeLine, "2.1 MB · PDF");
  assert.equal(b.type, "pdf");
  assert.equal(b.caption, "Final version");
  assert.equal(b.kept, "Kept until 16 Nov");
  assert.equal(b.risky, null);
});

test("bubble: an image is a thumbnail", () => {
  const b = bubbleOf(file({ kind: "image", name: "site.png", mime: "image/png" }), { mine: true, sender: "You" });
  assert.equal(b.kind, "image");
});

test("bubble: expired (flag or no url) is the grey card with the copy", () => {
  assert.deepEqual(bubbleOf(file({ expired: true, url: null }), { mine: false, sender: "Karan" }), { kind: "expired", caption: "Final version" });
  assert.equal(bubbleOf(file({ url: null }), { mine: false, sender: "Karan" }).kind, "expired");
  assert.equal(FILE_COPY.expired, "This file is no longer available. Files are kept for 7 days.");
});

test("bubble: a risky file from someone else carries the caution; your own doesn't", () => {
  const theirs = bubbleOf(file({ name: "setup.exe", risky: true }), { mine: false, sender: "Karan" });
  assert.equal(theirs.kind === "file" ? theirs.risky : "", "This is a program file. Open it only if you trust Karan.");
  const mine = bubbleOf(file({ name: "setup.exe", risky: true }), { mine: true, sender: "You" });
  assert.equal(mine.kind === "file" ? mine.risky : "x", null);
});

// ---- the bell's group line ----

test("bell: a group's newest file line reads 📎 <name> (from file.name, or the fallback text of an older JSON)", async () => {
  const { groupLastLine } = await import("../src/dashboard/shell/bellGroups.ts");
  const by = { kind: "member" as const, member_id: 4, name: "Karan" };
  const withFile = { last_message: { text: "📎 Quote.pdf (2.1 MB)\nFinal", by, at: "", system: false, task_id: null, file: { name: "Quote.pdf" } } };
  assert.equal(groupLastLine(withFile), "Karan: 📎 Quote.pdf");
  const fallbackOnly = { last_message: { text: "📎 Quote.pdf (2.1 MB)\nFinal", by, at: "", system: false, task_id: null } };
  assert.equal(groupLastLine(fallbackOnly), "Karan: 📎 Quote.pdf");
});
