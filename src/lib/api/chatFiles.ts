/**
 * v1.5 file sharing in chat, round 2, owner side (D:\Programming\zinwe-wt\_v15\BRIEF2.md §1, §2). Our server never
 * stores a file: it keeps the record, and a download streams from the sender's device through the relay.
 *
 * - POST /api/chat/files/                       register a file (JSON) → 201 FileJSON; the line's POST attaches it
 * - PATCH /api/chat/files/<id>/                 {sha256} or {gone: true} (holder only)
 * - POST /api/chat/files/<id>/stop/             stop sharing (sender only)
 * - POST /api/chat/files/<id>/ticket/           {url, inline_url, status_url, expires_at}; 410 = not shared any more
 * - GET  /api/chat/files/<id>/thumb/            the preview picture (thumb_url; needs the token → a blob)
 * - GET  /api/chat/files/serve-ticket/?browser_id=   {ticket, wait_url, push_base, expires_at} for this browser
 * - GET  /api/chat/files/shared/               the owner's still-shared files (+ holder, local_ref, chat), newest first
 * - GET  <status_url>                           {online} (the relay; the ticket is in the address, no token)
 *
 * Relay addresses carry their ticket, so they never get the token. Round-1 files (a server copy with a `url`, dev
 * only) are still fetched as blobs from their own address (fetchLegacyFile).
 */
import { clearToken, getToken } from "../session";
import { apiPathOf, FILE_COPY, legacyPath, normaliseFile, parseShared, parseTicket, relayOnline, ticketFresh, type ChatFile, type FileTicket, type SharedFile } from "../chatFileModel";
import { API_BASE, ApiError, ERROR_COPY, toMessages, type ApiErrorKind } from "./http";

export * from "../chatFileModel";

const BASE = "/api/chat/files/";
const TIMEOUT_MS = 20_000;

function kindOf(status: number): ApiErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404 || status === 410) return "not_found";
  if (status === 400 || status === 413) return "validation";
  if (status === 429) return "rate_limited";
  return "server";
}

function detailOf(body: unknown): string | undefined {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const d = (body as Record<string, unknown>).detail;
    if (typeof d === "string" && d) return d;
  }
  return undefined;
}

/** The ApiError for a failed file call, in the server's own words where it has them. */
function fileError(status: number, body: unknown, token: string | null): ApiError {
  const kind = kindOf(status);
  if (kind === "unauthorized") {
    if (token && getToken() === token) clearToken();
    return new ApiError(kind, status, ERROR_COPY.unauthorized);
  }
  if (status === 410) return new ApiError(kind, status, detailOf(body) ?? FILE_COPY.gone);
  if (kind === "validation") {
    const fieldErrors: Record<string, string[]> = {};
    if (body && typeof body === "object" && !Array.isArray(body)) {
      for (const [key, value] of Object.entries(body)) {
        const messages = toMessages(value);
        if (messages.length) fieldErrors[key] = messages;
      }
    }
    return new ApiError(kind, status, Object.values(fieldErrors)[0]?.[0] ?? ERROR_COPY.validation, fieldErrors);
  }
  if (kind === "forbidden") return new ApiError(kind, status, detailOf(body) ?? FILE_COPY.off);
  return new ApiError(kind, status, detailOf(body) ?? ERROR_COPY[kind]);
}

