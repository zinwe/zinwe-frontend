import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { usePageMeta } from "../../hooks/usePageMeta";
import { errorMessage, listMembers, type MemberTodo } from "../../lib/api";
import { PlanLock } from "../components/PlanLock";
import { useEntitlements } from "../features/entitlements";
import { PageHead } from "../shell/PageHead";
import { EmptyBlock, ErrorBlock, Sk, SkRows } from "../ui/States";
import { ZIcon } from "../ui/ZIcon";
import { useResource } from "../useResource";
import { Avatar } from "../tasks/Avatar";
import { BoardMark, SearchMark } from "../tasks/icons";
import {
  dueKey,
  dueLabel,
  dueStyle,
  findPerson,
  isClosed,
  isDueToday,
  isFinished,
  isOpenTask,
  isOverdue,
  lastLine,
  peopleOf,
  personOfTask,
  statusStyle,
  SUB,
  type TaskPerson,
} from "../tasks/model";
import { TaskDrawer } from "../tasks/TaskDrawer";
import { TaskForm, type TaskFormValues } from "../tasks/TaskForm";
import { TheirTodos, TodoCard } from "../tasks/TheirTodos";
import { sortTodos, todoDueToday, todoOverdue, useMemberTodos } from "../tasks/useMemberTodos";
import { taskActions, useTasks } from "../tasks/useTasks";
import { TASK_COLUMNS, TASK_SHORT, todayIso, type TaskView } from "../tasks/types";
import "../../styles/dash13/tasks.css";

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
/** The same quick filters on members' own to-dos (they never wait for your OK or ask for help). */
const QUICK_TODO: Record<Quick, (t: MemberTodo) => boolean> = {
  ok: () => false,
  help: () => false,
  overdue: (t) => todoOverdue(t),
  today: (t) => todoDueToday(t),
  open: (t) => t.status === "open",
};
/** Done to-dos shown in the board's "Their own to-dos" column before "Show N more" (like the Done column). */
const TODO_DONE_SHOWN = 5;

/** List view groups: each task sits in the first group it fits. */
const LIST: ReadonlyArray<{ id: string; label: string; hint: string; dot: string; has: (t: TaskView) => boolean }> = [
  { id: "needs", label: "Needs you", hint: "Waiting for your OK, or asking for help", dot: "#C0331C", has: (t) => t.status === "review" || t.status === "help" },
  { id: "overdue", label: "Overdue", hint: "Past the due time", dot: "#A84505", has: (t) => isOverdue(t) },
  { id: "today", label: "Today", hint: "Due later today", dot: "#F26A0A", has: (t) => t.due === todayIso() && !isFinished(t) },
  { id: "later", label: "Later", hint: "Due tomorrow or after", dot: "#6B6B6B", has: (t) => !isFinished(t) },
  { id: "done", label: "Done", hint: "", dot: "#17663F", has: () => true },
];

interface Toast {
  text: string;
}

const chatHrefOf = (p: TaskPerson | null) => (p && p.memberId !== null ? `/app/chat/${p.key}` : "/app/chat");

/**
 * /app/tasks (board DashTasks): every task the owner sent, what needs you first. List (grouped) or Board (stages),
 * quick filters, person + search filters, the task drawer (#task=<id> or ?task=<id>, the notification link) and New
 * task (#new=1). The to-dos people added for themselves show read-only: a "Their own to-dos" column on the Board, cards
 * under the List. The quick-filter counts, the person and search filters and the "N tasks" line cover both.
 * FR-20 v2 tasks API; plan module team_chat (like Chat).
 */
export default function TasksPage(): ReactElement {
  usePageMeta({ title: "Tasks — Zinwe", description: "Every task you sent your team, and what needs you." });
  const { has } = useEntitlements();
  if (!has("team_chat")) {
    return (
      <div className="zp-tasks zk">
        <PageHead title="Tasks" lede="Send someone a task with a due day. It lands in their Zinwe app, and you see every update here." />
        <PlanLock module="team_chat">Send your team tasks from Chat or here, follow each one live, and give your OK when they finish.</PlanLock>
      </div>
    );
  }
  return <TasksContent />;
}

