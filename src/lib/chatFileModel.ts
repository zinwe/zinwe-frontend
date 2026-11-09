/**
 * v1.5 file sharing in chat, round 2: files stay on the sender's device. Our server keeps only the record (name, size,
 * type, who holds it, a tiny preview); a download streams from the sender's PC or browser through the relay.
 * Contract: D:\Programming\zinwe-wt\_v15\BRIEF2.md §1, §2 (FileJSON, tickets), §4 (web) and §6 (copy, used exactly).
 * Round 1 (BRIEF.md, a server copy with a `url`) only ever ran on dev: those files still render (see `legacy`).
 *
 * Pure helpers only (no runtime imports), so the tests run them under plain `node --test`.
 */

/** At most this many files in one send (§3, §4). */
export const MAX_FILES = 10;
/** The plan's limit when the server doesn't say (Free: 1 GB). */
export const DEFAULT_FILE_MAX_MB = 1024;
/** A file can be downloaded for 30 days (it is the sender's disk, not ours). */
export const FILE_KEEP_DAYS = 30;
/** The thumbnail sent with a registration: at most 320 px and 40 KB (§2 `thumb`). */
export const THUMB_MAX_PX = 320;
export const THUMB_MAX_BYTES = 40 * 1024;
/** While the sender is offline, ask the relay again this often (§4). */
export const RECHECK_MS = 30_000;

const GB = 1024 * 1024 * 1024;

/** §6 copy, exactly as the brief has it (plus round-1 lines that still apply). */
export const FILE_COPY = {
  attach: "Attach a file",
  document: "Document",
  media: "Photos & videos",
  tooMany: "You can send up to 10 files at a time.",
  notShared: "Not shared any more.",
  ownPc: "Kept on your PC. Others download it from here while your PC is on.",
  ownBrowser: "Kept in this browser. Others can download it while Zinwe is open here.",
  stop: "Stop sharing",
  saveAs: "Save as…",
  webHint: "Your browser decides where files are saved.",
  noOpfs: "This browser can't share files this big. Use the Zinwe app or Chrome.",
  /** Round 1, still the server's words. */
  off: "Your admin has turned off file sharing.",
  failed: "Couldn't send. Try again.",
  settingsSwitch: "Allow file sharing",
  empty: "That file is empty.",
  /** The server's 410 on a ticket. */
  gone: "This file isn't shared any more.",
} as const;

/** "Files can be up to 2 GB on your plan." */
export function tooBigText(maxBytes: number): string {
  return `Files can be up to ${gbNumber(maxBytes)} GB on your plan.`;
}

/** "Files stay on the sender's PC or browser. Up to 2 GB each on your plan." */
export function settingsHelpText(maxBytes: number): string {
  return `Files stay on the sender's PC or browser. Up to ${gbNumber(maxBytes)} GB each on your plan.`;
}

/** "Waiting for Priya's PC…" */
export function waitingText(firstName: string): string {
  return `Waiting for ${firstName.trim() || "the sender"}'s PC…`;
}

/** "This is a program file. Open it only if you trust Karan." */
export function riskyText(firstName: string): string {
  return `This is a program file. Open it only if you trust ${firstName.trim() || "the sender"}.`;
}

/** Program files: the bubble warns, and Download asks once more. */
export const RISKY_EXTENSIONS: readonly string[] = [
  "exe", "msi", "bat", "cmd", "com", "scr", "ps1", "vbs", "vbe", "js", "jse", "wsf", "hta", "lnk", "reg", "jar", "appx", "msix",
];

export type FileKind = "image" | "video" | "audio" | "document" | "file";
export type FileState = "ok" | "stopped" | "gone" | "old";

