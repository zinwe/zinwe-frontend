import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { Link, useLocation } from "react-router-dom";
import { errorMessage, listTodos } from "../../lib/api";
import { dueKey, dueLabel, dueStyle, isClosed, isDueToday, isFinished, isOpenTask, isOverdue, lastLine, statusStyle, SUB, type TaskPerson } from "../tasks/model";
import { TaskDrawer } from "../tasks/TaskDrawer";
import { todoView } from "../tasks/useMemberTodos";
import { taskActions } from "../tasks/useTasks";
import { TASK_SHORT, todayIso, type TaskView } from "../tasks/types";
import { EmptyBlock, ErrorBlock, SkRows } from "../ui/States";
import { useResource } from "../useResource";

/*
 * One person's tasks in their conversation (Chat → Tasks, owner note p_chat): the Tasks page's quick tiles, list
 * groups, rows and actions (Approve, Reopen, Nudge, Reply, Open), the same task drawer, task actions and to-dos
 * (tasks/*). The tile and group rules below are the Tasks page's (pages/TasksPage.tsx QUICK / LIST at the time of
 * writing); the Person column is left out, every row is the same person.
 */

type Quick = "ok" | "help" | "overdue" | "today" | "open";

const QUICK_DEFS: ReadonlyArray<[Quick, string, string, string]> = [
  ["ok", "Waiting for your OK", "#17663F", "#E3F4EA"],
  ["help", "Needs help", "#A84505", "#FDEBDC"],
  ["overdue", "Overdue", "#C0331C", "#FCE8E4"],
  ["today", "Due today", "#8A3A04", "#FDEBDC"],
  ["open", "All open", "#404040", "#F5F5F5"],
];
const QUICK: Record<Quick, (t: TaskView) => boolean> = {
  ok: (t) => t.status === "review",
  help: (t) => t.status === "help",
  overdue: (t) => isOverdue(t),
  today: (t) => isDueToday(t),
  open: (t) => isOpenTask(t),
};

/** List groups: each task sits in the first group it fits. */
const LIST: ReadonlyArray<{ id: string; label: string; hint: string; dot: string; has: (t: TaskView) => boolean }> = [
  { id: "needs", label: "Needs you", hint: "Waiting for your OK, or asking for help", dot: "#C0331C", has: (t) => t.status === "review" || t.status === "help" },
  { id: "overdue", label: "Overdue", hint: "Past the due time", dot: "#A84505", has: (t) => isOverdue(t) },
  { id: "today", label: "Today", hint: "Due later today", dot: "#F26A0A", has: (t) => t.due === todayIso() && !isFinished(t) },
  { id: "later", label: "Later", hint: "Due tomorrow or after", dot: "#6B6B6B", has: (t) => !isFinished(t) },
  { id: "done", label: "Done", hint: "", dot: "#17663F", has: () => true },
];

const OWN_TAG = { background: "#F5F5F5", color: "#6B6B6B" };
const OWN_DONE = { background: "#0A0A0A", color: "#FFFFFF" };
const OWN_STAGE: Partial<Record<TaskView["status"], string>> = { sent: "To do", progress: "In progress", approved: "Done" };
const DONE_SHOWN = 5;

function finishedAt(t: TaskView): number {
  if (t.own) return t.updatedAt;
  const end = [...t.log].reverse().find((e) => e.k === "approved" || e.k === "cancelled");
  return end ? end.at : t.updatedAt;
}

