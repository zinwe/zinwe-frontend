import { useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from "react";
import { errorMessage } from "../../lib/api";
import { DueChip, GripMark, HighTag, PcAvatar, RowActions, StageChip, StepsBar, type RowHandlers } from "./DeskParts";
import { isFinished, LOGDOT, logText, noteByOf, personOfTask, whenOf, type TaskPerson } from "./model";
import { actionsOf, lastParts, nextStep, OWN_TAG, shortLine, type ListGroupId } from "./pageModel";
import type { DragOver } from "./useTaskDrag";
import type { TaskView } from "./types";

export type SortKey = "title" | "who" | "stage" | "due" | "progress";

export interface ListGroup {
  id: ListGroupId;
  label: string;
  hint: string;
  dot: string;
  /** Every task in the group (the count), and the rows shown (Done shows 5 until "Show more"). */
  list: TaskView[];
  rows: TaskView[];
  capped: boolean;
}

const HEADS: ReadonlyArray<[SortKey | "upd" | "act", string]> = [
  ["title", "Task"],
  ["who", "Person"],
  ["stage", "Stage"],
  ["due", "Due"],
  ["progress", "Progress"],
  ["upd", "Updated"],
  ["act", "Action"],
];

/**
 * The desktop list (LabDashTasks + DashTasks): folding groups, sortable headers, a grip to drag a row inside its group
 * (your order; arrow keys on the grip do the same), drag onto Done to approve or out of Done to reopen, rows that open
 * in place with their steps, note, latest update and the help reply.
 */
export function TaskTable({
  groups,
  people,
  on,
  flash,
  filtersOn,
  sort,
  manual,
  onSort,
  doneAll,
  onDoneAll,
  over,
  dragId,
  startDrag,
  stepOrder,
  sendReply,
  moveDue,
  say,
}: {
  groups: ListGroup[];
  people: readonly TaskPerson[];
  on: RowHandlers;
  flash: number | null;
  filtersOn: boolean;
  sort: { key: SortKey; dir: 1 | -1 };
  /** The list follows your order (headers show no arrow). */
  manual: boolean;
  onSort: (key: SortKey) => void;
  doneAll: boolean;
  onDoneAll: () => void;
  over: DragOver | null;
  dragId: number | null;
  startDrag: (id: number, e: ReactPointerEvent<HTMLElement>, el: HTMLElement | null) => void;
  /** Move a task one place up (-1) or down (+1) in its group. */
  stepOrder: (group: ListGroupId, id: number, by: -1 | 1) => void;
  sendReply: (t: TaskView, text: string) => Promise<unknown>;
  moveDue: (t: TaskView) => Promise<unknown>;
  say: (text: string) => void;
}): ReactElement {
  const [folded, setFolded] = useState<Partial<Record<ListGroupId, boolean>>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [replyFor, setReplyFor] = useState<number | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const toggleRow = (id: number, withReply = false) => {
    setExpanded((e) => ({ ...e, [id]: withReply ? true : !e[id] }));
    if (withReply) {
      setReplyFor(id);
      setReply("");
      window.setTimeout(() => document.getElementById(`rp-${id}`)?.focus(), 60);
    } else if (replyFor === id && expanded[id]) setReplyFor(null);
  };
  const handlers: RowHandlers = { ...on, reply: (t) => toggleRow(t.id, true) };
  const run = async (p: () => Promise<unknown>, ok: string, after?: () => void) => {
    if (busy) return;
    setBusy(true);
    try {
      await p();
      say(ok);
      after?.();
    } catch (err) {
      say(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const gripKey = (g: ListGroupId, id: number) => (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      stepOrder(g, id, e.key === "ArrowUp" ? -1 : 1);
    }
  };

  return (
    <div role="table" aria-label="Tasks: needs you, overdue, today, later and done" className="tq-table">
      <div className="tq-table-in">
        <div role="row" className="tq-grid tq-head">
          <span role="columnheader">
            <span className="z-sr">Order</span>
          </span>
          <span role="columnheader">
            <span className="z-sr">Details</span>
          </span>
          {HEADS.map(([key, label]) => {
            if (key === "upd" || key === "act") {
              return (
                <span key={key} role="columnheader" className={key === "act" ? "r" : undefined}>
                  {label}
                </span>
              );
            }
            const onKey = !manual && sort.key === key;
            return (
              <span key={key} role="columnheader" aria-sort={onKey ? (sort.dir > 0 ? "ascending" : "descending") : undefined}>
                <button type="button" data-on={onKey ? "true" : "false"} onClick={() => onSort(key)} title={onKey ? `Sorted by ${label.toLowerCase()}. Select to reverse` : `Sort by ${label.toLowerCase()}`}>
                  {label}
                  <span className="tq-arrow" aria-hidden="true">
                    {onKey ? (sort.dir > 0 ? "↑" : "↓") : ""}
                  </span>
                </button>
              </span>
            );
          })}
        </div>
        {groups.map((g) => {
          const isOpen = !folded[g.id];
          const o = over && over.lane === g.id ? over : null;
          const drop = o ? (o.v.kind === "move" ? "" : o.v.kind === "no" ? "no" : "ok") : "";
          return (
            <div role="rowgroup" key={g.id} className="tq-group" data-lane={g.id} data-drop={drop}>
              <div role="row" className="tq-gh-row">
                <span role="rowheader" style={{ display: "block", width: "100%" }}>
                  <button type="button" className="tq-gh" aria-expanded={isOpen} onClick={() => setFolded((f) => ({ ...f, [g.id]: !f[g.id] }))}>
                    <span className="tq-gchev" aria-hidden="true">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </span>
                    <span aria-hidden="true" className="tq-dot" style={{ background: g.dot }} />
                    {g.label} <span className="n z-num">{g.list.length}</span>
                    {g.hint ? <span className="h">{g.hint}</span> : null}
                    {o && o.v.kind !== "move" ? <span className="tq-gdrop" data-ok={o.v.kind === "no" ? "false" : "true"}>{o.v.kind === "approve" ? "Drop to approve" : o.v.kind === "reopen" ? "Drop to reopen" : "Can’t drop here"}</span> : null}
                  </button>
                </span>
              </div>
              {isOpen ? (
                <div className="tq-rows">
                  {g.rows.map((t) => {
                    const p = personOfTask(t, people);
                    const exp = !!expanded[t.id];
                    const sub = shortLine(t);
                    const [upd, updWhen] = lastParts(t, p.first, p.pcOn);
                    const next = nextStep(t);
                    const last = t.log[t.log.length - 1];
                    const replying = replyFor === t.id && t.status === "help";
                    return (
                      <div key={t.id} className="tq-rowwrap">
                        <div
                          role="row"
                          className={flash === t.id ? "tq-grid tq-row tq-flash" : "tq-grid tq-row"}
                          data-card={t.id}
                          data-stage={t.own ? "own" : t.status}
                          data-open={exp ? "true" : "false"}
                          data-dragging={dragId === t.id ? "true" : "false"}
                          data-drop={o && o.v.kind === "move" && o.before === t.id && dragId !== t.id ? "before" : undefined}
                        >
                          <span role="cell">
                            <span
                              role="button"
                              tabIndex={0}
                              className="tq-grip"
                              aria-label={`Drag to reorder ${t.title}, or use the arrow keys`}
                              title="Drag to change the order"
                              onPointerDown={(e) => startDrag(t.id, e, e.currentTarget.closest<HTMLElement>("[data-card]"))}
                              onKeyDown={gripKey(g.id, t.id)}
                            >
                              <GripMark />
                            </span>
                          </span>
                          <span role="cell">
                            <button
                              type="button"
                              className="tq-exp"
                              aria-expanded={exp}
                              aria-controls={`tqx-${t.id}`}
                              aria-label={`${exp ? "Hide" : "Show"} steps and details: ${t.title}`}
                              title={exp ? "Hide steps and details" : "Show steps and details"}
                              onClick={() => toggleRow(t.id)}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="m6 9 6 6 6-6" />
                              </svg>
                            </button>
                          </span>
                          <span role="cell" className="tq-title">
                            {t.own ? (
                              <span className="tq-tt" title={t.title} style={t.status === "approved" ? { color: "#6B6B6B" } : undefined}>
                                {t.title}
                              </span>
                            ) : (
                              <button type="button" id={`open-${t.id}`} className="tq-tt tq-tbtn" title={t.title} style={t.status === "cancelled" ? { color: "#6B6B6B" } : undefined} onClick={() => on.open(t)}>
                                {t.title}
                              </button>
                            )}
                            {t.own || t.high || t.byMember || sub ? (
                              <span className="tq-sub">
                                {t.high ? <HighTag /> : null}
                                {t.own ? (
                                  <span className="zk-pill" style={OWN_TAG}>
                                    Own to-do
                                  </span>
                                ) : null}
                                {t.byMember ? <span className="zk-pill" style={OWN_TAG}>Added by {p.first}</span> : null}
                                {sub ? <span className="tq-subt">{sub}</span> : null}
                              </span>
                            ) : null}
                          </span>
                          <span role="cell" className="tq-who">
                            <PcAvatar p={p} />
                            <span className="tq-who-t">
                              {p.first}
                              {p.presence ? <small>{p.presence}</small> : null}
                            </span>
                          </span>
                          <span role="cell">
                            <StageChip t={t} />
                          </span>
                          <span role="cell">
                            <DueChip t={t} short />
                          </span>
                          <span role="cell" className="tq-progcell">
                            {t.steps.length ? (
                              <>
                                <StepsBar t={t} />
                                <span className="tq-next" title={next}>
                                  {next}
                                </span>
                              </>
                            ) : (
                              <span className="tq-none">No steps</span>
                            )}
                          </span>
                          <span role="cell" className="tq-upd">
                            {upd}
                            <small title={updWhen}>{updWhen}</small>
                          </span>
                          <span role="cell" className="tq-acts">
                            <RowActions t={t} p={p} on={handlers} />
                          </span>
                        </div>
                        {exp ? (
                          <div role="row" id={`tqx-${t.id}`} className="tq-panel-row">
                            <span role="cell" className="tq-panel">
                              <span className="tq-pcol">
                                {t.details ? <p className="tq-det">{t.details}</p> : null}
                                {t.steps.length ? (
                                  <>
                                    <span className="zk-lbl">
                                      Checklist · {t.steps.filter((s) => s.done).length}/{t.steps.length}
                                    </span>
                                    <ul className="tq-check">
                                      {t.steps.map((s) => (
                                        <li key={s.id}>
                                          <span className={s.done ? "zk-box on" : "zk-box"} aria-hidden="true">
                                            {s.done ? "✓" : ""}
                                          </span>
                                          <span className={s.done ? "tq-sdone" : undefined}>{s.label}</span>
                                          <span className="z-sr">{s.done ? "done" : "not done yet"}</span>
                                        </li>
                                      ))}
                                    </ul>
                                    <span className="tq-hint">{p.first} ticks the steps in their Zinwe app.</span>
                                  </>
                                ) : (
                                  <span className="tq-hint">No checklist on this {t.own ? "to-do" : "task"}.</span>
                                )}
                              </span>
                              <span className="tq-pcol">
                                {t.own ? (
                                  <span className="tq-hint">Their own to-do, added in their Zinwe app. You see it here; they change it there.</span>
                                ) : (
                                  <>
                                    {t.note && !isFinished(t) ? (
                                      <p className="tq-note" data-help={t.status === "help" ? "true" : "false"}>
                                        <b>{noteByOf(t, p.first)}:</b> {t.note}
                                      </p>
                                    ) : null}
                                    {last ? (
                                      <>
                                        <span className="zk-lbl">Latest</span>
                                        <span className="tq-last">
                                          <span aria-hidden="true" className="tq-ldot" style={{ background: LOGDOT[last.k] ?? "#D4D4D4" }} />
                                          <span>
                                            {logText(last, p.first)}
                                            <small>{whenOf(last)}</small>
                                          </span>
                                        </span>
                                      </>
                                    ) : null}
                                    {replying ? (
                                      <span className="tq-reply">
                                        <label className="zk-lab" style={{ color: "#8A3A04" }} htmlFor={`rp-${t.id}`}>
                                          Reply to {p.first}
                                        </label>
                                        <textarea id={`rp-${t.id}`} rows={2} className="zk-inp" value={reply} maxLength={1000} onChange={(e) => setReply(e.target.value)} placeholder="Goes to their chat; the task goes back to In progress" style={{ resize: "vertical" }} />
                                        <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                          <button
                                            type="button"
                                            className="z-btn sm pri"
                                            disabled={!reply.trim() || busy}
                                            onClick={() =>
                                              void run(() => sendReply(t, reply), `Sent to ${p.first} · the task is back in progress`, () => {
                                                setReply("");
                                                setReplyFor(null);
                                              })
                                            }
                                          >
                                            Send reply
                                          </button>
                                          <button type="button" className="z-btn sm" disabled={busy} onClick={() => void run(() => moveDue(t), `Due moved to tomorrow · ${p.first} sees the new day`)}>
                                            Move due to tomorrow
                                          </button>
                                        </span>
                                      </span>
                                    ) : actionsOf(t).reply ? (
                                      <span>
                                        <button type="button" className="z-btn sm pri" onClick={() => toggleRow(t.id, true)}>
                                          Reply to {p.first}
                                        </button>
                                      </span>
                                    ) : null}
                                    <span>
                                      <button type="button" className="z-btn sm" onClick={() => on.open(t)}>
                                        Open task
                                      </button>
                                    </span>
                                  </>
                                )}
                              </span>
                            </span>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {o && o.v.kind === "move" && o.before === null ? <div className="tq-endline" aria-hidden="true" /> : null}
                  {g.list.length === 0 ? <div className="tq-empty">{filtersOn ? "No matches here." : "Nothing here."}</div> : null}
                  {g.capped ? (
                    <div role="row" className="tq-more">
                      <span role="cell">
                        <button type="button" className="z-btn xs" style={{ background: "transparent" }} aria-expanded={doneAll} onClick={onDoneAll}>
                          {doneAll ? "Show less" : `Show ${g.list.length - 5} more`}
                        </button>
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