/** A file on a chat line (§2 FileJSON), read leniently by normaliseFile. */
export interface ChatFile {
  id: string;
  name: string;
  size: number;
  mime: string;
  kind: FileKind;
  /** What the sender typed with the file (only the last file of a batch has one). */
  caption: string;
  risky: boolean;
  /** Files sent together share it. */
  batch_id: string | null;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  /** The preview picture (needs the token: fetch it as a blob). */
  thumb_url: string | null;
  sender: { name: string; first_name: string } | null;
  /** You sent it. null = the server didn't say (round 1). */
  mine: boolean | null;
  available: boolean;
  state: FileState;
  created_at: string | null;
  expires_at: string | null;
  expired: boolean;
  /**
   * Round 1 (dev only): the server kept a copy at this address (owner route, token needed). null for every round-2
   * file. "" = round 1 without a url in the JSON: build the owner route from the id.
   */
  legacy_url: string | null;
}

const KINDS: readonly FileKind[] = ["image", "video", "audio", "document", "file"];
const STATES: readonly FileState[] = ["ok", "stopped", "gone", "old"];

function num(v: unknown): number | null {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n;
}

/**
 * Read a line's `file` leniently. Missing (an older backend) or null = no file: the line renders as today.
 * A round-1 file (a `url`, no `available`) still renders: available unless expired or url null.
 */
export function normaliseFile(raw: unknown): ChatFile | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.id == null || r.id === "") return null;
  const name = String(r.name ?? "") || "file";
  const mime = String(r.mime ?? "");
  const legacy = typeof r.available !== "boolean";
  const expired = !!r.expired;
  const legacyUrl = !legacy ? null : typeof r.url === "string" && r.url ? r.url : r.url === undefined ? "" : null;
  const available = legacy ? !expired && legacyUrl !== null : (r.available as boolean);
  const state: FileState = STATES.includes(r.state as FileState) ? (r.state as FileState) : available ? "ok" : "old";
  const sender = r.sender && typeof r.sender === "object" ? (r.sender as Record<string, unknown>) : null;
  const senderName = sender ? String(sender.name ?? "") : "";
  return {
    id: String(r.id),
    name,
    size: Math.max(0, Number(r.size) || 0),
    mime,
    kind: KINDS.includes(r.kind as FileKind) && !(legacy && r.kind === "file") ? (r.kind as FileKind) : kindOf(name, mime),
    caption: String(r.caption ?? ""),
    risky: typeof r.risky === "boolean" ? r.risky : isRiskyName(name),
    batch_id: typeof r.batch_id === "string" && r.batch_id ? r.batch_id : null,
    width: num(r.width),
    height: num(r.height),
    duration_s: num(r.duration_s),
    thumb_url: typeof r.thumb_url === "string" && r.thumb_url ? r.thumb_url : null,
    sender: sender ? { name: senderName, first_name: String(sender.first_name ?? "") || senderName.split(/\s+/)[0] || "" } : null,
    mine: typeof r.mine === "boolean" ? r.mine : null,
    available: available && state === "ok",
    state: available ? state : state === "ok" ? "old" : state,
    created_at: typeof r.created_at === "string" && r.created_at ? r.created_at : null,
    expires_at: typeof r.expires_at === "string" && r.expires_at ? r.expires_at : null,
    expired,
    legacy_url: legacyUrl,
  };
}

/** A round-1 file (a server copy): downloaded as a blob from its own address. */
export function isLegacy(file: Pick<ChatFile, "legacy_url">): boolean {
  return file.legacy_url !== null;
}

// ---- Sizes ----

