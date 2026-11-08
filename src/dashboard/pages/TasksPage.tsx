import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useIsPhone } from "../../hooks/useIsPhone";
import { usePageMeta } from "../../hooks/usePageMeta";
import { errorMessage } from "../../lib/api";
import { PlanLock } from "../components/PlanLock";
import { useEntitlements } from "../features/entitlements";
import { PageHead } from "../shell/PageHead";
import { EmptyBlock, ErrorBlock, Sk, SkRows } from "../ui/States";
import { ZIcon } from "../ui/ZIcon";
import { dueOf, happen, isClosed, journey, LANES, laneOf, namesOf, pillOf, progressLabel, type Lane, type TTask } from "../tasks2/engine";
import { Avs, IcRepeat, IcSearch, type OpenOpts, type PanelCard, type PanelTab, type TaskPrefill } from "../tasks2/parts";
import { ChatCount, PrimaryButton, TaskCard } from "../tasks2/TaskCard";
import { QuickAdd } from "../tasks2/QuickAdd";
import { TaskPanel } from "../tasks2/TaskPanel";
import { useTeamTasks, type TeamTasks } from "../tasks2/useTeamTasks";
import { useToast } from "../tasks2/toast";
import "../tasks2/tasks2.css";

type Quick = "needs" | "late" | "today" | "open";
const QUICK: ReadonlyArray<[Quick, string, string]> = [
  ["needs", "Needs you", "help"],
  ["late", "Late", "over"],
  ["today", "Due today", "today"],
  ["open", "All open", ""],
];
type PhStatus = "all" | "needs" | "working" | "notseen" | "late" | "done";
const PH_STATUS: ReadonlyArray<[PhStatus, string]> = [
  ["all", "Status"],
  ["needs", "Needs you"],
  ["working", "In progress"],
  ["notseen", "Not started"],
  ["late", "Late"],
  ["done", "Done"],
];
const CARDS: readonly PanelCard[] = ["reply", "reopen", "reassign", "due", "cancel"];

/**
 * /app/tasks (v1.4, boards DashTasks + DashPhoneTasks): every task the owner sent, what needs you first.
 * Desktop: "+ New task", the quick-add line, quick filters (Needs you · Late · Due today · All open), person + search,
 * List (lanes Needs you · Late · Today · Later · Done; each row: what's happening, faces, journey, due, chat count,
 * one button) or Board (the same lanes as columns of cards). Phone: title + "New task" pill, search, chips All ·
 * Needs you · Role ▾ · Status ▾, lanes of cards; the panel is a bottom sheet.
 * Deep links: ?open=<id> (&chat=1 opens its chat, &act=reply|reassign|reopen|due opens that card), #new=1, and the
 * older #task=<id> / ?task=<id> / #m=<first>.
 */
export default function TasksPage(): ReactElement {
  usePageMeta({ title: "Tasks — Zinwe", description: "Every task you sent your team, and what needs you." });
  const { has } = useEntitlements();
  if (!has("team_chat")) {
    return (
      <div className="zp-tasks2 zk">
        <PageHead title="Tasks" lede="Send someone a task with a due day. It lands in their Zinwe app, and you see every update here." />
        <PlanLock module="team_chat">Send your team tasks from Chat or here, follow each one live, and give your OK when they finish.</PlanLock>
      </div>
    );
  }
  return <TasksContent />;
}

function byDue(a: TTask, b: TTask): number {
  return (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER);
}
const finishedAt = (t: TTask) => t.approvedAt ?? t.cancelledAt ?? t.updatedAt;

