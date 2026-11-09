import { useSyncExternalStore } from "react";
import { parseHeld, pruneHeld, type HeldFile } from "../../lib/chatFileModel";

/**
 * v1.5 round 2 (BRIEF2 §4): files the owner shares stay in THIS browser. Each picked file is copied into the
 * origin-private file system (OPFS, `navigator.storage.getDirectory()`), so it survives reloads; the server only
 * gets its OPFS name as `local_ref`. The list of what this browser keeps (id → OPFS name, name, size, chat) lives in
 * localStorage per owner, with a random browser id (the relay's holder is b<owner>.<browser_id>).
 * The relay loop (relayServe.ts) pushes from here while the dashboard is open.
 */

const DIR = "zinwe-shared";
const BID_KEY = "zinwe.browser_id";
const heldKey = (owner: string) => `zinwe.held.${owner}`;

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function newBatchId(): string {
  return uuid();
}

/** This browser's id (made once, kept in localStorage). */
export function browserId(): string {
  try {
    const have = localStorage.getItem(BID_KEY);
    if (have) return have;
    const made = uuid().replace(/-/g, "");
    localStorage.setItem(BID_KEY, made);
    return made;
  } catch {
    // Storage blocked: an id for this visit only (the files can't outlive it anyway).
    memoryBid ??= uuid().replace(/-/g, "");
    return memoryBid;
  }
}
let memoryBid: string | null = null;

/** OPFS with writable files (Chrome, Edge, Firefox; Safari only from its newest versions). */
export function opfsSupported(): boolean {
  try {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.storage?.getDirectory === "function" &&
      typeof FileSystemFileHandle !== "undefined" &&
      typeof (FileSystemFileHandle.prototype as { createWritable?: unknown }).createWritable === "function"
    );
  } catch {
    return false;
  }
}

/** The browser won't keep a file this big (no OPFS, or the quota is too small). */
export class NoRoom extends Error {
  readonly noRoom = true;
  constructor() {
    super("no room");
    this.name = "NoRoom";
  }
}

/** Is there room for `bytes` more? Unknown = yes (the copy itself then says). */
export async function roomFor(bytes: number): Promise<boolean> {
  if (!opfsSupported()) return false;
  try {
    const est = await navigator.storage.estimate();
    if (!est.quota) return true;
    return est.quota - (est.usage ?? 0) > bytes * 1.02 + 1024 * 1024;
  } catch {
    return true;
  }
}

let persistAsked = false;
/** Ask once per visit that the browser keeps our storage (it may still say no; the files then stay best-effort). */
export function askPersist(): void {
  if (persistAsked) return;
  persistAsked = true;
  try {
    void navigator.storage?.persist?.().catch(() => undefined);
  } catch {
    // Not offered here.
  }
}

async function dir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create: true });
}

/**
 * Copy a picked file into OPFS (streamed, so a 5 GB video never sits in memory). `onProgress` gets 0…1.
 * Resolves with its OPFS name; throws NoRoom when the browser can't keep it.
 */
export async function holdFile(file: File, { onProgress, signal }: { onProgress?: (p: number) => void; signal?: AbortSignal } = {}): Promise<string> {
  if (!opfsSupported() || !(await roomFor(file.size))) throw new NoRoom();
  const d = await dir();
  const ref = uuid();
  const handle = await d.getFileHandle(ref, { create: true });
  let done = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      done += chunk.byteLength;
      if (file.size > 0) onProgress?.(done / file.size);
      ctrl.enqueue(chunk);
    },
  });
  try {
    const writable = await handle.createWritable();
    await file.stream().pipeThrough(counter).pipeTo(writable, { signal });
  } catch (error) {
    try {
      await d.removeEntry(ref);
    } catch {
      // Nothing was written.
    }
    if (error instanceof DOMException && error.name === "QuotaExceededError") throw new NoRoom();
    throw error;
  }
  onProgress?.(1);
  return ref;
}

/** The kept file (disk-backed, read lazily), or null when it is gone (site data cleared). */
export async function heldBlob(ref: string): Promise<File | null> {
  if (!opfsSupported()) return null;
  try {
    const d = await dir();
    return await (await d.getFileHandle(ref)).getFile();
  } catch {
    return null;
  }
}

export async function dropHeldFile(ref: string): Promise<void> {
  if (!opfsSupported()) return;
  try {
    await (await dir()).removeEntry(ref);
  } catch {
    // Already gone.
  }
}

// ---- The list of kept files (per owner), as a small store for React ----

let owner = "0";
let held: HeldFile[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

function read(): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(heldKey(owner));
  } catch {
    raw = null;
  }
  const { keep, drop } = pruneHeld(parseHeld(raw), Date.now());
  held = keep;
  loaded = true;
  if (drop.length) {
    write();
    drop.forEach((h) => void dropHeldFile(h.ref));
  }
}

function write(): void {
  try {
    localStorage.setItem(heldKey(owner), JSON.stringify(held));
  } catch {
    // Storage full or blocked: the list lives for this visit.
  }
}

function ensure(): void {
  if (!loaded) read();
}

/** The signed-in owner (the list is theirs only). Set by the dashboard shell. */
export function setHeldOwner(id: number | string | null | undefined): void {
  const next = id == null ? "0" : String(id);
  if (next === owner && loaded) return;
  owner = next;
  read();
  emit();
}

export function heldList(): HeldFile[] {
  ensure();
  return held;
}

export function findHeld(id: string): HeldFile | null {
  ensure();
  return held.find((h) => h.id === id) ?? null;
}

export function addHeld(entry: HeldFile): void {
  ensure();
  held = [entry, ...held.filter((h) => h.id !== entry.id)];
  write();
  emit();
}

/** Forget a kept file and delete its copy. */
export function removeHeld(id: string): void {
  ensure();
  const gone = held.find((h) => h.id === id);
  if (!gone) return;
  held = held.filter((h) => h.id !== id);
  write();
  emit();
  void dropHeldFile(gone.ref);
}

export function subscribeHeld(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The files this browser keeps (newest first). */
export function useHeld(): HeldFile[] {
  return useSyncExternalStore(subscribeHeld, heldList, () => held);
}

/** SHA-256 (hex) of a small file, for the server's record; null for big ones (no streaming hash in browsers). */
export async function sha256Of(file: Blob, maxBytes = 100 * 1024 * 1024): Promise<string | null> {
  if (file.size > maxBytes || typeof crypto?.subtle?.digest !== "function") return null;
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}
