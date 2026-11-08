/**
 * v1.5 file sharing in chat ("flavour" version): send and forget. The sender uploads a file once; everyone in that
 * chat can download it for 7 days, then it is deleted. 25 MB per file, on every plan.
 * Contract: D:\Programming\zinwe-wt\_v15\BRIEF.md §1, §2e, §3a and §4 (copy, used exactly).
 *
 * Pure helpers only (no runtime imports), so the tests run them under plain `node --test`.
 */

export const FILE_MAX_BYTES = 25 * 1024 * 1024;
export const FILE_KEEP_DAYS = 7;

/** §4 copy, exactly as the brief has it. */
export const FILE_COPY = {
  attach: "Attach a file",
  tooBig: "Files can be up to 25 MB.",
  off: "Your admin has turned off file sharing.",
  expired: "This file is no longer available. Files are kept for 7 days.",
  failed: "Couldn't send. Try again.",
  settingsHelp: "Files up to 25 MB, kept for 7 days, then deleted.",
  settingsSwitch: "Allow file sharing",
  /** The server's words for an empty file (§2c), shown at once in the chip. */
  empty: "That file is empty.",
} as const;

/** Program files: the bubble warns, and Download asks once more (§1). */
export const RISKY_EXTENSIONS: readonly string[] = [
  "exe", "msi", "bat", "cmd", "com", "scr", "ps1", "vbs", "vbe", "js", "jse", "wsf", "hta", "lnk", "reg", "jar", "appx", "msix",
];

/** A file on a chat line (§2e FileJSON). */
export interface ChatFile {
  id: string;
  name: string;
  size: number;
  mime: string;
  kind: "image" | "file";
  /** What the sender typed with the file. */
  caption: string;
  risky: boolean;
  expires_at: string | null;
  expired: boolean;
  /** Absolute download address; null when expired, deleted, or the line was deleted. */
  url: string | null;
}

/** Read a line's `file` leniently. Missing (an older backend) or null = no file: the line renders as today. */
export function normaliseFile(raw: unknown): ChatFile | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<Record<keyof ChatFile, unknown>>;
  if (r.id == null || r.id === "") return null;
  const name = String(r.name ?? "") || "file";
  return {
    id: String(r.id),
    name,
    size: Math.max(0, Number(r.size) || 0),
    mime: String(r.mime ?? ""),
    kind: r.kind === "image" ? "image" : "file",
    caption: String(r.caption ?? ""),
    risky: typeof r.risky === "boolean" ? r.risky : isRiskyName(name),
    expires_at: typeof r.expires_at === "string" && r.expires_at ? r.expires_at : null,
    expired: !!r.expired,
    // Left out of the JSON (not the contract, but be kind): "" = build the owner route from the id. null (the
    // contract's "no longer available") stays null.
    url: typeof r.url === "string" && r.url ? r.url : r.url === undefined ? "" : null,
  };
}

/** "340 KB", "2.1 MB", "25 MB", "512 B". */
export function formatSize(bytes: number): string {
  const b = Math.max(0, Math.round(Number(bytes) || 0));
  if (b < 1024) return `${b} B`;
  const kb = Math.round(b / 1024);
  if (kb < 1024) return `${kb} KB`;
  const mb = b / (1024 * 1024);
  if (mb < 1024) return `${trim1(mb)} MB`;
  return `${trim1(mb / 1024)} GB`;
}

function trim1(n: number): string {
  const s = (Math.round(n * 10) / 10).toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/** "Quote-Lumen.PDF" → "pdf"; "" when there is none. */
export function extOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase() : "";
}

export type FileType = "pdf" | "doc" | "sheet" | "slide" | "zip" | "image" | "video" | "audio" | "other";

