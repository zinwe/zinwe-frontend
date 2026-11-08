import type { WorkLogEntry } from "../../lib/api";
import type { AlertView } from "../alerts/alertModel";

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "2 requests · 5 alerts · 3 tasks" (the tile, the Needs you line and Show all (N) read the same counts). */
export function needsBreakdown(req: number, alerts: number, tasks: number): string {
  return [
    req ? plural(req, "request", "requests") : "",
    alerts ? plural(alerts, "alert", "alerts") : "",
    tasks ? plural(tasks, "task", "tasks") : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "10 need you · 2 requests · 5 alerts · 3 tasks", or "Nothing waiting". */
export function needsLine(n: number, req: number, alerts: number, tasks: number): string {
  return n ? `${n} need you · ${needsBreakdown(req, alerts, tasks)}` : "Nothing waiting";
}

/** The one count behind the Needs you tile and card. */
export function needsCounts(
  requests: WorkLogEntry[] | undefined,
  alerts: AlertView[] | undefined,
  /** Team tasks (v1.4): the ones waiting on you — your OK, a reply to "needs help", a decision on "can't do it". */
  tasks: ReadonlyArray<{ status: string }> | undefined,
  /** Leave requests waiting for a decision (v1.4.1): counted with the requests. */
  leave: ReadonlyArray<{ status: string }> | undefined = undefined,
): { req: number; alerts: number; tasks: number; total: number } {
  const req = (requests ?? []).filter((r) => r.approval === "pending").length + (leave ?? []).filter((l) => l.status === "requested").length;
  const al = (alerts ?? []).filter((a) => !a.done && a.level === "needs").length;
  const tk = (tasks ?? []).filter((t) => t.status === "help" || t.status === "review" || t.status === "cantdo").length;
  return { req, alerts: al, tasks: tk, total: req + al + tk };
}
