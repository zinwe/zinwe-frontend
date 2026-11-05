import { useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from "react";
import { DueChip, HighTag, PcAvatar, RowActions, StageChip, StepsBar, type RowHandlers } from "./DeskParts";
import { personOfTask, type TaskPerson } from "./model";
import { boardVerdict, lastParts, OWN_TAG, type BoardLaneId } from "./pageModel";
import type { DragOver } from "./useTaskDrag";
import { TASK_COLUMNS, type TaskView } from "./types";

export interface BoardColumn {
  id: BoardLaneId;
  label: string;
  dot: string;
  hint: string;
  empty: string;
  list: TaskView[];
  visible: TaskView[];
  capped: boolean;
}

const LANE_LABEL = Object.fromEntries(TASK_COLUMNS.map((c) => [c.id, c.label])) as Record<BoardLaneId, string>;

/**
 * The desktop board (LabDashTasks): drag a card inside its column to set your order, Waiting for your OK onto Done to
 * approve, a Done card back to In progress to reopen; other moves are refused with the reason. Each card shows its
 * first steps; "Move to…" does the same without a mouse.
 */
export function TaskBoard({
  cols,
  people,
  on,
  flash,
  filtersOn,
  doneAll,
  onDoneAll,
  over,
  dragId,
  startDrag,
  wasDrag,
  moveTo,
  stepOrder,
}: {
  cols: BoardColumn[];
  people: readonly TaskPerson[];
  on: RowHandlers;
  flash: number | null;
  filtersOn: boolean;
  doneAll: boolean;
  onDoneAll: () => void;
  over: DragOver | null;
  dragId: number | null;
  startDrag: (id: number, e: ReactPointerEvent<HTMLElement>, el: HTMLElement | null) => void;
  wasDrag: () => boolean;
  /** "Move to…": what dropping it on that column would do. */
  moveTo: (t: TaskView, lane: BoardLaneId) => void;
  stepOrder: (lane: BoardLaneId, id: number, by: -1 | 1) => void;
}): ReactElement {
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [menuAt, setMenuAt] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const MENU_W = 218;
  const MENU_H = 360;
  const openMenu = (id: number, btn: HTMLElement) => {
    if (menuFor === id) {
      setMenuFor(null);
      return;
    }
    const r = btn.getBoundingClientRect();
    const below = r.bottom + 6 + MENU_H <= window.innerHeight;
    setMenuAt({ top: below ? r.bottom + 6 : Math.max(8, r.top - 6 - MENU_H), left: Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8)) });
    setMenuFor(id);
  };

  // The Move to… menu closes on Esc or a click anywhere else.
  useEffect(() => {
    if (menuFor == null) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key !== "Escape") return;
        e.preventDefault();
        document.getElementById(`mv-${menuFor}`)?.focus();
      } else if ((e.target as HTMLElement | null)?.closest?.(`[data-menu="${menuFor}"]`)) return;
      setMenuFor(null);
    };
    const away = (e: Event) => {
      if (e.target instanceof Element && e.target.closest(".tq-menu")) return;
      setMenuFor(null);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    window.addEventListener("scroll", away, true);
    window.addEventListener("resize", away);
    const id = window.setTimeout(() => document.querySelector<HTMLElement>(`[data-menu="${menuFor}"] [role=menuitem]`)?.focus(), 30);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", away);
      window.clearTimeout(id);
    };
  }, [menuFor]);

  return (
    <div role="region" aria-label="Task board" tabIndex={0} className="tq-board-wrap">
      <div className="tq-board">
        {cols.map((col) => {
          const o = over && over.lane === col.id ? over : null;
          const drop = o ? (o.v.kind === "move" ? "" : o.v.kind === "no" ? "no" : "ok") : "";
          return (
            <section key={col.id} aria-label={`${col.label}, ${col.list.length}${col.list.length === 1 ? " task" : " tasks"}`} className="tq-col" data-lane={col.id} data-drop={drop}>
              <h2 className="tq-col-h">
                <span aria-hidden="true" className="tq-dot" style={{ background: col.dot }} />
                {col.label}
                <b className="z-num">{col.list.length}</b>
              </h2>
              {col.hint ? <p className="tq-col-hint">{col.hint}</p> : null}
              {col.visible.map((t, i) => {
                const p = personOfTask(t, people);
                const [upd, updWhen] = lastParts(t, p.first, p.pcOn);
                const preview = t.steps.slice(0, 3);
                const cls = ["tq-card"];
                if (flash === t.id) cls.push("tq-flash");
                return (
                  <article
                    key={t.id}
                    className={cls.join(" ")}
                    data-card={t.id}
                    data-stage={t.own ? "own" : t.status}
                    data-dragging={dragId === t.id ? "true" : "false"}
                    data-drop={o && o.v.kind === "move" && o.before === t.id && dragId !== t.id ? "before" : undefined}
                    aria-roledescription="Draggable task"
                    aria-label={`${t.title}, ${t.own ? "own to-do" : col.label}, ${p.first}`}
                    onPointerDown={(e) => startDrag(t.id, e, e.currentTarget)}
                  >
                    <span className="tq-row-tags">
                      <StageChip t={t} />
                      {t.own ? (
                        <span className="zk-pill" style={OWN_TAG}>
                          Own to-do
                        </span>
                      ) : null}
                      {t.high ? <HighTag /> : null}
                      <span className="tq-cgrip" aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="9" cy="6" r="1.6" />
                          <circle cx="15" cy="6" r="1.6" />
                          <circle cx="9" cy="12" r="1.6" />
                          <circle cx="15" cy="12" r="1.6" />
                          <circle cx="9" cy="18" r="1.6" />
                          <circle cx="15" cy="18" r="1.6" />
                        </svg>
                      </span>
                    </span>
                    {t.own ? (
                      <span className="tq-ctitle" style={t.status === "approved" ? { color: "#6B6B6B" } : undefined}>
                        {t.title}
                      </span>
                    ) : (
                      <button
                        type="button"
                        id={`open-${t.id}`}
                        className="tq-ctitle tq-tbtn"
                        style={t.status === "cancelled" ? { color: "#6B6B6B" } : undefined}
                        onClick={() => {
                          if (!wasDrag()) on.open(t);
                        }}
                      >
                        {t.title}
                      </button>
                    )}
                    <span className="tq-meta">
                      <span className="tq-who">
                        <PcAvatar p={p} size={22} />
                        <span>{p.first}</span>
                      </span>
                      <DueChip t={t} />
                    </span>
                    {t.steps.length ? (
                      <>
                        <StepsBar t={t} />
                        <ul className="tq-psteps">
                          {preview.map((s) => (
                            <li key={s.id}>
                              <span className={s.done ? "zk-box on" : "zk-box"} aria-hidden="true">
                                {s.done ? "✓" : ""}
                              </span>
                              <span className={s.done ? "tq-sdone" : undefined}>{s.label}</span>
                              <span className="z-sr">{s.done ? ", done" : ", not done yet"}</span>
                            </li>
                          ))}
                          {t.steps.length > 3 ? <li className="tq-pmore">+{t.steps.length - 3} more</li> : null}
                        </ul>
                      </>
                    ) : null}
                    <span className="tq-cupd">{[upd, updWhen].filter(Boolean).join(" · ")}</span>
                    <span className="tq-cfoot">
                      <span className="tq-cacts" data-nodrag="1">
                        <RowActions t={t} p={p} on={on} />
                      </span>
                      <span className="tq-mwrap" data-nodrag="1" data-menu={t.id}>
                        <button
                          type="button"
                          id={`mv-${t.id}`}
                          className="tq-movebtn"
                          aria-haspopup="menu"
                          aria-expanded={menuFor === t.id}
                          aria-label={`Move ${t.title}`}
                          title="Move to…"
                          onClick={(e) => openMenu(t.id, e.currentTarget)}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M5 12h14M13 6l6 6-6 6" />
                          </svg>
                        </button>
                        {menuFor === t.id ? (
                          <span className="tq-menu" role="menu" aria-label={`Move ${t.title}`} style={{ top: menuAt.top, left: menuAt.left, width: MENU_W }}>
                            <span className="tq-mh">Your order</span>
                            <button type="button" role="menuitem" className="tq-mi" disabled={i === 0} onClick={() => stepOrder(col.id, t.id, -1)}>
                              Up in {col.label}
                            </button>
                            <button type="button" role="menuitem" className="tq-mi" disabled={i === col.visible.length - 1} onClick={() => stepOrder(col.id, t.id, 1)}>
                              Down in {col.label}
                            </button>
                            <span className="tq-mh">Move to</span>
                            {cols
                              .filter((c) => c.id !== col.id)
                              .map((c) => {
                                const v = boardVerdict(t, c.id, p.first);
                                const ok = v.kind === "approve" || v.kind === "reopen";
                                return (
                                  <button
                                    key={c.id}
                                    type="button"
                                    role="menuitem"
                                    className="tq-mi"
                                    data-ok={ok ? "true" : "false"}
                                    onClick={() => {
                                      setMenuFor(null);
                                      moveTo(t, c.id);
                                    }}
                                  >
                                    {LANE_LABEL[c.id]}
                                    <small>{v.kind === "approve" ? "Approves it" : v.kind === "reopen" ? "Reopens it" : "Not yours to move"}</small>
                                  </button>
                                );
                              })}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </article>
                );
              })}
              {o && o.v.kind === "move" && o.before === null ? <div className="tq-endline" aria-hidden="true" /> : null}
              {o && o.v.kind !== "move" ? (
                <div className="tq-droptxt" data-ok={o.v.kind === "no" ? "false" : "true"}>
                  {o.v.kind === "approve" ? "Drop to approve" : o.v.kind === "reopen" ? "Drop to reopen" : "Can’t drop here"}
                </div>
              ) : null}
              {col.list.length === 0 ? <p className="tq-col-empty">{filtersOn ? "No matches here." : col.empty}</p> : null}
              {col.capped ? (
                <button type="button" className="z-btn xs" style={{ background: "transparent" }} aria-expanded={doneAll} onClick={onDoneAll}>
                  {doneAll ? "Show less" : `Show ${col.list.length - 5} more`}
                </button>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