function TasksContent(): ReactElement {
  const phone = useIsPhone();
  const team = useTeamTasks();
  const { tasks, dir, now } = team;
  const { say, node: toast } = useToast();
  const [search, setSearch] = useSearchParams();
  const { hash, pathname } = useLocation();
  const navigate = useNavigate();

  const [view, setView] = useState<"list" | "board">("list");
  const [quick, setQuick] = useState<Quick | null>(null);
  const [who, setWho] = useState("all");
  const [q, setQ] = useState("");
  const [folded, setFolded] = useState<Partial<Record<Lane, boolean>>>({});
  const [role, setRole] = useState("all");
  const [phStatus, setPhStatus] = useState<PhStatus>("all");
  const [creating, setCreating] = useState<TaskPrefill | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);
  const flashIt = (id: number) => {
    window.clearTimeout(flashTimer.current);
    setFlash(id);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1600);
  };

  // ---- the open task lives in the URL: ?open=<id>&chat=1&act=reply ----
  const openId = Number.parseInt(search.get("open") ?? "", 10) || null;
  const tab: PanelTab = search.get("chat") === "1" ? "chat" : search.get("tab") === "activity" ? "activity" : "overview";
  const actParam = search.get("act");
  const card = (CARDS as readonly string[]).includes(actParam ?? "") ? (actParam as PanelCard) : null;
  const openTask = (id: number, opts: OpenOpts = {}) => {
    setCreating(null);
    const next = new URLSearchParams();
    next.set("open", String(id));
    if (opts.tab === "chat") next.set("chat", "1");
    if (opts.tab === "activity") next.set("tab", "activity");
    if (opts.card) next.set("act", opts.card);
    setSearch(next, { replace: openId != null });
  };
  const closePanel = () => {
    setCreating(null);
    if (search.has("open") || search.has("chat") || search.has("act") || search.has("tab")) setSearch(new URLSearchParams(), { replace: true });
  };
  const newTask = (prefill: TaskPrefill = {}) => {
    if (openId != null) setSearch(new URLSearchParams(), { replace: true });
    setCreating(prefill);
  };

  // Older links: #task=<id> or ?task=<id> (notifications), #new=1 (Overview, the phone + sheet), #m=<first>.
  const ready = tasks !== undefined;
  const legacy = `${hash}|${search.get("task") ?? ""}`;
  const [handled, setHandled] = useState<string | null>(null);
  if (ready && handled !== legacy) {
    setHandled(legacy);
    const h = new URLSearchParams(hash.slice(1));
    const m = h.get("m");
    const person = m ? dir.list.find((p) => p.first.toLowerCase() === m.toLowerCase() || String(p.memberId) === m) : undefined;
    if (person) setWho(person.key);
    const id = Number.parseInt(h.get("task") ?? search.get("task") ?? "", 10);
    if (id > 0) navigate(`${pathname}?open=${id}`, { replace: true });
    else if (h.get("new") === "1") {
      navigate(pathname, { replace: true });
      setCreating(person?.memberId != null ? { memberIds: [person.memberId] } : {});
    }
  }

  // ---- filters ----
  const all = tasks ?? [];
  const ql = q.trim().toLowerCase();
  const lane = (t: TTask) => laneOf(t, now);
  const match = (t: TTask) => {
    if (who !== "all" && !t.people.includes(who)) return false;
    if (ql && !t.title.toLowerCase().includes(ql) && !namesOf(dir, t.people).toLowerCase().includes(ql)) return false;
    if (quick === "open") return !isClosed(t);
    if (quick) return lane(t) === quick;
    return true;
  };
  const phMatch = (t: TTask) => {
    if (ql && !t.title.toLowerCase().includes(ql) && !namesOf(dir, t.people).toLowerCase().includes(ql)) return false;
    if (quick === "needs" && lane(t) !== "needs") return false;
    if (role !== "all" && !t.people.some((k) => dir.byKey[k]?.role === role)) return false;
    const l = lane(t);
    if (phStatus === "needs") return l === "needs";
    if (phStatus === "late") return l === "late";
    if (phStatus === "done") return l === "done";
    if (phStatus === "working") return t.status === "progress" && l !== "done";
    if (phStatus === "notseen") return t.status === "sent" || t.status === "seen";
    return true;
  };
  const shown = all.filter(phone ? phMatch : match);
  const lanes = LANES.map((L) => {
    const rows = shown
      .filter((t) => lane(t) === L.key)
      .sort((a, b) => (b.id === flash ? 1 : 0) - (a.id === flash ? 1 : 0) || (L.key === "done" ? finishedAt(b) - finishedAt(a) : byDue(a, b)));
    return { ...L, rows };
  });
  const filtersOn = who !== "all" || !!ql || !!quick || role !== "all" || phStatus !== "all";
  const clearFilters = () => {
    setWho("all");
    setQ("");
    setQuick(null);
    setRole("all");
    setPhStatus("all");
  };
  const roles = useMemo(() => [...new Set(dir.list.map((p) => p.role).filter(Boolean))].sort(), [dir]);
  const sentOk = (t: TTask) => {
    flashIt(t.id);
    setQuick(null);
  };

  const panel =
    creating !== null ? (
      <TaskPanel
        team={team}
        taskId={null}
        create={creating}
        onClose={closePanel}
        say={say}
        onOpen={(id) => {
          setCreating(null);
          flashIt(id);
          openTask(id);
        }}
      />
    ) : openId != null && team.byId(openId) ? (
      <TaskPanel team={team} taskId={openId} tab={tab} card={card} onClose={closePanel} onOpen={(id) => openTask(id)} say={say} />
    ) : null;

  const loading = !ready && !team.error;

  if (phone) {
    const allN = all.filter((t) => !isClosed(t)).length;
    const needsN = all.filter((t) => lane(t) === "needs").length;
    const phLanes = lanes.filter((g) => g.rows.length > 0 || (g.key === "needs" && role === "all" && phStatus === "all" && !ql));
    return (
      <div className="zp-tasks2 tv tv-phone">
        <div className="tv-phead">
          <h1 className="ph-h1">Tasks</h1>
          <button type="button" className="tv-padd2" onClick={() => newTask()}>
            <ZIcon d="M12 5v14M5 12h14" size={16} stroke={2.4} />
            New task
          </button>
        </div>
        <div className="tq-ph-top">
          <label className="tq-ph-search">
            <IcSearch size={18} />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" aria-label="Search tasks" />
          </label>
          <div className="tq-ph-chips" role="toolbar" aria-label="Show">
            <button type="button" className="tq-ph-chip" aria-pressed={!quick} onClick={() => setQuick(null)}>
              <span>All</span>
              <span className="tq-ph-n">{allN}</span>
            </button>
            <button type="button" className="tq-ph-chip" aria-pressed={quick === "needs"} onClick={() => setQuick(quick === "needs" ? null : "needs")}>
              <span aria-hidden="true" className="tq-ph-dot" style={{ background: "#F26A0A" }} />
              <span>Needs you</span>
              <span className="tq-ph-n">{needsN}</span>
            </button>
            <select className="tq-ph-chip tq-ph-sel" aria-label="Filter by role" data-on={role !== "all" ? "true" : "false"} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="all">Role</option>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <select className="tq-ph-chip tq-ph-sel" aria-label="Filter by status" data-on={phStatus !== "all" ? "true" : "false"} value={phStatus} onChange={(e) => setPhStatus(e.target.value as PhStatus)}>
              {PH_STATUS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {loading ? (
          <SkRows label="Loading tasks" rows={5} />
        ) : team.error && !ready ? (
          <ErrorBlock message={errorMessage(team.error)} onRetry={team.reload} />
        ) : all.length === 0 ? (
          <EmptyBlock icon="tasks" title="No tasks yet" action={<button type="button" className="z-btn sm pri" onClick={() => newTask()}>New task</button>}>
            Send someone a task with a due day. It lands in their Zinwe app, and you see every update here.
          </EmptyBlock>
        ) : phLanes.length === 0 ? (
          <p className="tq-ph-none">
            No tasks match.{" "}
            <button type="button" className="tv-link" onClick={clearFilters}>
              Clear filters
            </button>
          </p>
        ) : (
          phLanes.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <div className="tv-plane">
                <span className="tv-dot" style={{ background: g.dot }} />
                {g.label} <span className="n">{g.rows.length}</span>
                <span className="h">{g.hint}</span>
              </div>
              {g.rows.length ? (
                <div className="tv-plist">
                  {g.rows.map((t) => (
                    <TaskCard key={t.id} task={t} team={team} onOpen={openTask} flash={flash === t.id} say={say} />
                  ))}
                </div>
              ) : (
                <p className="tq-ph-none">Nothing needs you right now.</p>
              )}
            </section>
          ))
        )}
        {panel}
        {toast}
      </div>
    );
  }

  const count = shown.length === all.length ? `${all.length} ${all.length === 1 ? "task" : "tasks"}` : `${shown.length} of ${all.length} tasks`;
  return (
    <div className="zp-tasks2 tv">
      <PageHead
        title="Tasks"
        lede="Every task you sent. What needs you comes first. Updates come live from their Zinwe app."
        actions={
          <button type="button" id="new-task" className="z-btn sm pri zn-desk-only" onClick={() => newTask()}>
            <ZIcon d="M12 5v14M5 12h14" size={15} stroke={2.6} />
            New task
          </button>
        }
      />
      {team.sample ? (
        <p className="tv-sample" role="note">
          Sample tasks (Kitecrest Digital). The live task list shows here once the server has the new tasks.
        </p>
      ) : null}

      <QuickAdd team={team} say={say} onSent={sentOk} onOpenFull={(p) => newTask(p)} />

      {loading ? (
        <>
          <div className="zt-quick" role="status" aria-busy="true">
            <span className="z-sr">Loading tasks</span>
            {[0, 1, 2, 3].map((i) => (
              <Sk key={i} w={130} h={36} style={{ borderRadius: 999 }} />
            ))}
          </div>
          <div className="tv-table">
            <SkRows label="Loading tasks" rows={6} />
          </div>
        </>
      ) : team.error && !ready ? (
        <div className="z-card">
          <ErrorBlock message={errorMessage(team.error)} onRetry={team.reload} />
        </div>
      ) : (
        <>
          <section className="zt-quick" aria-label="Quick filters">
            {QUICK.map(([k, label, tone]) => {
              const n = all.filter((t) => (k === "open" ? !isClosed(t) : lane(t) === k)).length;
              return (
                <button key={k} type="button" className="zt-q" data-tone={tone} aria-pressed={quick === k} onClick={() => setQuick(quick === k ? null : k)}>
                  <b>{n}</b>
                  {label}
                </button>
              );
            })}
          </section>
          <section className="zt-bar" aria-label="Filters">
            <select className="zt-sel" aria-label="Person" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="all">Everyone</option>
              {dir.list.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </select>
            <label className="zt-search">
              <IcSearch />
              <input type="search" placeholder="Search by title" aria-label="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            {filtersOn ? (
              <button type="button" className="tv-link" onClick={clearFilters}>
                Clear
              </button>
            ) : null}
            <span className="zt-count">{count}</span>
            <div className="zt-views" role="group" aria-label="View">
              <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>
                <ZIcon d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" size={15} stroke={2} />
                List
              </button>
              <button type="button" aria-pressed={view === "board"} onClick={() => setView("board")}>
                <ZIcon d="M3 4h5v16H3zM10 4h5v11h-5zM17 4h4v7h-4z" size={15} stroke={2} />
                Board
              </button>
            </div>
          </section>

          {all.length === 0 ? (
            <div className="z-card">
              <EmptyBlock icon="tasks" title="No tasks yet" action={<button type="button" className="z-btn sm pri" onClick={() => newTask()}>New task</button>}>
                Send someone a task with a due day. It lands in their Zinwe app, and you see every update here.
              </EmptyBlock>
            </div>
          ) : shown.length === 0 ? (
            <div className="tv-nomatch">
              <b>No tasks match these filters.</b>
              <button type="button" className="tv-btn sm" onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          ) : view === "board" ? (
            <div className="tv-cols">
              {lanes.map((g) => (
                <section key={g.key} className="tv-col" aria-label={g.label}>
                  <div className="tv-colh">
                    <span className="tv-dot" style={{ background: g.dot }} />
                    {g.label}
                    <b>{g.rows.length}</b>
                  </div>
                  {g.rows.map((t) => (
                    <TaskCard key={t.id} task={t} team={team} onOpen={openTask} flash={flash === t.id} say={say} />
                  ))}
                </section>
              ))}
            </div>
          ) : (
            <div className="tv-table" aria-label="Tasks by what needs you">
              <div className="tv-grid tv-head">
                <span>Task · what’s happening</span>
                <span>People</span>
                <span>Where it is</span>
                <span>Due</span>
                <span className="r">Your move</span>
              </div>
              {lanes
                .filter((g) => g.rows.length > 0 || g.key === "needs")
                .map((g) => {
                  const open = !folded[g.key];
                  return (
                    <section key={g.key} className="tv-lane" aria-label={g.label}>
                      <button type="button" className="tv-lh" aria-expanded={open} onClick={() => setFolded((f) => ({ ...f, [g.key]: !f[g.key] }))}>
                        <span className="chev">
                          <ZIcon d="m6 9 6 6 6-6" size={14} stroke={2} />
                        </span>
                        <span className="tv-dot" style={{ background: g.dot }} />
                        {g.label} <span className="n">{g.rows.length}</span>
                        <span className="h">{g.hint}</span>
                      </button>
                      {open ? g.rows.map((t) => <Row key={t.id} t={t} team={team} sel={openId === t.id} flash={flash === t.id} onOpen={openTask} say={say} />) : null}
                      {g.rows.length === 0 ? <div className="tv-empty">Nothing needs you right now.</div> : null}
                    </section>
                  );
                })}
            </div>
          )}
        </>
      )}
      {panel}
      {toast}
    </div>
  );
}