export function PersonTasks({
  person: p,
  tasks,
  loading,
  error,
  onRetry,
  onEdit,
  onOpenChat,
}: {
  person: TaskPerson & { memberId: number };
  /** Their assigned tasks (the page's polled task list, this person only). */
  tasks: readonly TaskView[];
  /** The task list hasn't come yet. */
  loading: boolean;
  /** The task list failed (and there's nothing to show). */
  error: unknown;
  onRetry: () => void;
  onEdit: (t: TaskView) => void;
  /** The drawer's "Open chat": back to the Chat tab. */
  onOpenChat: () => void;
}): ReactElement {
  const loadTodos = useCallback((signal: AbortSignal) => listTodos({ member: p.memberId }, signal), [p.memberId]);
  const todos = useResource(loadTodos, { pollMs: 60_000 });
  const all = [...tasks, ...(todos.data ?? []).map(todoView)];

  const [quick, setQuick] = useState<Quick | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [doneAll, setDoneAll] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);
  const say = (text: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = window.setTimeout(() => setToast(null), 6000);
  };

  // The drawer's "Open chat" goes to this same chat: any navigation closes the drawer and shows the chat.
  const { key: locationKey } = useLocation();
  const seenKey = useRef(locationKey);
  const drawerOpen = sel != null;
  useEffect(() => {
    if (seenKey.current === locationKey) return;
    seenKey.current = locationKey;
    // The Chat tab replaces this one, drawer and all.
    if (drawerOpen) onOpenChat();
  }, [locationKey, drawerOpen, onOpenChat]);

  const openTask = (id: number, focus?: "reply" | "reopen") => {
    setSel(id);
    if (focus) window.setTimeout(() => document.getElementById(focus === "reply" ? "dw-reply" : "dw-reopen")?.focus(), 120);
  };
  const closeDrawer = () => {
    const id = sel;
    setSel(null);
    if (id != null) window.setTimeout(() => document.getElementById(`open-${id}`)?.focus(), 40);
  };
  const run = (job: Promise<unknown>, ok: string) => job.then(() => say(ok), (err: unknown) => say(errorMessage(err)));
  const approve = (t: TaskView) => run(taskActions.approve(t), `Approved · ${p.first} sees this in their Zinwe app`);
  const nudge = (t: TaskView) => run(taskActions.nudge(t), `Nudged · ${p.first} gets a reminder in their Zinwe app`);

  const shown = all.filter((t) => !quick || QUICK[quick](t));
  const dir = sortDir === "asc" ? 1 : -1;
  const groupOf = (t: TaskView) => (LIST.find((g) => g.has(t)) ?? LIST[LIST.length - 1]).id;
  const groups = LIST.map((g) => {
    const list = shown
      .filter((t) => groupOf(t) === g.id)
      .sort((a, b) => (g.id === "done" ? finishedAt(b) - finishedAt(a) : dueKey(a) < dueKey(b) ? -dir : dueKey(a) > dueKey(b) ? dir : 0));
    const capped = g.id === "done" && list.length > DONE_SHOWN;
    return { ...g, list, rows: capped && !doneAll ? list.slice(0, DONE_SHOWN) : list, capped };
  }).filter((g) => g.list.length > 0);
  const selTask = sel != null ? (all.find((t) => t.id === sel) ?? null) : null;

  const actionsOf = (t: TaskView) =>
    !t.own && !isClosed(t) ? (
      <>
        {SUB[t.status] ? (
          <button type="button" className="z-btn xs" disabled={!!t.nudgedAt} aria-label={`${t.nudgedAt ? "Nudged" : "Nudge"} ${p.first} about ${t.title}`} onClick={() => nudge(t)}>
            {t.nudgedAt ? "Nudged" : "Nudge"}
          </button>
        ) : null}
        {t.status === "accepted" || t.status === "progress" ? (
          <button type="button" className="z-btn xs" aria-label={`Open ${t.title}`} onClick={() => openTask(t.id)}>
            Open
          </button>
        ) : null}
        {t.status === "help" ? (
          <button type="button" className="z-btn xs pri" aria-label={`Reply to ${p.first} about ${t.title}`} onClick={() => openTask(t.id, "reply")}>
            Reply
          </button>
        ) : null}
        {t.status === "review" ? (
          <>
            <button type="button" className="z-btn xs green" aria-label={`Approve ${t.title}`} onClick={() => approve(t)}>
              Approve
            </button>
            <button type="button" className="z-btn xs" aria-label={`Reopen ${t.title}`} onClick={() => openTask(t.id, "reopen")}>
              Reopen
            </button>
          </>
        ) : null}
      </>
    ) : null;

  const stepsOf = (t: TaskView) => {
    const n = t.steps.length;
    if (!n) return null;
    const doneN = t.steps.filter((x) => x.done).length;
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }} aria-label={`${doneN} of ${n} steps done`}>
        <span className="tk-bar">
          <span style={{ display: "block", height: "100%", borderRadius: 999, width: `${Math.round((doneN / n) * 100)}%`, background: doneN === n ? "#17663F" : "#F26A0A" }} />
        </span>
        <span className="z-num z-mono" style={{ fontSize: 11, color: "#404040" }}>
          {doneN}/{n}
        </span>
      </span>
    );
  };

  return (
    <div className="cv-threadwrap">
      <div className="cv-thread cv-ptasks zp-tasks">
        <span className="cv-ptasks__head">
          <span>Tasks with {p.first}. What needs you comes first.</span>
          <Link to={`/app/tasks#m=${p.key}`}>See {p.first}’s tasks on the Tasks page</Link>
        </span>
        {todos.error ? (
          <div className="tk-todo-err" role="alert">
            <span>Couldn’t load {p.first}’s own to-dos.</span>
            <button type="button" className="z-btn xs" onClick={todos.reload}>
              Retry
            </button>
          </div>
        ) : null}
        {error || loading ? null : (
          <section aria-label={`Quick filters for ${p.first}’s tasks`} className="tk-quick">
            {QUICK_DEFS.map(([id, label, fg, bg]) => {
              const n = all.filter(QUICK[id]).length;
              const on = quick === id;
              return (
                <button key={id} type="button" className={on ? "tk-qc on" : "tk-qc"} aria-pressed={on} onClick={() => setQuick(on ? null : id)}>
                  <span className="tk-qn" style={{ background: n ? bg : "#F5F5F5", color: n ? fg : "#6B6B6B" }}>
                    {n}
                  </span>
                  {label}
                </button>
              );
            })}
          </section>
        )}

        {error ? (
          <ErrorBlock message={errorMessage(error)} onRetry={onRetry} />
        ) : loading ? (
          <SkRows label={`Loading ${p.first}’s tasks`} rows={4} />
        ) : all.length === 0 ? (
          <EmptyBlock icon="tasks" title={`No tasks with ${p.first} yet`}>
            Send one with + Task below (on a phone, the Task icon in the message box).
          </EmptyBlock>
        ) : groups.length === 0 ? (
          <div className="cv-ptasks__none">
            <span>None of {p.first}’s tasks match this filter.</span>
            <button type="button" className="z-btn xs" onClick={() => setQuick(null)}>
              Show all
            </button>
          </div>
        ) : (
          <div role="table" aria-label={`${p.first}’s tasks: needs you, overdue, today, later and done`} className="tk-list">
            <div className="tk-list-in">
              <div role="row" className="tk-trow tk-thd">
                <span role="columnheader">Task</span>
                <span role="columnheader">Stage</span>
                <span role="columnheader" aria-sort={sortDir === "asc" ? "ascending" : "descending"}>
                  <button type="button" className="tk-lk" style={{ fontSize: 12, color: "#404040", display: "inline-flex", gap: 4, alignItems: "center" }} onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}>
                    Due <span aria-hidden="true">{sortDir === "asc" ? "↑" : "↓"}</span>
                    <span className="z-sr">{sortDir === "asc" ? ", soonest first. Select to show latest first" : ", latest first. Select to show soonest first"}</span>
                  </button>
                </span>
                <span role="columnheader">Progress</span>
                <span role="columnheader">Updated</span>
                <span role="columnheader">
                  <span className="z-sr">Action</span>
                </span>
              </div>
              {groups.map((g) => (
                <div role="rowgroup" key={g.id}>
                  <div role="row" className="tk-ghd">
                    <span role="rowheader" style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: "4px 8px" }}>
                      <span aria-hidden="true" style={{ flex: "none", width: 9, height: 9, borderRadius: "50%", background: g.dot }} />
                      {g.label}{" "}
                      <span className="z-num" style={{ color: "#6B6B6B", fontWeight: 600 }}>
                        {g.list.length}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 400, color: "#6B6B6B" }}>{g.hint}</span>
                    </span>
                  </div>
                  {g.rows.map((t) => {
                    const isHelp = t.status === "help";
                    const updated = t.own ? (t.status === "approved" ? "Done in their Zinwe app" : "Added in their Zinwe app") : lastLine(t, p.first, p.pcOn);
                    return (
                      <div role="row" key={t.id} className="tk-trow" style={isHelp ? { boxShadow: "inset 4px 0 0 #A84505" } : undefined}>
                        <span role="cell" style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                          {t.own ? (
                            <span style={{ fontWeight: 600, color: "var(--z-ink)" }}>{t.title}</span>
                          ) : (
                            <button type="button" id={`open-${t.id}`} className="tk-lk" onClick={() => openTask(t.id)}>
                              {t.title}
                            </button>
                          )}
                          {t.own || t.high || t.byMember ? (
                            <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                              {t.own ? (
                                <span className="zk-pill" style={OWN_TAG}>
                                  Own to-do
                                </span>
                              ) : null}
                              {t.high ? (
                                <span className="zk-pill" style={{ background: "#FCE8E4", color: "#C0331C" }}>
                                  High
                                </span>
                              ) : null}
                              {t.byMember ? (
                                <span className="zk-pill" style={{ background: "#F5F5F5", color: "#6B6B6B" }}>
                                  Added by {p.first}
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                        </span>
                        <span role="cell" className="tk-tc">
                          <span className="tk-mlab">Stage</span>
                          <span className="zk-pill" style={!t.own ? statusStyle(t.status) : t.status === "approved" ? OWN_DONE : t.status === "progress" ? statusStyle("progress") : OWN_TAG}>
                            {t.own ? OWN_STAGE[t.status] : TASK_SHORT[t.status]}
                          </span>
                        </span>
                        <span role="cell" className="tk-tc">
                          <span className="tk-mlab">Due</span>
                          <span className="zk-pill" style={dueStyle(t)}>
                            {dueLabel(t)}
                          </span>
                        </span>
                        <span role="cell" className="tk-tc">
                          <span className="tk-mlab">Progress</span>
                          {stepsOf(t) ?? <span style={{ color: "#6B6B6B" }}>—</span>}
                        </span>
                        <span role="cell" className="tk-tc tk-tw">
                          <span className="tk-mlab">Updated</span>
                          <span className="tk-up">{updated}</span>
                        </span>
                        <span role="cell" className="tk-ta">
                          {actionsOf(t)}
                        </span>
                      </div>
                    );
                  })}
                  {g.capped ? (
                    <div role="row" style={{ padding: "8px 16px", borderBottom: "1px solid #F5F5F5" }}>
                      <span role="cell">
                        <button type="button" className="z-btn xs" style={{ background: "transparent" }} aria-expanded={doneAll} onClick={() => setDoneAll(!doneAll)}>
                          {doneAll ? "Show less" : `Show ${g.list.length - DONE_SHOWN} more`}
                        </button>
                      </span>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {selTask ? <TaskDrawer key={selTask.id} task={selTask} person={p} chatHref={`/app/chat/${p.key}`} onClose={closeDrawer} onEdit={onEdit} say={say} /> : null}

      <div role="status" aria-live="polite" className="zk-toast-wrap">
        {toast ? (
          <div className="zk-toast">
            <span>{toast}</span>
            <button
              type="button"
              className="zk-toast__x"
              aria-label="Dismiss"
              onClick={() => {
                window.clearTimeout(toastTimer.current);
                setToast(null);
              }}
            >
              ×
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
