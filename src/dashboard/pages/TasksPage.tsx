import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useIsPhone } from "../../hooks/useIsPhone";
import { usePageMeta } from "../../hooks/usePageMeta";
import { errorMessage, listMembers } from "../../lib/api";
import { PlanLock } from "../components/PlanLock";
import { useEntitlements } from "../features/entitlements";
import { PageHead } from "../shell/PageHead";
import { EmptyBlock, ErrorBlock, Sk, SkRows } from "../ui/States";
import { ZIcon } from "../ui/ZIcon";
import { useResource } from "../useResource";
import { Ghost, type RowHandlers } from "../tasks/DeskParts";
import { BoardMark, SearchMark } from "../tasks/icons";
import { dueKey, findPerson, isDueToday, isOpenTask, isOverdue, peopleOf, personOfTask, type TaskPerson } from "../tasks/model";
import { BOARD_HINTS, boardLaneOf, boardVerdict, finishedAt, listGroupOf, listVerdict, type BoardLaneId, type ListGroupId, type Verdict } from "../tasks/pageModel";
import { PhoneTasks } from "../tasks/PhoneTasks";
import { TaskBoard, type BoardColumn } from "../tasks/TaskBoard";
import { TaskDrawer } from "../tasks/TaskDrawer";
import { TaskForm, type TaskFormValues } from "../tasks/TaskForm";
import { TaskTable, type ListGroup, type SortKey } from "../tasks/TaskTable";
import { useDeferredActions, UNDO_MS } from "../tasks/useDeferredActions";
import { todoView, useMemberTodos } from "../tasks/useMemberTodos";
import { useTaskDrag } from "../tasks/useTaskDrag";
import { useTaskOrder } from "../tasks/useTaskOrder";
import { taskActions, useTasks } from "../tasks/useTasks";
import { TASK_COLUMNS, type TaskView } from "../tasks/types";
import "../../styles/dash13/tasks.css";
import "../tasks/tasks-page.css";

type Quick = "ok" | "help" | "overdue" | "today" | "open";

const QUICK_DEFS: ReadonlyArray<[Quick, string, string]> = [
  ["ok", "Waiting for your OK", "ok"],
  ["help", "Needs help", "help"],
  ["overdue", "Overdue", "over"],
  ["today", "Due today", "today"],
  ["open", "All open", ""],
];
const QUICK: Record<Quick, (t: TaskView) => boolean> = {
  ok: (t) => t.status === "review",
  help: (t) => t.status === "help",
  overdue: (t) => isOverdue(t),
  today: (t) => isDueToday(t),
  open: (t) => isOpenTask(t),
};

/** List groups (LabDashTasks): each task sits in the first group it fits (pageModel.listGroupOf). */
const LIST: ReadonlyArray<{ id: ListGroupId; label: string; hint: string; dot: string }> = [
  { id: "needs", label: "Needs you", hint: "Waiting for your OK, or asking for help", dot: "#C0331C" },
  { id: "overdue", label: "Overdue", hint: "Past the due time", dot: "#A84505" },
  { id: "today", label: "Today", hint: "Due later today", dot: "#F26A0A" },
  { id: "later", label: "Later", hint: "Due tomorrow or after", dot: "#6B6B6B" },
  { id: "done", label: "Done", hint: "Approved by you", dot: "#17663F" },
];

const STAGE_ORDER: readonly TaskView["status"][] = ["help", "review", "progress", "accepted", "seen", "sent", "approved", "cancelled"];
const byDue = (a: TaskView, b: TaskView) => (dueKey(a) < dueKey(b) ? -1 : dueKey(a) > dueKey(b) ? 1 : 0);
/** Done: latest finished first, whatever the due date. */
const byFinished = (a: TaskView, b: TaskView) => finishedAt(b) - finishedAt(a);
const ratio = (t: TaskView) => (t.steps.length ? t.steps.filter((s) => s.done).length / t.steps.length : -1);

interface Toast {
  text: string;
  undo?: () => void;
  /** "no": a refused move (grey). */
  tone?: "no";
}

const chatHrefOf = (p: TaskPerson | null) => (p && p.memberId !== null ? `/app/chat/${p.key}` : "/app/chat");

