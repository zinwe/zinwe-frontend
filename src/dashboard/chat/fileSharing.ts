import { useEffect, useSyncExternalStore } from "react";
import type { ChatSettings } from "../../lib/api";
import { DEFAULT_FILE_MAX_MB, planMaxBytes } from "../../lib/chatFileModel";
import { loadChatSettings } from "./groupsSource";

/**
 * v1.5: whether the owner can attach files in chat (Settings › Chat › Allow file sharing, `allow_files`).
 * Read once per visit from GET /api/chat/settings/ and kept fresh every 5 minutes while a composer is open; the
 * settings dialog and a "turned off" upload answer update it at once. An older backend leaves `allow_files` out,
 * and a failed read (no chat API, no team chat on the plan) counts as off: the attach button stays hidden.
 * Round 2: the same read carries the plan's per-file limit (`file_max_bytes` / `max_bytes`; 1 GB when missing).
 */

const FRESH_MS = 5 * 60 * 1000;

let allowed = false;
let maxBytes = DEFAULT_FILE_MAX_MB * 1024 * 1024;
let loadedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (next === allowed) return;
  allowed = next;
  listeners.forEach((fn) => fn());
}

/** Learn from a settings payload (the dialog's load and save). */
export function rememberChatSettings(settings: Partial<ChatSettings> | null | undefined): void {
  loadedAt = Date.now();
  const max = planMaxBytes(settings);
  if (max && max !== maxBytes) {
    maxBytes = max;
    listeners.forEach((fn) => fn());
  }
  set(settings?.allow_files === true);
}

/** The plan's per-file limit in bytes (as last read). */
export function fileMaxBytes(): number {
  return maxBytes;
}

/** An upload answered 403 "Your admin has turned off file sharing.". */
export function rememberSharingOff(): void {
  loadedAt = Date.now();
  set(false);
}

function refresh(): void {
  if (inflight || Date.now() - loadedAt < FRESH_MS) return;
  inflight = loadChatSettings()
    .then(rememberChatSettings)
    .catch(() => {
      // Keep what we knew; try again after the next 5 minutes.
      loadedAt = Date.now();
    })
    .finally(() => {
      inflight = null;
    });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** True when the attach button shows. */
export function useFileSharing(): boolean {
  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, FRESH_MS);
    return () => window.clearInterval(id);
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => allowed,
    () => false,
  );
}
