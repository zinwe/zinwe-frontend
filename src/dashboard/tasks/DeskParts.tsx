import type { ReactElement } from "react";
import { Avatar } from "./Avatar";
import { dueLabel, dueStyle, statusStyle, type TaskPerson } from "./model";
import { actionsOf, OWN_TAG } from "./pageModel";
import type { DragGhost } from "./useTaskDrag";
import { TASK_SHORT, type TaskView } from "./types";

/** A member's own to-do: its stage in the board's words. */
const OWN_DONE = { background: "#0A0A0A", color: "#FFFFFF" };
const OWN_STAGE: Partial<Record<TaskView["status"], string>> = { sent: "To do", progress: "In progress", approved: "Done" };

/** The callbacks a row or card's buttons run (TasksPage wires them to taskActions, with Undo where it can). */
export interface RowHandlers {
  approve: (t: TaskView) => void;
  reopen: (t: TaskView) => void;
  nudge: (t: TaskView) => void;
  reply: (t: TaskView) => void;
  open: (t: TaskView) => void;
}

export function StageChip({ t }: { t: TaskView }): ReactElement {
  const style = !t.own ? statusStyle(t.status) : t.status === "approved" ? OWN_DONE : t.status === "progress" ? statusStyle("progress") : OWN_TAG;
  return (
    <span className="zk-pill tq-chip" style={style}>
      {t.own ? OWN_STAGE[t.status] : TASK_SHORT[t.status]}
    </span>
  );
}

export function DueChip({ t, short = false }: { t: TaskView; short?: boolean }): ReactElement {
  const long = dueLabel(t);
  const over = long.startsWith("Overdue · ");
  const day = over ? long.slice("Overdue · ".length) : long;
  // A narrow card wraps after "Overdue ·", never inside the date.
  return (
    <span className="zk-pill tq-chip z-num" style={dueStyle(t)} title={long}>
      {over && !short ? "Overdue · " : null}
      <span style={{ whiteSpace: "nowrap" }}>{day}</span>
    </span>
  );
}

/** Their picture or initials, with the PC dot (green: their PC is connected). */
export function PcAvatar({ p, size = 26 }: { p: TaskPerson; size?: number }): ReactElement {
  return (
    <span className="tq-av" style={{ width: size, height: size }}>
      <Avatar person={p} size={size} />
      <i data-on={p.pcOn ? "true" : "false"} title={p.pcOn ? "PC connected" : "PC not connected"} />
    </span>
  );
}

export function StepsBar({ t }: { t: TaskView }): ReactElement | null {
  const n = t.steps.length;
  if (!n) return null;
  const d = t.steps.filter((x) => x.done).length;
  return (
    <span className="tq-prog" data-full={d === n ? "true" : "false"} aria-label={`${d} of ${n} steps done`}>
      <span className="tq-bar">
        <i style={{ width: `${Math.round((d / n) * 100)}%` }} />
      </span>
      <span className="z-num" aria-hidden="true">
        {d}/{n}
      </span>
    </span>
  );
}

export function RowActions({ t, p, on }: { t: TaskView; p: TaskPerson; on: RowHandlers }): ReactElement | null {
  const a = actionsOf(t);
  if (t.own) return null;
  return (
    <>
      {a.approve ? (
        <button type="button" className="tq-btn o" aria-label={`Approve ${t.title}`} onClick={() => on.approve(t)}>
          Approve
        </button>
      ) : null}
      {a.reopen ? (
        <button type="button" className="tq-btn" aria-label={`Reopen ${t.title}`} onClick={() => on.reopen(t)}>
          Reopen
        </button>
      ) : null}
      {a.reply ? (
        <button type="button" className="tq-btn o" aria-label={`Reply to ${p.first} about ${t.title}`} onClick={() => on.reply(t)}>
          Reply
        </button>
      ) : null}
      {a.nudge ? (
        <button type="button" className="tq-btn" disabled={!!t.nudgedAt} title={t.nudgedAt ? `Nudged at ${t.nudgedAt}` : "Zinwe reminds them on their PC"} aria-label={`${t.nudgedAt ? "Nudged" : "Nudge"} ${p.first} about ${t.title}`} onClick={() => on.nudge(t)}>
          {t.nudgedAt ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : null}
          {t.nudgedAt ? "Nudged" : "Nudge"}
        </button>
      ) : null}
      {a.open ? (
        <button type="button" className="tq-btn" aria-label={`Open ${t.title}`} onClick={() => on.open(t)}>
          Open
        </button>
      ) : null}
    </>
  );
}

/** The lifted copy while dragging. */
export function Ghost({ ghost, t, p }: { ghost: DragGhost; t: TaskView; p: TaskPerson }): ReactElement {
  return (
    <div className="tq-ghost" data-back={ghost.back ? "true" : "false"} style={{ left: ghost.x, top: ghost.y, width: ghost.w }} aria-hidden="true">
      <span className="tq-row-tags">
        <StageChip t={t} />
      </span>
      <span className="tq-ghost-t">{t.title}</span>
      <span className="tq-meta">
        <span className="tq-who">
          <PcAvatar p={p} size={22} />
          <span>{p.first}</span>
        </span>
        <DueChip t={t} />
      </span>
    </div>
  );
}

export function GripMark(): ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}

export function HighTag(): ReactElement {
  return (
    <span className="tq-high">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M5 3v18h2v-7h11l-2-4 2-4H7V3z" />
      </svg>
      High
    </span>
  );
}