function trim1(n: number): string {
  const s = (Math.round(n * 10) / 10).toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/** "512 B", "340 KB", "2.1 MB", "1.4 GB" (one decimal, none when whole). */
export function formatSize(bytes: number): string {
  const b = Math.max(0, Math.round(Number(bytes) || 0));
  if (b < 1024) return `${b} B`;
  const kb = Math.round(b / 1024);
  if (kb < 1024) return `${kb} KB`;
  const mb = b / (1024 * 1024);
  if (Math.round(mb * 10) / 10 < 1024) return `${trim1(mb)} MB`;
  return `${trim1(b / GB)} GB`;
}

/** The plan limit as a GB number: 2147483648 → "2", 1610612736 → "1.5". */
export function gbNumber(maxBytes: number): string {
  return trim1(Math.max(0, Number(maxBytes) || 0) / GB);
}

/**
 * The plan's per-file limit in bytes, from whichever field the server sends: the settings' `file_max_bytes` /
 * `max_bytes`, or the plan's `file_max_mb`. null = not known (an older backend).
 */
export function planMaxBytes(src: { file_max_bytes?: unknown; max_bytes?: unknown; file_max_mb?: unknown } | null | undefined): number | null {
  if (!src) return null;
  for (const v of [src.file_max_bytes, src.max_bytes]) {
    const n = num(v);
    if (n && n > 0) return n;
  }
  const mb = num(src.file_max_mb);
  return mb && mb > 0 ? mb * 1024 * 1024 : null;
}

// ---- Names, kinds, icons ----

/** "Quote-Lumen.PDF" → "pdf"; "" when there is none. */
export function extOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase() : "";
}

export const IMAGE_EXTS: readonly string[] = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif", "avif", "tif", "tiff"];
export const VIDEO_EXTS: readonly string[] = ["mp4", "mov", "avi", "mkv", "webm", "wmv", "m4v"];
export const AUDIO_EXTS: readonly string[] = ["mp3", "wav", "m4a", "ogg", "flac", "aac", "wma", "opus"];
/** The attach menu's Document picker (§3): office files, text, PDFs and archives. */
export const DOCUMENT_EXTS: readonly string[] = [
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "rtf", "odt", "ods", "odp", "zip", "rar", "7z",
];

/** The server's kind for a name + type (§2: from extension + mime). SVG is a normal file, never an image. */
export function kindOf(name: string, mime = ""): FileKind {
  const ext = extOf(name);
  if (ext === "svg") return "file";
  if (IMAGE_EXTS.includes(ext)) return "image";
  if (VIDEO_EXTS.includes(ext)) return "video";
  if (AUDIO_EXTS.includes(ext)) return "audio";
  if (DOCUMENT_EXTS.includes(ext)) return "document";
  if (mime.startsWith("image/") && mime !== "image/svg+xml") return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "document";
  return "file";
}

/** The `accept` of each attach-menu picker. The Document picker still offers "All files" in the dialog. */
export const ACCEPT = {
  document: DOCUMENT_EXTS.map((e) => `.${e}`).join(","),
  media: ["image/*", "video/*", ...IMAGE_EXTS.map((e) => `.${e}`), ...VIDEO_EXTS.map((e) => `.${e}`)].join(","),
} as const;

export type FileType = "pdf" | "doc" | "sheet" | "slide" | "zip" | "image" | "video" | "audio" | "other";

const TYPES: Record<Exclude<FileType, "other">, readonly string[]> = {
  pdf: ["pdf"],
  doc: ["doc", "docx", "odt", "rtf", "txt", "md", "pages"],
  sheet: ["xls", "xlsx", "xlsm", "ods", "csv", "tsv", "numbers"],
  slide: ["ppt", "pptx", "odp", "key"],
  zip: ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"],
  image: [...IMAGE_EXTS, "svg", "ico"],
  video: VIDEO_EXTS,
  audio: AUDIO_EXTS,
};

/** Which icon a file card shows. */
export function fileTypeOf(name: string, mime = ""): FileType {
  const ext = extOf(name);
  for (const [type, exts] of Object.entries(TYPES) as Array<[Exclude<FileType, "other">, readonly string[]]>) {
    if (exts.includes(ext)) return type;
  }
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  return "other";
}

/** The type after the size on a card: "PDF", "DOCX", or "File" when the name has no extension. */
export function typeLabel(name: string): string {
  const ext = extOf(name);
  return ext && ext.length <= 6 ? ext.toUpperCase() : "File";
}

/** "2.1 MB · PDF" */
export function sizeLine(file: Pick<ChatFile, "name" | "size">): string {
  return `${formatSize(file.size)} · ${typeLabel(file.name)}`;
}

