import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../lib/api";
import type { TaskStatus, TaskView } from "./types";

/** How long Undo stays on screen; the change is sent to the API when it runs out (or sooner, see flush). */
export const UNDO_MS = 6000;

interface Pending {
  timer: number;
  to: TaskStatus;
  run: () => Promise<TaskView>;
}

/**
 * Approve / Reopen with Undo on the existing endpoints. The API has no "un-approve" (reopening an approved task puts
 * it back to In progress, not to Waiting for your OK), so a real Undo means the call waits: the task shows its new
 * stage at once, and the approve / reopen goes out when the Undo toast runs out, when the next undoable change is made,
 * when the task's drawer opens, when the toast is closed, or when the page is left. Undo drops it unsent.
 */
export function useDeferredActions(server: readonly TaskView[] | undefined, onError: (text: string) => void) {
  const [shown, setShown] = useState<Record<number, { to: TaskStatus; from: TaskStatus }>>({});
  const pending = useRef(new Map<number, Pending>());
  const errRef = useRef(onError);
  useEffect(() => {
    errRef.current = onError;
  });

  const drop = useCallback((id: number) => {
    setShown((s) => {
      if (!(id in s)) return s;
      const next = { ...s };
      delete next[id];
      return next;
    });
  }, []);

  const commit = useCallback(
    (id: number) => {
      const p = pending.current.get(id);
      if (!p) return;
      window.clearTimeout(p.timer);
      pending.current.delete(id);
      // The new stage stays shown until the reloaded list carries it (no flicker back). If the saved task came back
      // at another stage (someone else moved it meanwhile), or on an error, the list shows the truth at once.
      p.run().then(
        (saved) => {
          if (saved.status !== p.to) drop(id);
        },
        (err: unknown) => {
          drop(id);
          errRef.current(errorMessage(err));
        },
      );
    },
    [drop],
  );

  const flush = useCallback(() => {
    for (const id of [...pending.current.keys()]) commit(id);
  }, [commit]);

  /** Show `t` at stage `to` now; send `run` later (Undo cancels it). */
  const defer = useCallback(
    (t: TaskView, to: TaskStatus, run: () => Promise<TaskView>) => {
      flush();
      setShown((s) => ({ ...s, [t.id]: { to, from: t.status } }));
      const timer = window.setTimeout(() => commit(t.id), UNDO_MS);
      pending.current.set(t.id, { timer, to, run });
    },
    [commit, flush],
  );

  const undo = useCallback(
    (id: number) => {
      const p = pending.current.get(id);
      if (p) {
        window.clearTimeout(p.timer);
        pending.current.delete(id);
      }
      drop(id);
    },
    [drop],
  );

  // Once the server's copy has moved on from where it was (or the task is gone), the overlay is no longer needed.
  useEffect(() => {
    if (!server) return;
    setShown((s) => {
      let changed = false;
      const next = { ...s };
      for (const key of Object.keys(s)) {
        const id = Number(key);
        if (pending.current.has(id)) continue;
        const live = server.find((t) => t.id === id);
        if (!live || live.status !== s[id].from) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : s;
    });
  }, [server]);

  // Leaving the page (another route, closing the tab) sends what is still waiting.
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      flush();
    };
  }, [flush]);

  const overlay = useCallback((t: TaskView): TaskView => (shown[t.id] ? { ...t, status: shown[t.id].to } : t), [shown]);
  return { overlay, defer, undo, flush };
}
