import { useSyncExternalStore } from "react";

/**
 * The owner's own list settings for Chat (v1.4): pinned chats (up to 3, in pin order), muted chats, and chats
 * marked as unread. The chat API has no owner-side fields for these (pins/mutes there are per member), so they are
 * kept on this browser, like the other per-viewer conveniences. Keys: "p<memberId>" for a person, "g<groupId>"
 * for a group.
 */
export interface ChatPrefs {
  pins: string[];
  muted: string[];
  marked: string[];
}

export const MAX_PINS = 3;
const KEY = "zinwe.chat.prefs";
const EMPTY: ChatPrefs = { pins: [], muted: [], marked: [] };

let current: ChatPrefs | null = null;
const listeners = new Set<() => void>();

function read(): ChatPrefs {
  if (current) return current;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<ChatPrefs> | null;
    current = {
      pins: Array.isArray(raw?.pins) ? raw.pins.filter((x) => typeof x === "string").slice(0, MAX_PINS) : [],
      muted: Array.isArray(raw?.muted) ? raw.muted.filter((x) => typeof x === "string") : [],
      marked: Array.isArray(raw?.marked) ? raw.marked.filter((x) => typeof x === "string") : [],
    };
  } catch {
    current = EMPTY;
  }
  return current;
}

function write(next: ChatPrefs): void {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: kept until reload */
  }
  for (const l of listeners) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      current = null;
      fn();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

export function useChatPrefs(): ChatPrefs {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

const toggle = (list: string[], key: string) => (list.includes(key) ? list.filter((x) => x !== key) : [...list, key]);

/** Pin or unpin. False when it would be a 4th pin (the page says "You can pin up to 3 chats."). */
export function togglePin(key: string): boolean {
  const p = read();
  if (!p.pins.includes(key) && p.pins.length >= MAX_PINS) return false;
  write({ ...p, pins: toggle(p.pins, key) });
  return true;
}

export function toggleMute(key: string): void {
  const p = read();
  write({ ...p, muted: toggle(p.muted, key) });
}

/** Mark as unread (a reminder dot until it is opened again), or clear that mark. */
export function setMarked(key: string, on: boolean): void {
  const p = read();
  if (p.marked.includes(key) === on) return;
  write({ ...p, marked: on ? [...p.marked, key] : p.marked.filter((x) => x !== key) });
}

export function clearMarked(): void {
  const p = read();
  if (p.marked.length) write({ ...p, marked: [] });
}