export function isRiskyName(name: string): boolean {
  return RISKY_EXTENSIONS.includes(extOf(name));
}

/** A video's badge: 42 → "0:42", 62 → "1:02", 3723 → "1:02:03". "" when unknown. */
export function durationText(seconds: number | null | undefined): string {
  const s = Math.round(Number(seconds));
  if (!Number.isFinite(s) || s < 0 || seconds === null || seconds === undefined) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Scale w × h to fit inside max × max (never up). */
export function fitWithin(w: number, h: number, max = THUMB_MAX_PX): { w: number; h: number } {
  if (!(w > 0) || !(h > 0)) return { w: 0, h: 0 };
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

// ---- Previews in chat lists ----

/** The stored fallback body: "📎 Quote-Lumen.pdf (2.1 MB)" on its first line, then the caption. */
const FALLBACK_RE = /^📎 (.+) \(\d+(?:[.,]\d+)? ?(?:B|bytes?|KB|MB|GB)\)$/;

/**
 * A chat list / unread preview: a file line reads "📎 <name>". Uses the file's name when the JSON has it, and
 * otherwise spots the server's fallback text ("📎 name (2.1 MB)\ncaption"); any other text stays as it is.
 */
export function previewText(text: string, file?: { name?: string | null } | null): string {
  if (file && file.name) return `📎 ${file.name}`;
  if (!text.startsWith("📎 ")) return text;
  const first = text.split("\n")[0].trim();
  const m = FALLBACK_RE.exec(first);
  return m ? `📎 ${m[1]}` : first;
}

/**
 * An address the server sent (thumb_url, a round-1 url) as a path on our API, so the token only ever goes to our
 * own API base. null when it isn't one of ours.
 */
export function apiPathOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, "http://api.invalid");
    return u.pathname.startsWith("/api/") ? `${u.pathname}${u.search}` : null;
  } catch {
    return null;
  }
}

/** Round 1: where to fetch a server copy from (owner route by default); inline adds ?inline=1. null = gone. */
export function legacyPath(file: Pick<ChatFile, "id" | "legacy_url">, inline = false): string | null {
  if (file.legacy_url === null) return null;
  let path = apiPathOf(file.legacy_url) ?? `/api/chat/files/${encodeURIComponent(file.id)}/`;
  if (inline) path += path.includes("?") ? "&inline=1" : "?inline=1";
  return path;
}

// ---- Picking files (the attach menu → the send tray) ----

export interface PickNote {
  /** The file it is about ("" for the whole pick). */
  name: string;
  text: string;
}

/**
 * Which of the picked files go into the tray. `already` = tiles in the tray now. Over 10 in all → the first ones
 * that fit, and "You can send up to 10 files at a time."; over the plan → refused per file; empty → refused.
 */
export function checkPicks(files: ReadonlyArray<{ name: string; size: number }>, already: number, maxBytes: number): { take: number[]; notes: PickNote[] } {
  const take: number[] = [];
  const notes: PickNote[] = [];
  let room = Math.max(0, MAX_FILES - already);
  let tooMany = false;
  files.forEach((f, i) => {
    if (f.size > maxBytes) notes.push({ name: f.name, text: tooBigText(maxBytes) });
    else if (f.size <= 0) notes.push({ name: f.name, text: FILE_COPY.empty });
    else if (room <= 0) tooMany = true;
    else {
      take.push(i);
      room -= 1;
    }
  });
  if (tooMany) notes.push({ name: "", text: FILE_COPY.tooMany });
  return { take, notes };
}

/** One file in the send tray, and how far its send got. */
export type TileStatus =
  | { s: "ready" }
  /** Copying into this browser's storage: 0…1. */
  | { s: "holding"; progress: number }
  | { s: "registering" }
  | { s: "posting" }
  | { s: "sent" }
  | { s: "failed"; message: string; retry: boolean };