const TYPES: Record<Exclude<FileType, "other">, readonly string[]> = {
  pdf: ["pdf"],
  doc: ["doc", "docx", "odt", "rtf", "txt", "md", "pages"],
  sheet: ["xls", "xlsx", "xlsm", "ods", "csv", "tsv", "numbers"],
  slide: ["ppt", "pptx", "odp", "key"],
  zip: ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"],
  image: ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "heic", "heif", "tif", "tiff", "ico"],
  video: ["mp4", "mov", "avi", "mkv", "webm", "wmv", "m4v"],
  audio: ["mp3", "wav", "m4a", "ogg", "flac", "aac", "wma", "opus"],
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Kept until 16 Nov" (local day), or "" without a date. */
export function keptText(expiresAt: string | null | undefined): string {
  if (!expiresAt) return "";
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return "";
  return `Kept until ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "This is a program file. Open it only if you trust Karan." */
export function riskyText(firstName: string): string {
  return `This is a program file. Open it only if you trust ${firstName.trim() || "the sender"}.`;
}

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
 * Where to fetch a file from, as a path on the API (so the token only ever goes to our own API base):
 * the path of the absolute `url` the server sent, or the owner route built from the id. null = no longer available.
 */
export function filePath(file: Pick<ChatFile, "id" | "url">, inline = false): string | null {
  if (file.url === null) return null;
  let path = `/api/chat/files/${encodeURIComponent(file.id)}/`;
  let search = "";
  if (file.url) {
    try {
      const u = new URL(file.url, "http://api.invalid");
      if (u.pathname.startsWith("/api/")) {
        path = u.pathname;
        search = u.search;
      }
    } catch {
      // Keep the owner route.
    }
  }
  if (inline) search = search ? `${search}&inline=1` : "?inline=1";
  return `${path}${search}`;
}

// ---- The file chip above the message box (§3a) ----

export type ChipState =
  /** Picked, waiting for Send. */
  | { status: "ready" }
  /** Over 25 MB: refused at once. */
  | { status: "too_big" }
  | { status: "empty" }
  /** Uploading: 0…1. */
  | { status: "uploading"; progress: number }
  /** Uploaded; the line is being posted. */
  | { status: "sending" }
  | { status: "failed"; message: string; retry: boolean };

/** The chip for a file just picked. */
export function chipFor(file: { size: number }, maxBytes = FILE_MAX_BYTES): ChipState {
  if (file.size > maxBytes) return { status: "too_big" };
  if (file.size <= 0) return { status: "empty" };
  return { status: "ready" };
}

/**
 * Why a send failed, as the chip says it. A network or server error is "Couldn't send. Try again." with Retry;
 * the server's own words win for what it refused (too big, too many waiting, sharing turned off).
 */
export function chipFailure(error: { status?: number; message?: string } | null | undefined): ChipState {
  const status = error?.status ?? 0;
  const message = error?.message ?? "";
  if (status === 413) return { status: "too_big" };
  if (status === 403) return { status: "failed", message: message || FILE_COPY.off, retry: false };
  if (status === 400 && message) {
    if (message === FILE_COPY.tooBig) return { status: "too_big" };
    if (message === FILE_COPY.empty) return { status: "empty" };
    return { status: "failed", message, retry: true };
  }
  return { status: "failed", message: FILE_COPY.failed, retry: true };
}

export interface ChipView {
  /** The line under the name: the size, or what went wrong. */
  note: string;
  error: boolean;
  /** The thin orange bar: 0…1, or null for none. */
  bar: number | null;
  retry: boolean;
  /** Send stays off: the file can't go as it is. */
  blocksSend: boolean;
  /** Busy: the ✕ and Send wait. */
  busy: boolean;
}

export function chipView(state: ChipState, size: number): ChipView {
  const sz = formatSize(size);
  switch (state.status) {
    case "ready":
      return { note: sz, error: false, bar: null, retry: false, blocksSend: false, busy: false };
    case "too_big":
      return { note: FILE_COPY.tooBig, error: true, bar: null, retry: false, blocksSend: true, busy: false };
    case "empty":
      return { note: FILE_COPY.empty, error: true, bar: null, retry: false, blocksSend: true, busy: false };
    case "uploading": {
      const p = Math.min(1, Math.max(0, state.progress));
      return { note: `${sz} · ${Math.round(p * 100)}%`, error: false, bar: p, retry: false, blocksSend: true, busy: true };
    }
    case "sending":
      return { note: `${sz} · Sending…`, error: false, bar: 1, retry: false, blocksSend: true, busy: true };
    case "failed":
      return { note: state.message, error: true, bar: null, retry: state.retry, blocksSend: !state.retry, busy: false };
  }
}

// ---- The file bubble in a thread (§3a) ----

export type BubbleView =
  /** No file: the line renders as it always has (its body). */
  | { kind: "text" }
  | { kind: "expired"; caption: string }
  | { kind: "image" | "file"; file: ChatFile; caption: string; kept: string; risky: string | null; sizeLine: string; type: FileType };

/**
 * What a line's bubble shows. `mine` = you sent it (no caution on your own file); `sender` = their first name.
 */
export function bubbleOf(file: ChatFile | null | undefined, opts: { mine: boolean; sender: string }): BubbleView {
  if (!file) return { kind: "text" };
  if (file.expired || file.url === null) return { kind: "expired", caption: file.caption };
  return {
    kind: file.kind === "image" ? "image" : "file",
    file,
    caption: file.caption,
    kept: keptText(file.expires_at),
    risky: file.risky && !opts.mine ? riskyText(opts.sender) : null,
    sizeLine: sizeLine(file),
    type: file.kind === "image" ? "image" : fileTypeOf(file.name, file.mime),
  };
}
