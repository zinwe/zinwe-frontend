import { useEffect } from "react";
import { getServeTicket, patchChatFile, pushUrl, type ServeTicket } from "../../lib/api/chatFiles";
import { parseJob, ticketFresh } from "../../lib/chatFileModel";
import { browserId, findHeld, heldBlob, heldList, removeHeld, setHeldOwner, subscribeHeld } from "./fileHold";

/**
 * v1.5 round 2 (BRIEF2 §1, §4): while the dashboard is open and this browser keeps shared files, it waits on the
 * relay (`GET /relay/wait`, held ≤ 25 s) and, on a job, PUTs the file from OPFS (`/relay/push/<job>`, from the
 * job's offset). At most 3 pushes at once. The serve ticket (24 h) is refreshed with an hour left.
 *
 * It runs on the main thread: every step is a fetch, so nothing blocks the page, and a Web Worker would need its
 * own copy of the token and the kept-files list. Only one tab per browser serves (Web Locks), so two open tabs don't
 * both wait as the same holder.
 */

const WAIT_TIMEOUT_MS = 40_000;
const TICKET_MARGIN_MS = 60 * 60 * 1000;
const MAX_PUSHES = 3;
const LOCK = "zinwe-relay-serve";

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(id), resolve()), { once: true });
  });

let active = 0;
const queue: Array<() => void> = [];

function slot(): Promise<() => void> {
  return new Promise((resolve) => {
    const take = () => {
      active += 1;
      resolve(() => {
        active -= 1;
        queue.shift()?.();
      });
    };
    if (active < MAX_PUSHES) take();
    else queue.push(take);
  });
}

/** Send one job: the kept file from `offset`. A file this browser lost is reported gone (PATCH) and forgotten. */
async function push(serve: ServeTicket, job: { job: string; file_id: string; offset: number }): Promise<void> {
  const entry = findHeld(job.file_id);
  if (!entry) return;
  const file = await heldBlob(entry.ref);
  if (!file || file.size !== entry.size) {
    void patchChatFile(entry.id, { gone: true }).catch(() => undefined);
    removeHeld(entry.id);
    return;
  }
  const release = await slot();
  try {
    // A disk-backed Blob body: the browser reads it as the relay takes it (the relay pushes back when it's full).
    await fetch(pushUrl(serve, job.job), {
      method: "PUT",
      body: file.slice(job.offset),
      headers: { "Content-Type": "application/octet-stream" },
      credentials: "omit",
    });
    // 499 / 410: the receiver went away; nothing more to do.
  } catch {
    // The relay dropped it; the receiver's download says so and can be started again.
  } finally {
    release();
  }
}

async function loop(signal: AbortSignal): Promise<void> {
  let serve: ServeTicket | null = null;
  let backoff = 2000;
  while (!signal.aborted && heldList().length > 0) {
    try {
      if (!serve || !ticketFresh(serve.expires_at, Date.now(), TICKET_MARGIN_MS)) serve = await getServeTicket(browserId(), signal);
      const ctrl = new AbortController();
      const stop = () => ctrl.abort();
      signal.addEventListener("abort", stop, { once: true });
      const timer = setTimeout(stop, WAIT_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(serve.wait_url, { credentials: "omit", cache: "no-store", signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", stop);
      }
      if (response.status === 204) {
        backoff = 2000;
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        // The ticket expired or was refused: get a new one.
        serve = null;
        await sleep(backoff, signal);
        backoff = Math.min(backoff * 2, 30_000);
        continue;
      }
      if (!response.ok) throw new Error(`wait ${response.status}`);
      const job = parseJob(await response.json().catch(() => null));
      if (job) void push(serve, job);
      backoff = 2000;
    } catch {
      if (signal.aborted) break;
      await sleep(backoff, signal);
      backoff = Math.min(backoff * 2, 30_000);
    }
  }
}

let running: AbortController | null = null;

/** Start serving if this browser keeps files and nothing serves yet. */
function start(): void {
  if (running || heldList().length === 0) return;
  const ctrl = new AbortController();
  running = ctrl;
  const run = () => loop(ctrl.signal);
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  const done = () => {
    if (running === ctrl) running = null;
    // More files may have been added after the loop ended.
    if (!ctrl.signal.aborted) start();
  };
  if (locks?.request) {
    void locks.request(LOCK, { signal: ctrl.signal }, run).then(done, done);
  } else {
    void run().then(done, done);
  }
}

function stopServing(): void {
  running?.abort();
  running = null;
}

/** Mounted once by the dashboard shell: the signed-in owner's kept files are served while the page is open. */
export function useRelayServe(ownerId: number | null | undefined): void {
  useEffect(() => {
    if (ownerId == null) return;
    setHeldOwner(ownerId);
    start();
    const off = subscribeHeld(start);
    return () => {
      off();
      stopServing();
    };
  }, [ownerId]);
}