export interface TileView {
  /** The line under the name: the size, a %, or what went wrong. */
  note: string;
  error: boolean;
  /** The ring over the tile: 0…1, "spin" (busy, no %), or null. */
  ring: number | "spin" | null;
  busy: boolean;
}

export function tileView(status: TileStatus, size: number): TileView {
  const sz = formatSize(size);
  switch (status.s) {
    case "ready":
      return { note: sz, error: false, ring: null, busy: false };
    case "holding": {
      const p = Math.min(1, Math.max(0, status.progress));
      return { note: `${sz} · ${Math.round(p * 100)}%`, error: false, ring: p, busy: true };
    }
    case "registering":
    case "posting":
      return { note: `${sz} · Sending…`, error: false, ring: "spin", busy: true };
    case "sent":
      return { note: sz, error: false, ring: 1, busy: true };
    case "failed":
      return { note: status.message, error: true, ring: null, busy: false };
  }
}

/**
 * Why a send failed, as the tile says it. The server's own words win for what it refused (too big for the plan,
 * too many waiting, sharing off: no Retry for those that can't change); anything else is "Couldn't send. Try again.".
 */
export function sendFailure(error: { status?: number; message?: string; noRoom?: boolean } | null | undefined): Extract<TileStatus, { s: "failed" }> {
  if (error?.noRoom) return { s: "failed", message: FILE_COPY.noOpfs, retry: false };
  const status = error?.status ?? 0;
  const message = error?.message ?? "";
  if (status === 403) return { s: "failed", message: message || FILE_COPY.off, retry: false };
  if (status === 400 && message) return { s: "failed", message, retry: !/up to .* on your plan|is empty/.test(message) };
  return { s: "failed", message: FILE_COPY.failed, retry: true };
}

/** The caption goes on the last file of a batch only (§2 Attach). */
export function captionFor(index: number, count: number, caption: string): string {
  return index === count - 1 ? caption : "";
}

// ---- The batch grid ----

export interface GridCell {
  /** Which file of the batch. */
  index: number;
  /** The top cell of three spans both columns. */
  wide: boolean;
  /** "+N" over the 4th cell: N files not shown on their own (that cell's and the rest). */
  more: number;
}

/** Photos and videos sent together: one, two side by side, three (one wide on top), or a 2 × 2 with "+N". */
export function gridLayout(count: number): GridCell[] {
  const n = Math.max(0, Math.floor(count));
  if (n <= 2) return Array.from({ length: n }, (_, index) => ({ index, wide: false, more: 0 }));
  if (n === 3) return [0, 1, 2].map((index) => ({ index, wide: index === 0, more: 0 }));
  return [0, 1, 2, 3].map((index) => ({ index, wide: false, more: index === 3 && n > 4 ? n - 3 : 0 }));
}

export type BatchRole = { role: "lead"; files: ChatFile[] } | { role: "skip" };

/** A file that goes in the grid: a photo or a video. */
export function isGridFile(file: ChatFile | null | undefined): file is ChatFile {
  return !!file && !isLegacy(file) && (file.kind === "image" || file.kind === "video");
}

/**
 * Lines of a thread (in the order shown) → which ones form a batch grid. A run of two or more lines next to each
 * other from the same sender, each a photo/video with the same batch_id, shows as one grid on the run's LAST line
 * (it carries the caption, the time and the actions); the earlier lines of the run are skipped.
 */
export function batchRuns(items: ReadonlyArray<{ key: string; from: string; file: ChatFile | null | undefined }>): Map<string, BatchRole> {
  const out = new Map<string, BatchRole>();
  let i = 0;
  while (i < items.length) {
    const head = items[i];
    const batch = isGridFile(head.file) ? head.file.batch_id : null;
    let j = i + 1;
    if (batch) {
      while (j < items.length) {
        const f = items[j].file;
        if (!isGridFile(f) || f.batch_id !== batch || items[j].from !== head.from) break;
        j += 1;
      }
    }
    if (j - i >= 2) {
      for (let k = i; k < j - 1; k += 1) out.set(items[k].key, { role: "skip" });
      out.set(items[j - 1].key, { role: "lead", files: items.slice(i, j).map((it) => it.file as ChatFile) });
    }
    i = j;
  }
  return out;
}

