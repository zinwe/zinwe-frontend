import { useEffect, useRef, useSyncExternalStore } from "react";
import { ApiError, errorMessage, getChatPrefs, saveChatPrefs } from "../../lib/api";
import {
  EMPTY_PREFS,
  isEmptyPrefs,
  normalisePrefs,
  samePrefs,
  withMarked,
  withMute,
  withoutKey,
  withPin,
  type ChatPrefs,
} from "./prefsModel";

export { MAX_PINS, type ChatPrefs } from "./prefsModel";

/**
 * The owner's own list settings for Chat: pinned chats (up to 3, in pin order), muted chats, and chats marked as
 * unread. Keys: "p<memberId>" for a person, "g<groupId>" for a group.
 *
 * v1.4.1: the server is the truth (GET|PUT /api/chat/prefs/, the same on every browser; it mirrors group keys into
 * the group's pinned / muted). This browser keeps a copy in localStorage, so the list shows at once and still works
 * against a server without the endpoint (404: local only, as in v1.4). The first use loads the server's lists (and
 * again when the tab comes back after a while); every change shows at once and is saved a moment later (one PUT for
 * quick changes in a row). A refused save (e.g. "You can pin up to 3 chats.") puts the last saved lists back and tells
 * the page (usePrefsError).
 */

const KEY = "zinwe.chat.prefs";
const SAVE_MS = 400;
const REFRESH_MS = 30_000;

type Server = "unknown" | "loading" | "on" | "off";

let current: ChatPrefs | null = null;
/** The lists the server last confirmed (what a refused save goes back to). */
let confirmed: ChatPrefs | null = null;
let server: Server = "unknown";
let loadedAt = 0;
let saveTimer: number | undefined;
/** Bumped by every local change: a save's answer only lands when nothing changed while it was on its way. */
let version = 0;
const listeners = new Set<() => void>();
const errorListeners = new Set<(text: string) => void>();

interface Stored extends ChatPrefs {
  /** This copy came from (or reached) the server at least once. */
  synced?: boolean;
}

function readStored(): Stored | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null") as Stored | null;
  } catch {
    return null;
  }
}

function read(): ChatPrefs {
  if (current) return current;
  const raw = readStored();
  current = raw ? normalisePrefs(raw) : EMPTY_PREFS;
  return current;
}

function store(next: ChatPrefs, synced: boolean): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...next, synced: synced || !!readStored()?.synced }));
  } catch {
    /* storage blocked: kept until reload */
  }
}

function emit(): void {
  for (const l of listeners) l();
}

/** Show these lists (and keep them on this browser). */
function show(next: ChatPrefs, synced = false): void {
  current = next;
  store(next, synced);
  emit();
}

function missing(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 403);
}

function load(): void {
  if (server === "loading" || server === "off") return;
  if (server === "on" && Date.now() - loadedAt < REFRESH_MS) return;
  if (saveTimer !== undefined) return; // a save is on its way: its answer is newer
  const first = server === "unknown";
  server = "loading";
  const at = version;
  getChatPrefs()
    .then((raw) => {
      server = "on";
      loadedAt = Date.now();
      const srv = normalisePrefs(raw);
      confirmed = srv;
      if (version !== at) {
        // Changed here while loading: those changes win, saved now.
        queueSave();
        return;
      }
      const local = read();
      if (first && isEmptyPrefs(srv) && !isEmptyPrefs(local) && !readStored()?.synced) {
        // First visit after the server learned prefs: keep this browser's pins and send them up.
        queueSave();
        return;
      }
      if (!samePrefs(srv, local)) show(srv, true);
      else store(srv, true);
    })
    .catch((e: unknown) => {
      // No endpoint (an older server, or sample chat): this browser only, as before.
      server = missing(e) ? "off" : "unknown";
    });
}

function queueSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void save(), SAVE_MS);
}

async function save(): Promise<void> {
  saveTimer = undefined;
  if (server === "off") return;
  if (server === "loading") {
    queueSave();
    return;
  }
  const sent = read();
  const at = version;
  try {
    const back = normalisePrefs(await saveChatPrefs(sent));
    server = "on";
    loadedAt = Date.now();
    confirmed = back;
    if (version === at && saveTimer === undefined && !samePrefs(back, read())) show(back, true);
    else store(read(), true);
  } catch (e) {
    if (missing(e)) {
      server = "off";
      return;
    }
    if (version !== at || saveTimer !== undefined) return; // a newer change is being saved
    if (confirmed) show(confirmed);
    const text = errorMessage(e);
    for (const l of errorListeners) l(text);
  }
}

/** A change made here: show it now, save it in a moment. */
function change(next: ChatPrefs): void {
  if (next === read()) return;
  version++;
  show(next);
  if (server !== "off") queueSave();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  load();
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      current = null;
      fn();
    }
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") load();
  };
  window.addEventListener("storage", onStorage);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

export function useChatPrefs(): ChatPrefs {
  return useSyncExternalStore(subscribe, read, () => EMPTY_PREFS);
}

/** Hear about a save the server refused (the lists are already back as they were). */
export function usePrefsError(onError: (text: string) => void): void {
  const ref = useRef(onError);
  useEffect(() => {
    ref.current = onError;
  }, [onError]);
  useEffect(() => {
    const l = (text: string) => ref.current(text);
    errorListeners.add(l);
    return () => {
      errorListeners.delete(l);
    };
  }, []);
}

/** Pin or unpin. False when it would be a 4th pin (the page says "You can pin up to 3 chats."). */
export function togglePin(key: string): boolean {
  const next = withPin(read(), key);
  if (!next) return false;
  change(next);
  return true;
}

export function toggleMute(key: string): void {
  change(withMute(read(), key));
}

/** Mark as unread (a reminder dot until it is opened again), or clear that mark. */
export function setMarked(key: string, on: boolean): void {
  change(withMarked(read(), key, on));
}

export function clearMarked(): void {
  const p = read();
  if (p.marked.length) change({ ...p, marked: [] });
}

/** A chat that is gone (a deleted group): drop it here too (the server already dropped it). */
export function forgetChat(key: string): void {
  const p = read();
  const next = withoutKey(p, key);
  if (next === p) return;
  current = next;
  store(next, false);
  if (confirmed) confirmed = withoutKey(confirmed, key);
  emit();
}

