/**
 * The owner's Chat list settings as plain data (v1.4.1): pins (up to 3, in pin order), muted chats and chats marked
 * as unread. Keys: "p<memberId>" for the owner's chat with a person, "g<groupId>" for a group. No imports, so the
 * unit tests run it under plain Node; chat/prefs.ts keeps it in step with the server (GET|PUT /api/chat/prefs/).
 */
export interface ChatPrefs {
  pins: string[];
  muted: string[];
  marked: string[];
}

export const MAX_PINS = 3;
export const EMPTY_PREFS: ChatPrefs = { pins: [], muted: [], marked: [] };

const KEY_RE = /^[pg]\d+$/;

function keys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((x): x is string => typeof x === "string" && KEY_RE.test(x)))];
}

/** Anything (storage, the server) → clean lists: known key shapes only, no repeats, at most 3 pins. */
export function normalisePrefs(raw: unknown): ChatPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof ChatPrefs, unknown>>;
  return { pins: keys(r.pins).slice(0, MAX_PINS), muted: keys(r.muted), marked: keys(r.marked) };
}

export function isEmptyPrefs(p: ChatPrefs): boolean {
  return !p.pins.length && !p.muted.length && !p.marked.length;
}

export function samePrefs(a: ChatPrefs, b: ChatPrefs): boolean {
  const eq = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i]);
  return eq(a.pins, b.pins) && eq(a.muted, b.muted) && eq(a.marked, b.marked);
}

const toggle = (list: string[], key: string) => (list.includes(key) ? list.filter((x) => x !== key) : [...list, key]);

/** Pin or unpin; null when it would be a 4th pin ("You can pin up to 3 chats."). */
export function withPin(p: ChatPrefs, key: string): ChatPrefs | null {
  if (!p.pins.includes(key) && p.pins.length >= MAX_PINS) return null;
  return { ...p, pins: toggle(p.pins, key) };
}

export function withMute(p: ChatPrefs, key: string): ChatPrefs {
  return { ...p, muted: toggle(p.muted, key) };
}

/** Mark as unread (a reminder dot until it is opened again), or clear that mark; the same object when nothing changes. */
export function withMarked(p: ChatPrefs, key: string, on: boolean): ChatPrefs {
  if (p.marked.includes(key) === on) return p;
  return { ...p, marked: on ? [...p.marked, key] : p.marked.filter((x) => x !== key) };
}

/** A chat that is gone (a deleted group): out of every list. */
export function withoutKey(p: ChatPrefs, key: string): ChatPrefs {
  if (!p.pins.includes(key) && !p.muted.includes(key) && !p.marked.includes(key)) return p;
  const drop = (l: string[]) => l.filter((x) => x !== key);
  return { pins: drop(p.pins), muted: drop(p.muted), marked: drop(p.marked) };
}