// ---- The bubble ----

export type BubbleView =
  /** No file: the line renders as it always has (its body). */
  | { kind: "text" }
  /** Stopped, gone, deleted or too old. */
  | { kind: "gone"; caption: string; type: FileType }
  | {
      /** media = a picture/video tile from its thumbnail; doc = a card with Download ▾. */
      kind: "media" | "doc";
      file: ChatFile;
      caption: string;
      /** A program file from someone else: the caution line. */
      risky: string | null;
      /** Under your own file kept in this browser. */
      own: string | null;
      sizeLine: string;
      type: FileType;
      /** Opens in the lightbox (photo, video) or a new tab (PDF). */
      preview: "lightbox" | "tab" | null;
    };

export function previewOf(file: Pick<ChatFile, "kind" | "name" | "mime">): "lightbox" | "tab" | null {
  if (file.kind === "image" || file.kind === "video") return "lightbox";
  return fileTypeOf(file.name, file.mime) === "pdf" ? "tab" : null;
}

/**
 * What a line's file shows. `mine` = you sent it (no caution on your own file); `sender` = their first name;
 * `heldHere` = this browser keeps the file (the "Kept in this browser" line).
 */
export function bubbleOf(file: ChatFile | null | undefined, opts: { mine: boolean; sender: string; heldHere?: boolean }): BubbleView {
  if (!file) return { kind: "text" };
  const type = fileTypeOf(file.name, file.mime);
  if (!file.available) return { kind: "gone", caption: file.caption, type };
  const mine = file.mine ?? opts.mine;
  const media = (file.kind === "image" || file.kind === "video") && (!!file.thumb_url || (isLegacy(file) && file.kind === "image"));
  return {
    kind: media ? "media" : "doc",
    file,
    caption: file.caption,
    risky: file.risky && !mine ? riskyText(file.sender?.first_name || opts.sender) : null,
    own: mine && opts.heldHere ? FILE_COPY.ownBrowser : null,
    sizeLine: sizeLine(file),
    type,
    preview: isLegacy(file) ? (file.kind === "image" ? "lightbox" : null) : previewOf(file),
  };
}

// ---- Downloading ----

export type DlState =
  | { s: "idle" }
  /** A program file: Download asks once more. */
  | { s: "confirm" }
  /** Getting a ticket and asking whether the sender is online. */
  | { s: "checking" }
  /** The sender is offline: re-check every 30 s, then go on. */
  | { s: "waiting" }
  /** Save as…: streaming into the chosen file, 0…1 (null before the size is known). */
  | { s: "saving"; progress: number | null }
  | { s: "error"; message: string }
  | { s: "gone" };

export interface DlView {
  label: string;
  /** Download (and Save as…) can't be pressed. */
  disabled: boolean;
  /** The spinner ring: 0…1, "spin", or null. */
  ring: number | "spin" | null;
  /** A line under the button. */
  note: string | null;
  noteKind: "wait" | "error" | null;
  /** ✕ to stop a Save as. */
  cancel: boolean;
}

export function dlView(state: DlState, firstName: string): DlView {
  const base: DlView = { label: "Download", disabled: false, ring: null, note: null, noteKind: null, cancel: false };
  switch (state.s) {
    case "idle":
      return base;
    case "confirm":
      return { ...base, label: "Download anyway" };
    case "checking":
      return { ...base, disabled: true, ring: "spin" };
    case "waiting":
      return { ...base, disabled: true, note: waitingText(firstName), noteKind: "wait" };
    case "saving":
      return { ...base, disabled: true, ring: state.progress === null ? "spin" : Math.min(1, Math.max(0, state.progress)), cancel: true };
    case "error":
      return { ...base, note: state.message, noteKind: "error" };
    case "gone":
      return { ...base, disabled: true, note: FILE_COPY.notShared, noteKind: "error" };
  }
}

