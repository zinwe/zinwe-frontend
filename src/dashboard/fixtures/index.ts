/**
 * THE sample-data seam (v1.3 UI build, 29 Oct 2026).
 *
 * Screens drawn in Prototype v2.2 that the API does not serve yet read typed sample data from this folder,
 * always through a loader with the same shape as a real API call — `(signal) => Promise<T>` — so a page uses it
 * with `useResource` exactly like `lib/api`. When the endpoint ships, the loader body becomes the API call and
 * nothing in the page changes.
 *
 * Every area that still reads sample data is listed in SAMPLE_AREAS (and in .claude/dev/docs/06-website-portal.md).
 *
 * SAMPLES_ON is THE switch. On in the dev server (`npm run dev`) and in a build made with VITE_SAMPLE_DATA=1;
 * off in every plain `npm run build` (production). When it is off, real owners never see sample data: the loaders
 * here return nothing (no second PC…), the save functions do nothing, and the screens hide
 * every sample-only control (see SAMPLE_AREAS and 06-website-portal.md, "Dashboard v1.3 → Sample data in production").
 */

/** Sample-only features are shown (dev server, or a build with VITE_SAMPLE_DATA=1). Off in production builds. */
export const SAMPLES_ON: boolean = import.meta.env.DEV || import.meta.env.VITE_SAMPLE_DATA === "1";

export interface SampleArea {
  /** Fixture module in this folder. */
  module: string;
  /** What it stands in for. */
  what: string;
  /** The plan row that will serve it. */
  waitsFor: string;
}

export const SAMPLE_AREAS: readonly SampleArea[] = [
  { module: "performance.ts", what: "Reports → Performance tab (ranking): tasks done + usual hours are sample, worked time is real", waitsFor: "FR-34" },
  { module: "majorAlerts.ts", what: "Alerts + Overview Needs you: which alerts were asked about (Asked · waiting / replied), the reply on the alert, legend / Ask / Why-it-matters wording", waitsFor: "FR-35" },
  { module: "pcs.ts", what: "Two PCs per person on Team & PCs (card block + notice) and its Activity timeline line", waitsFor: "FR-36" },
  { module: "settings.ts", what: "Settings: Where you're signed in (this browser only), Daily email summary switch", waitsFor: "sessions API + digest preference" },
  { module: "releaseNotes.ts", what: "Help → What's new when the API has no published notes (Zinwe 1.3, 1.2, 1.1 from the board)", waitsFor: "release notes published in admin (FR-21)" },
  { module: "chat.ts", what: "Chat groups (Design, Development, Everyone), their lines, one report and the chat settings, only while the server has no /api/chat/", waitsFor: "v1.4 z_chat" },
  { module: "rules.ts", what: "Rules: Allow (no alert) for remote tools, custom tool names, new-software alerts", waitsFor: "policy API fields for these settings" },
  {
    module: "workRules.ts",
    what: "Rules v1.4 (work hours per scope, holidays, per-department / per-PC protection) and Reports day status, only while the backend has no v1.4 endpoints",
    waitsFor: "v1.4 backend (brief §1c)",
  },
];

/** Resolve sample data like a network call: async, abortable, a short delay so loading states are real. */
export function sample<T>(data: T, signal?: AbortSignal, ms = 180): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const id = window.setTimeout(() => resolve(structuredClone(data)), ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(id);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/** Sample stores keep changes for the tab's life (approve a task, mark a note read), like a server would. */
export function sampleStore<T>(key: string, initial: () => T): { get: () => T; set: (next: T) => void } {
  const storageKey = `zinwe.sample.${key}`;
  let value: T | undefined;
  return {
    get: () => {
      if (value !== undefined) return value;
      try {
        const raw = sessionStorage.getItem(storageKey);
        value = raw ? (JSON.parse(raw) as T) : initial();
      } catch {
        value = initial();
      }
      return value;
    },
    set: (next: T) => {
      value = next;
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* storage blocked: changes last until reload */
      }
    },
  };
}