async function readBody(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** A signed-in JSON call on our API (token, no cookies, a timeout), throwing fileError. */
async function call<T = unknown>(path: string, { method = "GET", body, signal }: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const token = getToken();
  if (!token) throw new ApiError("unauthorized", 401, ERROR_COPY.unauthorized);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const forward = () => ctrl.abort();
  signal?.addEventListener("abort", forward, { once: true });
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { Authorization: `Token ${token}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "omit",
      signal: ctrl.signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError("network", 0, ERROR_COPY.network);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forward);
  }
  const parsed = await readBody(response);
  if (!response.ok) throw fileError(response.status, parsed, token);
  return parsed as T;
}

const idPath = (id: string, tail = "") => `${BASE}${encodeURIComponent(id)}/${tail}`;

// ---- Sending ----

export interface RegisterInput {
  name: string;
  size: number;
  mime: string;
  sha256?: string;
  /** The OPFS name this browser keeps the file under (opaque to the server). */
  local_ref: string;
  /** The preview picture, base64 (no data: prefix), ≤ 40 KB. */
  thumb_b64?: string;
  width?: number;
  height?: number;
  duration_s?: number;
  batch_id?: string;
  /** Required for the owner: this browser's id (the holder is b<owner>.<browser_id>). */
  browser_id: string;
}

/** POST /api/chat/files/ (JSON) → 201 FileJSON. 400 {"size": ["Files can be up to 2 GB on your plan."]}, 403 off. */
export async function registerChatFile(input: RegisterInput, signal?: AbortSignal): Promise<ChatFile> {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined && v !== "") body[k] = v;
  const made = normaliseFile(await call(BASE, { method: "POST", body, signal }));
  if (!made) throw new ApiError("server", 500, ERROR_COPY.server);
  return made;
}

/** PATCH /api/chat/files/<id>/ — the hash once worked out, or {gone: true} when this browser lost the file. */
export async function patchChatFile(id: string, patch: { sha256: string } | { gone: true }): Promise<void> {
  await call(idPath(id), { method: "PATCH", body: patch });
}

/** POST /api/chat/files/<id>/stop/ — nobody can download it any more. */
export async function stopSharingFile(id: string): Promise<void> {
  await call(idPath(id, "stop/"), { method: "POST" });
}

/**
 * GET /api/chat/files/shared/ — the owner's files still shared (not stopped, not old), with who keeps each
 * (`holder`) and its `local_ref`, so a browser can find a job's file again after a reload.
 */
export async function listSharedFiles(signal?: AbortSignal): Promise<SharedFile[]> {
  return parseShared(await call(`${BASE}shared/`, { signal }));
}

// ---- Receiving ----

const tickets = new Map<string, FileTicket>();

/**
 * POST /api/chat/files/<id>/ticket/ (kept while it has a minute left). 410 → ApiError(410, "This file isn't shared
 * any more."); 404 = not yours to see.
 */
export async function getFileTicket(id: string, { fresh = false, signal }: { fresh?: boolean; signal?: AbortSignal } = {}): Promise<FileTicket> {
  const hit = tickets.get(id);
  if (hit && !fresh && ticketFresh(hit.expires_at, Date.now())) return hit;
  const ticket = parseTicket(await call(idPath(id, "ticket/"), { method: "POST", signal }));
  if (!ticket) throw new ApiError("server", 500, ERROR_COPY.server);
  tickets.set(id, ticket);
  return ticket;
}

/** Is the sender's device there (`status_url` → {online})? A failed check counts as online: the download says. */
export async function senderOnline(ticket: FileTicket, signal?: AbortSignal): Promise<boolean> {
  if (!ticket.status_url) return true;
  try {
    const response = await fetch(ticket.status_url, { credentials: "omit", cache: "no-store", signal });
    if (!response.ok) return true;
    return relayOnline(await readBody(response));
  } catch (error) {
    if (signal?.aborted) throw error;
    return true;
  }
}

/** The preview picture (thumb_url) with the token, as a blob. Only ever our own API. */
export async function fetchThumb(thumbUrl: string, signal?: AbortSignal): Promise<Blob> {
  const path = apiPathOf(thumbUrl);
  if (!path) throw new ApiError("not_found", 404, ERROR_COPY.not_found);
  return fetchBlob(path, signal);
}

async function fetchBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  const token = getToken();
  if (!token) throw new ApiError("unauthorized", 401, ERROR_COPY.unauthorized);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Token ${token}` }, credentials: "omit", signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError("network", 0, ERROR_COPY.network);
  }
  if (!response.ok) throw fileError(response.status, await readBody(response), token);
  return response.blob();
}