/** "42%" for the ring (0…1 → whole percent, never past 100). */
export function percent(progress: number): string {
  return `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`;
}

/** SVG stroke for a ring of radius r at 0…1. */
export function ringDash(progress: number, r: number): { dasharray: string; dashoffset: string } {
  const c = 2 * Math.PI * r;
  const p = Math.min(1, Math.max(0, progress));
  return { dasharray: c.toFixed(2), dashoffset: (c * (1 - p)).toFixed(2) };
}

// ---- Tickets and the relay (§1) ----

export interface FileTicket {
  url: string;
  inline_url: string;
  status_url: string;
  expires_at: string | null;
}

export function parseTicket(raw: unknown): FileTicket | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.url !== "string" || !r.url) return null;
  const inline = typeof r.inline_url === "string" && r.inline_url ? r.inline_url : `${r.url}${r.url.includes("?") ? "&" : "?"}inline=1`;
  return {
    url: r.url,
    inline_url: inline,
    status_url: typeof r.status_url === "string" ? r.status_url : "",
    expires_at: typeof r.expires_at === "string" ? r.expires_at : null,
  };
}

/** A ticket is still good for `marginMs` more (a get ticket lives 15 minutes; a serve ticket 24 h). */
export function ticketFresh(expiresAt: string | null | undefined, now: number, marginMs = 60_000): boolean {
  if (!expiresAt) return false;
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) && at - now > marginMs;
}

/** `GET /relay/status/…` → online? Anything unreadable counts as online (the download itself then says). */
export function relayOnline(raw: unknown): boolean {
  if (raw && typeof raw === "object" && "online" in raw) return (raw as { online: unknown }).online !== false;
  return true;
}

export interface RelayJob {
  job: string;
  file_id: string;
  offset: number;
}

/** `GET /relay/wait` 200 body → a job, or null. */
export function parseJob(raw: unknown): RelayJob | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.job == null || r.job === "" || r.file_id == null || r.file_id === "") return null;
  return { job: String(r.job), file_id: String(r.file_id), offset: Math.max(0, Math.floor(Number(r.offset) || 0)) };
}

// ---- Files this browser keeps (OPFS) ----

export interface HeldFile {
  /** The ChatFile id. */
  id: string;
  /** The OPFS name (`local_ref`). */
  ref: string;
  name: string;
  size: number;
  mime: string;
  kind: FileKind;
  /** When it was sent (ms). */
  at: number;
  /** Where it went: the group's or the person's name. */
  chat: string;
}

/** Entries past the 30 days (nobody can download them any more) are dropped. */
export function pruneHeld(list: readonly HeldFile[], now: number, keepDays = FILE_KEEP_DAYS): { keep: HeldFile[]; drop: HeldFile[] } {
  const keep: HeldFile[] = [];
  const drop: HeldFile[] = [];
  for (const h of list) (now - h.at > keepDays * 86_400_000 ? drop : keep).push(h);
  return { keep, drop };
}

/** Read the stored list leniently. */
export function parseHeld(raw: string | null): HeldFile[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list
      .filter((h): h is Record<string, unknown> => !!h && typeof h === "object" && typeof (h as HeldFile).id === "string" && typeof (h as HeldFile).ref === "string")
      .map((h) => ({
        id: String(h.id),
        ref: String(h.ref),
        name: String(h.name ?? "file"),
        size: Number(h.size) || 0,
        mime: String(h.mime ?? ""),
        kind: KINDS.includes(h.kind as FileKind) ? (h.kind as FileKind) : "file",
        at: Number(h.at) || 0,
        chat: String(h.chat ?? ""),
      }));
  } catch {
    return [];
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "9 Nov" (local day). */
export function dayText(ms: number): string {
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? "" : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