function TasksContent(): ReactElement {
  const loadMembers = useCallback((signal: AbortSignal) => listMembers(signal), []);
  const members = useResource(loadMembers);
  const membersReady = members.data !== undefined || members.error !== undefined;
  const people = useMemo(() => peopleOf(members.data), [members.data]);
  const tasks = useTasks();
  const all = useMemo(() => tasks.data ?? [], [tasks.data]);
  const todos = useMemberTodos();
  const allTodos = useMemo(() => todos.data ?? [], [todos.data]);

  const { hash, pathname } = useLocation();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [view, setView] = useState<"list" | "board">("list");
  const [who, setWho] = useState("all");
  const [q, setQ] = useState("");
  const [quick, setQuick] = useState<Quick | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [doneAll, setDoneAll] = useState(false);
  const [todoAll, setTodoAll] = useState(false);
  const [filterSheet, setFilterSheet] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [form, setForm] = useState<{ who: string | null; editing: TaskView | null } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const flashTimer = useRef<number | undefined>(undefined);

  const say = useCallback((text: string) => {
    window.clearTimeout(toastTimer.current);
    setToast({ text });
    toastTimer.current = window.setTimeout(() => setToast(null), 6000);
  }, []);
  useEffect(() => () => {
    window.clearTimeout(toastTimer.current);
    window.clearTimeout(flashTimer.current);
  }, []);

  // Deep links: #m=<first> filters to that person (and fills them in New task), #task=<id> (or ?task=<id>, from a
  // notification) opens it, #new=1 opens New task.
  const ready = tasks.data !== undefined && membersReady;
  const linkKey = `${hash}|${search.get("task") ?? ""}`;
  const [handledHash, setHandledHash] = useState<string | null>(null);
  if (ready && handledHash !== linkKey) {
    setHandledHash(linkKey);
    const h = new URLSearchParams(hash.slice(1));
    const person = findPerson(h.get("m"), people);
    if (person) setWho(person.key);
    const id = Number.parseInt(h.get("task") ?? search.get("task") ?? "", 10);
    if (id && all.some((t) => t.id === id)) setSel(id);
    else if (h.get("new") === "1") setForm({ who: person?.key ?? null, editing: null });
  }
  const clearHash = () => {
    if (hash || search.get("task")) navigate(pathname, { replace: true });
  };

  // Phone filter sheet: Esc closes it.
  useEffect(() => {
    if (!filterSheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFilterSheet(false);
    };
    document.addEventListener("keydown", onKey);
    window.setTimeout(() => document.getElementById("f-who")?.focus(), 40);
    return () => document.removeEventListener("keydown", onKey);
  }, [filterSheet]);

  const ql = q.trim().toLowerCase();
  const whoPerson = who === "all" ? null : (people.find((p) => p.key === who) ?? null);
  const ofWho = (t: TaskView) => !whoPerson || personOfTask(t, people).key === whoPerson.key;
  const shown = all.filter((t) => ofWho(t) && (!ql || t.title.toLowerCase().includes(ql)) && (!quick || QUICK[quick](t)));
  const todoOfWho = (t: MemberTodo) => !whoPerson || t.member_id === whoPerson.memberId;
  const todosShown = allTodos.filter((t) => todoOfWho(t) && (!ql || t.title.toLowerCase().includes(ql)) && (!quick || QUICK_TODO[quick](t)));
  const filtersOn = who !== "all" || !!ql || !!quick;
  const noMatch = ready && shown.length === 0 && filtersOn;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const tasksLabel = shown.length === all.length ? plural(all.length, "task", "tasks") : `${shown.length} of ${plural(all.length, "task", "tasks")}`;
  const todosLabel =
    allTodos.length === 0 ? "" : todosShown.length === allTodos.length ? plural(allTodos.length, "own to-do", "own to-dos") : `${todosShown.length} of ${plural(allTodos.length, "own to-do", "own to-dos")}`;
  const shownLabel = todosLabel ? `${tasksLabel} · ${todosLabel}` : tasksLabel;
  const filterCount = (who !== "all" ? 1 : 0) + (ql ? 1 : 0);
  const clearFilters = () => {
    setWho("all");
    setQ("");
    setQuick(null);
  };

  const openTask = (id: number, focus?: "reply" | "reopen") => {
    setSel(id);
    if (focus) window.setTimeout(() => document.getElementById(focus === "reply" ? "dw-reply" : "dw-reopen")?.focus(), 120);
  };
  const closeDrawer = () => {
    const id = sel;
    setSel(null);
    clearHash();
    if (id != null) window.setTimeout(() => document.getElementById(`open-${id}`)?.focus(), 40);
  };
  const openComposer = () => setForm({ who: whoPerson?.key ?? null, editing: null });

  const run = (p: Promise<unknown>, ok: string) => {
    p.then(
      () => say(ok),
      (err: unknown) => say(errorMessage(err)),
    );
  };
  const approve = (t: TaskView) => run(taskActions.approve(t), `Approved · ${personOfTask(t, people).first} sees this in their Zinwe app`);
  const nudge = (t: TaskView) => run(taskActions.nudge(t), `Nudged · ${personOfTask(t, people).first} gets a reminder in their Zinwe app`);
  const submit = async (v: TaskFormValues, editing: TaskView | null) => {
    const saved = await taskActions.submit(v, editing);
    setForm(null);
    clearHash();
    if (editing) {
      say(`Saved · ${v.person.first} sees an “Edited” tag`);
      return;
    }
    setQuick(null);
    setQ("");
    if (who !== "all" && who !== v.person.key) setWho("all");
    say(`Sent to ${v.person.first} · it’s in their chat and Zinwe app`);
    setFlash(saved.id);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 2400);
    window.setTimeout(() => document.getElementById(`open-${saved.id}`)?.focus(), 300);
  };

  // ---- one task, as a card / row ----
  const cardOf = (t: TaskView) => {
    const p = personOfTask(t, people);
    const doneN = t.steps.filter((x) => x.done).length;
    const n = t.steps.length;
    const isHelp = t.status === "help";
    const actions = !isClosed(t) ? (
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
        {isHelp ? (
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
    const steps = n ? (
      <span style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }} aria-label={`${doneN} of ${n} steps done`}>
        <span className="tk-bar">
          <span style={{ display: "block", height: "100%", borderRadius: 999, width: `${Math.round((doneN / n) * 100)}%`, background: doneN === n ? "#17663F" : "#F26A0A" }} />
        </span>
        <span className="z-num z-mono" style={{ fontSize: 11, color: "#404040" }}>
          {doneN}/{n}
        </span>
      </span>
    ) : null;
    return { t, p, isHelp, actions, steps, updated: lastLine(t, p.first, p.pcOn) };
  };

  // ---- board ----
  const cols = TASK_COLUMNS.map((col) => {
    const list = shown
      .filter((t) => (col.has as readonly string[]).includes(t.status))
      .sort((a, b) => {
        if (col.id === "progress" && (a.status === "help") !== (b.status === "help")) return a.status === "help" ? -1 : 1;
        const d = dueKey(a) < dueKey(b) ? -1 : dueKey(a) > dueKey(b) ? 1 : 0;
        return col.id === "done" ? -d : d;
      });
    const capped = col.id === "done" && list.length > 5;
    return { ...col, list, visible: capped && !doneAll ? list.slice(0, 5) : list, capped };
  });

  // ---- list ----
  const dir = sortDir === "asc" ? 1 : -1;
  const groupOf = (t: TaskView) => (LIST.find((g) => g.has(t)) ?? LIST[LIST.length - 1]).id;
  const groups = LIST.map((g) => {
    const d = g.id === "done" ? -dir : dir;
    const list = shown.filter((t) => groupOf(t) === g.id).sort((a, b) => (dueKey(a) < dueKey(b) ? -d : dueKey(a) > dueKey(b) ? d : 0));
    const capped = g.id === "done" && list.length > 5;
    return { ...g, list, rows: capped && !doneAll ? list.slice(0, 5) : list, capped };
  }).filter((g) => g.list.length > 0);

  // ---- their own to-dos, as the board's last column: open first, then the latest done ----
  const todoCol = sortTodos(todosShown);
  const todoOpenN = todoCol.filter((t) => t.status === "open").length;
  const todoCapped = todoCol.length - todoOpenN > TODO_DONE_SHOWN;
  const todoVisible = todoCapped && !todoAll ? todoCol.slice(0, todoOpenN + TODO_DONE_SHOWN) : todoCol;

  const selTask = sel != null ? (all.find((t) => t.id === sel) ?? null) : null;
  const openCount = all.filter(isOpenTask).length;

  const avatarCell = (p: TaskPerson) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
      <Avatar person={p} size={22} />
      {p.first}
    </span>
  );

  return (
    <div className="zp-tasks zk">
      <PageHead
        title="Tasks"
        lede="Every task you sent. What needs you comes first. Updates come live from their Zinwe app."
        actions={
          <>
            <Link className="z-btn sm" to={chatHrefOf(whoPerson)}>
              <ZIcon d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" size={15} stroke={2.2} />
              Open in Chat
            </Link>
            <button type="button" id="new-task" className="z-btn sm pri zn-desk-only" onClick={openComposer}>
              <ZIcon d="M12 5v14M5 12h14" size={15} stroke={2.6} />
              New task
            </button>
          </>
        }
      />

      {!ready && !tasks.error && !members.error ? (
        <>
          <div className="tk-quick" role="status" aria-busy="true">
            <span className="z-sr">Loading tasks</span>
            {QUICK_DEFS.map(([id]) => (
              <Sk key={id} w={150} h={36} style={{ borderRadius: 999 }} />
            ))}
          </div>
          <div className="tk-skel">
            <SkRows label="Loading tasks" rows={6} />
          </div>
        </>
      ) : tasks.error ? (
        <div className="z-card">
          <ErrorBlock message={errorMessage(tasks.error)} onRetry={tasks.reload} />
        </div>
      ) : (
        <>
          <section aria-label="Quick filters" className="tk-quick">
            {QUICK_DEFS.map(([id, label, fg, bg]) => {
              const n = all.filter(QUICK[id]).length + allTodos.filter(QUICK_TODO[id]).length;
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

          <div className="zk-m-only tk-mbar">
            <button type="button" className="z-btn sm" aria-haspopup="dialog" aria-expanded={filterSheet} onClick={() => setFilterSheet(true)}>
              <ZIcon d="M4 6h16M7 12h10M10 18h4" size={15} stroke={2.2} />
              Filters{filterCount ? ` · ${filterCount}` : ""}
            </button>
            <span className="z-num" style={{ fontSize: 12, color: "#6B6B6B" }}>
              {shownLabel}
            </span>
          </div>
          {filterSheet ? <button type="button" className="zk-m-only tk-fscrim" aria-label="Close filters" tabIndex={-1} onClick={() => setFilterSheet(false)} /> : null}
          <section aria-label="Filters" className={filterSheet ? "tk-filters open" : "tk-filters"} role={filterSheet ? "dialog" : undefined} aria-modal={filterSheet || undefined}>
            <div className="zk-m-only tk-fhead">
              <h2 style={{ margin: 0, fontSize: 17 }}>Filters</h2>
              <button type="button" className="z-btn sm dark" onClick={() => setFilterSheet(false)}>
                Done
              </button>
            </div>
            <label htmlFor="f-who" className="z-sr">
              Person
            </label>
            <select id="f-who" className="zk-sel" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="all">Everyone</option>
              {people.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="tk-search">
              <label htmlFor="f-q" className="z-sr">
                Search tasks
              </label>
              <SearchMark />
              <input id="f-q" type="search" className="zk-inp" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title" style={{ minHeight: 38, paddingLeft: 34, fontSize: 13 }} />
            </div>
            {filtersOn ? (
              <button type="button" className="z-btn xs" onClick={clearFilters}>
                Clear
              </button>
            ) : null}
            <span className="tk-fend">
              <span className="z-num" style={{ fontSize: 12, color: "#6B6B6B" }}>
                {shownLabel}
              </span>
              <div role="group" aria-label="View" className="z-segs" style={{ flexWrap: "nowrap" }}>
                <button type="button" className={view === "list" ? "z-seg on" : "z-seg"} aria-pressed={view === "list"} onClick={() => setView("list")}>
                  <ZIcon d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" size={14} stroke={2.2} />
                  List
                </button>
                <button type="button" className={view === "board" ? "z-seg on" : "z-seg"} aria-pressed={view === "board"} onClick={() => setView("board")}>
                  <BoardMark />
                  Board
                </button>
              </div>
            </span>
          </section>

          {noMatch && (view === "list" || todosShown.length === 0) ? (
            <div className="tk-nomatch">
              <b style={{ fontSize: 16 }}>{who !== "all" && !ql && !quick && whoPerson
                  ? `No tasks for ${whoPerson.first} yet.`
                  : todosShown.length > 0
                    ? "No assigned tasks match these filters. Their own to-dos that match are below."
                    : "No tasks match these filters."}</b>
              <button type="button" className="z-btn sm" onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          ) : all.length === 0 && (view === "list" || allTodos.length === 0) ? (
            <div className="z-card">
              <EmptyBlock
                icon="tasks"
                title="No tasks yet"
                action={
                  <button type="button" className="z-btn sm pri" onClick={openComposer}>
                    New task
                  </button>
                }
              >
                Send someone a task with a due day. It lands in their Zinwe app, and you see every update here.
              </EmptyBlock>
            </div>
          ) : view === "board" ? (
            <div role="region" aria-label="Task board" tabIndex={0} className="tk-board-wrap">
              <div className="tk-board">
                {cols.map((col) => (
                  <section key={col.id} aria-label={`${col.label}, ${col.list.length}${col.list.length === 1 ? " task" : " tasks"}`} className="tk-col">
                    <h2 className="tk-col-h">
                      <span aria-hidden="true" style={{ flex: "none", width: 9, height: 9, borderRadius: "50%", background: col.dot }} />
                      {col.label}
                      <span className="z-num tk-col-n">{col.list.length}</span>
                    </h2>
                    {col.visible.map((t) => {
                      const c = cardOf(t);
                      const flashOn = flash === t.id;
                      const hasTags = !!SUB[t.status] || c.isHelp || t.status === "approved" || t.status === "cancelled" || t.high || t.byMember;
                      return (
                        <article
                          key={t.id}
                          className="tk-card"
                          style={{
                            opacity: t.status === "cancelled" ? 0.62 : undefined,
                            borderColor: flashOn ? "#F26A0A" : undefined,
                            boxShadow: flashOn ? "0 0 0 3px #FDEBDC" : undefined,
                            borderLeft: c.isHelp ? "4px solid #A84505" : undefined,
                          }}
                        >
                          <button type="button" id={`open-${t.id}`} className="tk-cb" onClick={() => openTask(t.id)}>
                            {hasTags ? (
                              <span style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                                {SUB[t.status] ? (
                                  <span className="zk-pill" style={{ background: "#F5F5F5", color: "#404040" }}>
                                    {SUB[t.status]}
                                  </span>
                                ) : null}
                                {c.isHelp ? (
                                  <span className="zk-pill" style={{ background: "#FDEBDC", color: "#A84505" }}>
                                    Needs help
                                  </span>
                                ) : null}
                                {t.status === "approved" ? (
                                  <span className="zk-pill" style={{ background: "#17663F", color: "#fff" }}>
                                    Approved
                                  </span>
                                ) : null}
                                {t.status === "cancelled" ? (
                                  <span className="zk-pill" style={{ background: "#F5F5F5", color: "#6B6B6B" }}>
                                    Cancelled
                                  </span>
                                ) : null}
                                {t.high ? (
                                  <span className="zk-pill" style={{ background: "#FCE8E4", color: "#C0331C" }}>
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                      <path d="M5 21V4h11l-1.5 4L16 12H7v9z" />
                                    </svg>
                                    High
                                  </span>
                                ) : null}
                                {t.byMember ? (
                                  <span className="zk-pill" style={{ background: "#F5F5F5", color: "#6B6B6B" }}>
                                    Added by {c.p.first}
                                  </span>
                                ) : null}
                              </span>
                            ) : null}
                            <span className="tk-tt">{t.title}</span>
                            <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "#404040" }}>
                                <Avatar person={c.p} size={22} />
                                {c.p.first}
                              </span>
                              <span className="zk-pill" style={dueStyle(t)}>
                                {dueLabel(t)}
                              </span>
                            </span>
                            {c.steps}
                            <span className="tk-up">{c.updated}</span>
                          </button>
                          {c.actions ? <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 12px 11px" }}>{c.actions}</div> : null}
                        </article>
                      );
                    })}
                    {col.list.length === 0 ? <p className="tk-col-empty">{filtersOn ? "No matches here." : col.empty}</p> : null}
                    {col.capped ? (
                      <button type="button" className="z-btn xs" style={{ background: "transparent" }} aria-expanded={doneAll} onClick={() => setDoneAll(!doneAll)}>
                        {doneAll ? "Show less" : `Show ${col.list.length - 5} more`}
                      </button>
                    ) : null}
                  </section>
                ))}
                <section aria-label={`Their own to-dos, ${todoCol.length}${todoCol.length === 1 ? " to-do" : " to-dos"}`} className="tk-col">
                  <h2 className="tk-col-h">
                    <span aria-hidden="true" style={{ flex: "none", width: 9, height: 9, borderRadius: "50%", background: "#A3A3A3" }} />
                    Their own to-dos
                    <span className="z-num tk-col-n">{todoCol.length}</span>
                  </h2>
                  {todos.data === undefined ? (
                    todos.error ? (
                      <p className="tk-col-empty">We couldn’t load these. They’ll show when the page refreshes.</p>
                    ) : (
                      <span role="status" aria-busy="true">
                        <span className="z-sr">Loading to-dos</span>
                        <Sk w="100%" h={84} style={{ borderRadius: 12 }} />
                      </span>
                    )
                  ) : todoCol.length === 0 ? (
                    <p className="tk-col-empty">{filtersOn ? "No matches here." : "Nobody has added a to-do of their own yet."}</p>
                  ) : (
                    <ul className="ztd__cards tk-todo-cards">
                      {todoVisible.map((t) => (
                        <TodoCard key={t.id} t={t} first={whoPerson?.first ?? null} />
                      ))}
                    </ul>
                  )}
                  {todoCapped ? (
                    <button type="button" className="z-btn xs" style={{ background: "transparent" }} aria-expanded={todoAll} onClick={() => setTodoAll(!todoAll)}>
                      {todoAll ? "Show less" : `Show ${todoCol.length - todoVisible.length} more`}
                    </button>
                  ) : null}
                  {todoCol.length > 0 ? <p className="tk-col-note">Added in their Zinwe app. You can see these, not change them.</p> : null}
                </section>
              </div>
            </div>
          ) : (
            <div role="table" aria-label="Tasks: needs you, overdue, today, later and done" className="tk-list">
              <div className="tk-list-in">
                <div role="row" className="tk-trow tk-thd">
                  <span role="columnheader">Task</span>
                  <span role="columnheader">Person</span>
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
                      const c = cardOf(t);
                      return (
                        <div
                          role="row"
                          key={t.id}
                          className="tk-trow"
                          style={c.isHelp ? { boxShadow: "inset 4px 0 0 #A84505" } : flash === t.id ? { background: "#FFF6EF" } : undefined}
                        >
                          <span role="cell" style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                            <button type="button" id={`open-${t.id}`} className="tk-lk" onClick={() => openTask(t.id)}>
                              {t.title}
                            </button>
                            {t.high || t.byMember ? (
                              <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                {t.high ? (
                                  <span className="zk-pill" style={{ background: "#FCE8E4", color: "#C0331C" }}>
                                    High
                                  </span>
                                ) : null}
                                {t.byMember ? (
                                  <span className="zk-pill" style={{ background: "#F5F5F5", color: "#6B6B6B" }}>
                                    Added by {c.p.first}
                                  </span>
                                ) : null}
                              </span>
                            ) : null}
                          </span>
                          <span role="cell" className="tk-tc">
                            <span className="tk-mlab">Person</span>
                            {avatarCell(c.p)}
                          </span>
                          <span role="cell" className="tk-tc">
                            <span className="tk-mlab">Stage</span>
                            <span className="zk-pill" style={statusStyle(t.status)}>
                              {TASK_SHORT[t.status]}
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
                            {c.steps ?? <span style={{ color: "#6B6B6B" }}>—</span>}
                          </span>
                          <span role="cell" className="tk-tc tk-tw">
                            <span className="tk-mlab">Updated</span>
                            <span className="tk-up">{c.updated}</span>
                          </span>
                          <span role="cell" className="tk-ta">
                            {c.actions}
                          </span>
                        </div>
                      );
                    })}
                    {g.capped ? (
                      <div role="row" style={{ padding: "8px 16px", borderBottom: "1px solid #F5F5F5" }}>
                        <span role="cell">
                          <button type="button" className="z-btn xs" style={{ background: "transparent" }} aria-expanded={doneAll} onClick={() => setDoneAll(!doneAll)}>
                            {doneAll ? "Show less" : `Show ${g.list.length - 5} more`}
                          </button>
                        </span>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}
          {view === "list" ? (
            <TheirTodos
              className="ztd--page"
              cards
              todos={todos.data === undefined ? undefined : todosShown}
              failed={Boolean(todos.error)}
              first={whoPerson?.first ?? null}
              filtered={filtersOn}
            />
          ) : null}
          <span className="z-sr" aria-live="polite">
            {openCount} open tasks
          </span>
        </>
      )}

      <button type="button" className="tk-fab zk-m-only" aria-label="New task" onClick={openComposer}>
        <ZIcon d="M12 5v14M5 12h14" size={24} stroke={2.6} />
      </button>

      {selTask ? (
        <TaskDrawer
          key={selTask.id}
          task={selTask}
          person={personOfTask(selTask, people)}
          chatHref={chatHrefOf(personOfTask(selTask, people))}
          onClose={closeDrawer}
          onEdit={(t) => setForm({ who: personOfTask(t, people).key, editing: t })}
          say={say}
        />
      ) : null}

      {form ? (
        <TaskForm
          people={people}
          who={form.who}
          editing={form.editing}
          onClose={() => {
            setForm(null);
            if (!sel) clearHash();
          }}
          onSubmit={submit}
        />
      ) : null}

      <div role="status" aria-live="polite" className="zk-toast-wrap">
        {toast ? (
          <div className="zk-toast">
            <span>{toast.text}</span>
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