/** Round 1 (a server copy, dev only): the file as a blob from its own address. */
export async function fetchLegacyFile(file: Pick<ChatFile, "id" | "legacy_url">, { inline = false, signal }: { inline?: boolean; signal?: AbortSignal } = {}): Promise<Blob> {
  const path = legacyPath(file, inline);
  if (path === null) throw new ApiError("not_found", 410, FILE_COPY.notShared);
  return fetchBlob(path, signal);
}

/** Hand an address (or a blob's object URL) to the browser as a download: it shows its own progress and asks where. */
export function nativeDownload(href: string, name: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Hand a blob to the browser as a download named `name`. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  nativeDownload(url, name);
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** The relay answered 503: the sender's device didn't start sending in time. */
export class SenderOffline extends Error {
  constructor() {
    super("offline");
    this.name = "SenderOffline";
  }
}

/** Chrome / Edge only: "Save as…" streams into a file the owner picks. */
export function canSaveAs(): boolean {
  return typeof window !== "undefined" && typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === "function";
}

interface SaveHandle {
  createWritable(): Promise<WritableStream<Uint8Array> & { abort?: (reason?: unknown) => Promise<void> }>;
}

/** The Save dialog (must run inside the click). null = the owner closed it. */
export async function pickSaveTarget(name: string): Promise<SaveHandle | null> {
  const picker = (window as unknown as { showSaveFilePicker: (o: { suggestedName: string }) => Promise<SaveHandle> }).showSaveFilePicker;
  try {
    return await picker({ suggestedName: name });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
}

/**
 * Stream the relay's answer into the picked file, telling `onProgress` 0…1 as bytes arrive. 503 → SenderOffline,
 * 410 → ApiError(410). The file is left untouched (aborted) when it fails or is cancelled.
 */
export async function streamToFile(url: string, target: SaveHandle, size: number, { onProgress, signal }: { onProgress?: (p: number) => void; signal?: AbortSignal } = {}): Promise<void> {
  const response = await fetch(url, { credentials: "omit", cache: "no-store", signal });
  if (response.status === 503) {
    // "The relay is busy. Try again in a minute." is said as it is; anything else = the sender's device is away.
    const detail = detailOf(await readBody(response));
    if (detail && /busy/i.test(detail)) throw new ApiError("server", 503, detail);
    throw new SenderOffline();
  }
  if (!response.ok || !response.body) throw fileError(response.status, await readBody(response), null);
  const total = Number(response.headers.get("Content-Length")) || size;
  const writable = await target.createWritable();
  let got = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      got += chunk.byteLength;
      if (total > 0) onProgress?.(got / total);
      ctrl.enqueue(chunk);
    },
  });
  try {
    await response.body.pipeThrough(counter).pipeTo(writable, { signal });
  } catch (error) {
    try {
      await writable.abort?.(error);
    } catch {
      // Already closed by the pipe.
    }
    throw error;
  }
}

// ---- Holding (this browser serves its own files) ----

export interface ServeTicket {
  ticket: string;
  wait_url: string;
  push_base: string;
  expires_at: string | null;
}

/** GET /api/chat/files/serve-ticket/?browser_id= — lets this browser wait for download jobs and push them (24 h). */
export async function getServeTicket(browserId: string, signal?: AbortSignal): Promise<ServeTicket> {
  const raw = await call<Record<string, unknown> | null>(`${BASE}serve-ticket/?browser_id=${encodeURIComponent(browserId)}`, { signal });
  if (!raw || typeof raw.ticket !== "string" || typeof raw.wait_url !== "string" || typeof raw.push_base !== "string") throw new ApiError("server", 500, ERROR_COPY.server);
  return { ticket: raw.ticket, wait_url: raw.wait_url, push_base: raw.push_base, expires_at: typeof raw.expires_at === "string" ? raw.expires_at : null };
}

/** `push_base` + job + the serve ticket. */
export function pushUrl(serve: ServeTicket, job: string): string {
  const base = serve.push_base.endsWith("/") ? serve.push_base : `${serve.push_base}/`;
  return `${base}${encodeURIComponent(job)}?t=${encodeURIComponent(serve.ticket)}`;
}