function Row({ t, team, sel, flash, onOpen, say }: { t: TTask; team: TeamTasks; sel: boolean; flash: boolean; onOpen: (id: number, o?: OpenOpts) => void; say: (s: string, u?: () => void) => void }): ReactElement {
  const { dir, now } = team;
  const h = happen(t, dir, now);
  const due = dueOf(t, now);
  const names = t.people.length > 3 ? `${t.people.length} people` : namesOf(dir, t.people);
  return (
    <div
      className={`tv-row tv-grid${flash ? " tv-flash" : ""}`}
      data-sel={sel ? "true" : "false"}
      role="button"
      tabIndex={0}
      aria-label={`${t.title}. ${h.short || h.text}`}
      onClick={() => onOpen(t.id)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen(t.id);
        }
      }}
    >
      <span className="tv-t">
        <b>
          <span>{t.title}</span>
          {t.high ? <span className="tv-high">High</span> : null}
          {t.repeat ? (
            <span className="tv-rep" title={`Repeats every ${t.repeat}`}>
              <IcRepeat />
            </span>
          ) : null}
        </b>
        <span className="tv-say" data-tone={h.tone}>
          <span>{h.short || h.text}</span>
        </span>
      </span>
      <span className="tv-ppl">
        <Avs dir={dir} keys={t.people} />
        <span>{names}</span>
      </span>
      <span className="tv-mj">
        <span className="tv-mj__bar">
          {journey(t, dir, now).map((s, i) => (
            <i key={i} data-st={s.st} />
          ))}
        </span>
        <small>{progressLabel(t, dir, now)}</small>
      </span>
      <span>
        <span className="tv-due" data-kind={due.kind}>
          {due.short}
        </span>
      </span>
      <span className="tv-act">
        <ChatCount t={t} onOpen={onOpen} size={15} />
        <PrimaryButton t={t} team={team} onOpen={onOpen} say={say} />
      </span>
      <span className="tv-sr">{pillOf(t).label}</span>
    </div>
  );
}