/**
 * /app/tasks: every task the owner sent, what needs you first. Desktop (LabDashTasks + DashTasks): quick filters,
 * person + search, List (folding groups, sortable headers, rows that open in place) or Board (steps on each card), and
 * drag and drop: inside a group or column = your order (kept in this browser), Waiting for your OK onto Done =
 * approve, Done back to In progress = reopen, both with Undo. Phone (LabPhoneChatTasks, page="Tasks"): search, status
 * chips with Role and Member, grouped rows that open in place. Both: the task drawer (#task=<id> or ?task=<id>, the
 * notification link), New task (#new=1), and the to-dos people added for themselves, read-only, with an "Own to-do"
 * tag. FR-20 v2 tasks API; plan module team_chat (like Chat).
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
  const phone = useIsPhone();
  const loadMembers = useCallback((signal: AbortSignal) => listMembers(signal), []);
  const members = useResource(loadMembers);
  const membersReady = members.data !== undefined || members.error !== undefined;
  const people = useMemo(() => peopleOf(members.data), [members.data]);
  const tasks = useTasks();
  const todos = useMemberTodos();

  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const say = useCallback((text: string, more?: Omit<Toast, "text">) => {
    window.clearTimeout(toastTimer.current);
    setToast({ text, ...more });
    toastTimer.current = window.setTimeout(() => setToast(null), more?.undo ? UNDO_MS : 6000);
  }, []);
  const deferred = useDeferredActions(tasks.data, say);
  const { overlay } = deferred;

  // Assigned tasks and members' own to-dos, together: same groups, counts, filters and sorting. A change waiting for
  // its Undo to run out shows its new stage already.
  const all = useMemo(() => [...(tasks.data ?? []).map(overlay), ...(todos.data ?? []).map(todoView)], [tasks.data, todos.data, overlay]);

  const { hash, pathname } = useLocation();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [view, setView] = useState<"list" | "board">("list");
  const [who, setWho] = useState("all");
  const [q, setQ] = useState("");
  const [quick, setQuick] = useState<Quick | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "due", dir: 1 });
  const [doneAll, setDoneAll] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [form, setForm] = useState<{ who: string | null; editing: TaskView | null } | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);
  const order = useTaskOrder();

  useEffect(
    () => () => {
      window.clearTimeout(toastTimer.current);
      window.clearTimeout(flashTimer.current);
    },
    [],
  );
  const flashIt = (id: number, ms = 1400) => {
    window.clearTimeout(flashTimer.current);
    setFlash(id);
    flashTimer.current = window.setTimeout(() => setFlash(null), ms);
  };

  // Deep links: #m=<first> filters to that person (and fills them in New task), #task=<id> (or ?task=<id>, from a
  // notification) opens it, #new=1 opens New task.
  const todosReady = todos.data !== undefined || todos.error !== undefined;
  const ready = tasks.data !== undefined && membersReady && todosReady;
  const linkKey = `${hash}|${search.get("task") ?? ""}`;
  const [handledHash, setHandledHash] = useState<string | null>(null);
  if (ready && handledHash !== linkKey) {
    setHandledHash(linkKey);
    const h = new URLSearchParams(hash.slice(1));
    const person = findPerson(h.get("m"), people);
    if (person) setWho(person.key);
    const id = Number.parseInt(h.get("task") ?? search.get("task") ?? "", 10);
    if (id > 0 && all.some((t) => t.id === id && !t.own)) setSel(id);
    else if (h.get("new") === "1") setForm({ who: person?.key ?? null, editing: null });
  }
  const clearHash = () => {
    if (hash || search.get("task")) navigate(pathname, { replace: true });
  };

  const ql = q.trim().toLowerCase();
  const whoPerson = who === "all" ? null : (people.find((p) => p.key === who) ?? null);
  const ofWho = (t: TaskView) => !whoPerson || personOfTask(t, people).key === whoPerson.key;
  const shown = all.filter((t) => ofWho(t) && (!ql || t.title.toLowerCase().includes(ql)) && (!quick || QUICK[quick](t)));
  const filtersOn = who !== "all" || !!ql || !!quick;
  const noMatch = ready && shown.length === 0 && filtersOn;
  const shownLabel = shown.length === all.length ? `${all.length} tasks` : `${shown.length} of ${all.length} tasks`;
  const clearFilters = () => {
    setWho("all");
    setQ("");
    setQuick(null);
  };

  const openTask = (id: number, focus?: "reply" | "reopen") => {
    // A change still waiting on its Undo goes out first, so the drawer acts on the task as it really is.
    deferred.flush();
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

  // ---- actions: Approve and Reopen wait for their Undo; Nudge goes at once (as before) ----
  const firstOf = (t: TaskView) => personOfTask(t, people).first;
  const approve = (t: TaskView) => {
    deferred.defer(t, "approved", () => taskActions.approve(t));
    say(`Approved “${t.title}”. ${firstOf(t)} sees it in their Zinwe app.`, { undo: () => deferred.undo(t.id) });
    flashIt(t.id);
  };
  const reopen = (t: TaskView) => {
    deferred.defer(t, "progress", () => taskActions.reopen(t, ""));
    say(`Reopened “${t.title}”. ${firstOf(t)} gets it back in their Zinwe app.`, { undo: () => deferred.undo(t.id) });
    flashIt(t.id);
  };
  const nudge = (t: TaskView) =>
    taskActions.nudge(t).then(
      () => say(`Nudged ${firstOf(t)}. Zinwe reminds them about “${t.title}” on their PC.`),
      (err: unknown) => say(errorMessage(err)),
    );
  const on: RowHandlers = { approve, reopen, nudge: (t) => void nudge(t), reply: (t) => openTask(t.id, "reply"), open: (t) => openTask(t.id) };

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
    flashIt(saved.id, 2400);
    window.setTimeout(() => document.getElementById(`open-${saved.id}`)?.focus(), 300);
  };

  // ---- list groups ----
  const sorter = (a: TaskView, b: TaskView): number => {
    const d = sort.dir;
    switch (sort.key) {
      case "title":
        return d * a.title.localeCompare(b.title);
      case "who":
        return d * personOfTask(a, people).name.localeCompare(personOfTask(b, people).name) || byDue(a, b);
      case "stage":
        return d * (STAGE_ORDER.indexOf(a.status) - STAGE_ORDER.indexOf(b.status)) || byDue(a, b);
      case "progress":
        return d * (ratio(a) - ratio(b)) || byDue(a, b);
      default:
        return d * byDue(a, b);
    }
  };
  const groups: ListGroup[] = LIST.map((g) => {
    const mine = shown.filter((t) => listGroupOf(t) === g.id);
    const sorted = mine.sort(g.id === "done" && sort.key === "due" ? byFinished : sorter);
    const list = order.listManual ? order.sortByOrder(sorted) : sorted;
    const capped = g.id === "done" && list.length > 5;
    return { ...g, list, rows: capped && !doneAll ? list.slice(0, 5) : list, capped };
  });

  // ---- board columns ----
  const cols: BoardColumn[] = TASK_COLUMNS.map((col) => {
    const sorted = shown
      .filter((t) => boardLaneOf(t) === col.id)
      .sort((a, b) => {
        if (col.id === "done") return byFinished(a, b);
        if (col.id === "progress" && (a.status === "help") !== (b.status === "help")) return a.status === "help" ? -1 : 1;
        return byDue(a, b);
      });
    const list = order.sortByOrder(sorted);
    const capped = col.id === "done" && list.length > 5;
    return { id: col.id, label: col.label, dot: col.dot, hint: BOARD_HINTS[col.id] ?? "", empty: col.empty, list, visible: capped && !doneAll ? list.slice(0, 5) : list, capped };
  });

  // ---- drag and drop ----
  const laneIds = (lane: string): number[] =>
    view === "board" ? (cols.find((c) => c.id === lane)?.list ?? []).map((t) => t.id) : (groups.find((g) => g.id === lane)?.list ?? []).map((t) => t.id);
  const verdictOf = (id: number, lane: string): Verdict => {
    const t = all.find((x) => x.id === id);
    if (!t) return { kind: "no", why: "That task has changed. Try again." };
    const f = firstOf(t);
    return view === "board" ? boardVerdict(t, lane as BoardLaneId, f) : listVerdict(t, lane as ListGroupId, f);
  };
  const placeIn = (lane: string, id: number, before: number | null) => {
    const wasManual = order.listManual;
    order.place(laneIds(lane), id, before, view === "list" ? true : undefined);
    flashIt(id);
    const t = all.find((x) => x.id === id);
    if (view === "list" && !wasManual && t) say(`Moved “${t.title}”. The list now keeps your order.`);
  };
  const act = (id: number, lane: string, before: number | null, v: Verdict) => {
    const t = all.find((x) => x.id === id);
    if (!t) return;
    if (v.kind === "move") placeIn(lane, id, before);
    else if (v.kind === "approve") approve(t);
    else if (v.kind === "reopen") reopen(t);
    else say(v.why, { tone: "no" });
  };
  const drag = useTaskDrag({ verdictOf, onDrop: act, onRefuse: (why) => say(why, { tone: "no" }), ghostWidth: view === "list" ? 340 : undefined });
  const stepOrder = (lane: string, id: number, by: -1 | 1) => {
    const ids = laneIds(lane);
    const i = ids.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= ids.length) return;
    placeIn(lane, id, by < 0 ? ids[j] : (ids[j + 1] ?? null));
  };
  const onSort = (key: SortKey) => {
    if (order.listManual) {
      order.setListManual(false);
      setSort({ key, dir: 1 });
    } else setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : 1 }));
  };

  const selTask = sel != null ? (all.find((t) => t.id === sel) ?? null) : null;
  const openCount = all.filter(isOpenTask).length;
  const ghostTask = drag.ghost ? all.find((t) => t.id === drag.ghost?.id) : undefined;

  return (
    <div className="zp-tasks zk">
      <PageHead
        title="Tasks"
        lede="Every task you sent. What needs you comes first. Updates come live from their Zinwe app."
        actions={
          <>
            <Link className="z-btn sm zn-desk-only" to={chatHrefOf(whoPerson)}>
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
          <div className="tq-quick" role="status" aria-busy="true">
            <span className="z-sr">Loading tasks</span>
            {(phone ? [0, 1, 2, 3] : [0, 1, 2, 3, 4]).map((i) => (
              <Sk key={i} w={phone ? 84 : 150} h={phone ? 32 : 36} style={{ borderRadius: 999 }} />
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
          {todos.error ? (
            <div className="tk-todo-err" role="alert">
              <span>Couldn’t load your team’s own to-dos.</span>
              <button type="button" className="z-btn xs" onClick={todos.reload}>
                Retry
              </button>
            </div>
          ) : null}

          {phone ? (
            <PhoneTasks
              tasks={all}
              people={people}
              member={whoPerson?.memberId ?? null}
              onMember={(id) => setWho(id == null ? "all" : (people.find((p) => p.memberId === id)?.key ?? "all"))}
              onApprove={approve}
              onReopen={reopen}
              onNudge={(t) => void nudge(t)}
              onReply={(t) => navigate(chatHrefOf(personOfTask(t, people)))}
              onOpen={(t) => openTask(t.id)}
            />
          ) : (
            <>
              <section aria-label="Quick filters" className="tq-quick">
                {QUICK_DEFS.map(([id, label, tone]) => {
                  const n = all.filter(QUICK[id]).length;
                  const pressed = quick === id;
                  return (
                    <button key={id} type="button" className="tq-q" data-tone={n ? tone : ""} aria-pressed={pressed} onClick={() => setQuick(pressed ? null : id)}>
                      <b className="z-num">{n}</b>
                      {label}
                    </button>
                  );
                })}
              </section>

              <section aria-label="Filters" className="tk-filters">
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
                  {order.listManual && view === "list" ? (
                    <span className="tq-order">
                      In your order ·{" "}
                      <button type="button" onClick={() => onSort("due")}>
                        Sort by due
                      </button>
                    </span>
                  ) : null}
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

              {noMatch ? (
                <div className="tk-nomatch">
                  <b style={{ fontSize: 16 }}>{who !== "all" && !ql && !quick && whoPerson ? `No tasks for ${whoPerson.first} yet.` : "No tasks match these filters."}</b>
                  <button type="button" className="z-btn sm" onClick={clearFilters}>
                    Clear filters
                  </button>
                </div>
              ) : all.length === 0 ? (
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
                <TaskBoard
                  cols={cols}
                  people={people}
                  on={on}
                  flash={flash}
                  filtersOn={filtersOn}
                  doneAll={doneAll}
                  onDoneAll={() => setDoneAll(!doneAll)}
                  over={drag.over}
                  dragId={drag.ghost && !drag.ghost.back ? drag.ghost.id : null}
                  startDrag={drag.start}
                  wasDrag={drag.wasDrag}
                  moveTo={(t, lane) => act(t.id, lane, null, verdictOf(t.id, lane))}
                  stepOrder={stepOrder}
                />
              ) : (
                <TaskTable
                  groups={groups}
                  people={people}
                  on={on}
                  flash={flash}
                  filtersOn={filtersOn}
                  sort={sort}
                  manual={order.listManual}
                  onSort={onSort}
                  doneAll={doneAll}
                  onDoneAll={() => setDoneAll(!doneAll)}
                  over={drag.over}
                  dragId={drag.ghost && !drag.ghost.back ? drag.ghost.id : null}
                  startDrag={drag.start}
                  stepOrder={stepOrder}
                  sendReply={(t, text) => taskActions.reply(t, text)}
                  moveDue={(t) => taskActions.moveDue(t)}
                  say={say}
                />
              )}
              {drag.ghost && ghostTask ? <Ghost ghost={drag.ghost} t={ghostTask} p={personOfTask(ghostTask, people)} /> : null}
            </>
          )}
          <span className="z-sr" aria-live="polite">
            {openCount} open tasks
          </span>
        </>
      )}

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
          <div className={toast.tone === "no" ? "zk-toast tq-toast-no" : "zk-toast"}>
            <span>{toast.text}</span>
            {toast.undo ? (
              <button
                type="button"
                className="zk-toast__undo"
                onClick={() => {
                  toast.undo?.();
                  window.clearTimeout(toastTimer.current);
                  setToast(null);
                }}
              >
                Undo
              </button>
            ) : null}
            <button
              type="button"
              className="zk-toast__x"
              aria-label="Dismiss"
              onClick={() => {
                window.clearTimeout(toastTimer.current);
                setToast(null);
                if (toast.undo) deferred.flush();
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
