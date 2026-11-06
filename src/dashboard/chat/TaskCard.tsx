import { useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { errorMessage } from "../../lib/api";
import { ClockMark, TaskMark } from "../tasks/icons";
import { chatTrackOf, dueLabel, dueStyle, isClosed, isFinished, noteByOf, RED, statusStyle } from "../tasks/model";
import { taskActions } from "../tasks/useTasks";
import { TASK_STATUS, type TaskView } from "../tasks/types";

/**
 * A task in the chat thread (DashChat): kicker, title, status / priority / due / steps pills and the live stage bar
 * (Sent → Seen → … → Approved, refreshed as their Zinwe app reports back); opened, the details, steps, their note and
 * the actions (Approve, Reopen, Reply in chat, Move due, Edit task, Open in Tasks). FR-20 v2 API.
 */
export function TaskCard({
  task: t,
  first,
  open,
  onToggle,
  onEdit,
  onReply,
  onThread,
}: {
  task: TaskView;
  first: string;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  /** Reply in chat about this task, with an optional draft. */
  onReply: (draft?: string) => void;
  /** v1.3.5 (F-17): open this task's thread (the lines said about it) beside the chat. */
  onThread?: () => void;
}): ReactElement {
  const finished = isFinished(t);
  const doneN = t.steps.filter((x) => x.done).length;
  const track = chatTrackOf(t);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (p: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await p();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <article aria-label={`Task: ${t.title}`} className={t.status === "cancelled" ? "cv-card off" : "cv-card"}>
      <button type="button" className="tb-head" aria-expanded={open} onClick={onToggle}>
        <span className="cv-card__mark" aria-hidden="true">
          <TaskMark />
        </span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span className="cv-kicker">TASK</span>
            <b style={{ fontSize: 15, lineHeight: 1.3 }}>{t.title}</b>
          </span>
          <span style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <span className="cv-pill" style={statusStyle(t.status)}>
              {TASK_STATUS[t.status][0]}
            </span>
            <span className="cv-pill" style={t.high ? RED : { background: "#F5F5F5", color: "#404040" }}>
              {t.high ? "High priority" : "Normal"}
            </span>
            <span className="cv-pill" style={dueStyle(t)}>
              <ClockMark />
              {dueLabel(t)}
            </span>
            {t.steps.length ? (
              <span className="cv-pill" style={{ background: "#F5F5F5", color: "#404040" }}>
                {doneN}/{t.steps.length} steps
              </span>
            ) : null}
            {t.edited ? (
              <span className="cv-pill" style={{ background: "#F5F5F5", color: "#6B6B6B" }}>
                Edited
              </span>
            ) : null}
          </span>
        </span>
        <span className="cv-chev" aria-hidden="true" style={{ transform: `rotate(${open ? 180 : 0}deg)` }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>

      {t.status !== "cancelled" ? (
        <ol aria-label={`Stage: ${TASK_STATUS[t.status][0]}`} className="cv-track" style={{ gridTemplateColumns: `repeat(${track.length}, minmax(0, 1fr))` }}>
          {track.map((k) => (
            <li key={k.key} aria-current={k.current ? "step" : undefined}>
              <span className="cv-track__bar" style={{ background: k.help ? "#A84505" : k.reached ? (k.green ? "#17663F" : "#F26A0A") : k.awaitingOk ? "#BFE5CF" : "#E5E5E5" }} />
              <span style={{ fontSize: 11, color: k.reached || k.awaitingOk ? "#404040" : "#6B6B6B", fontWeight: k.current ? 700 : 500 }}>
                {k.awaitingOk ? "Your OK" : k.label}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {open ? (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #F5F5F5", display: "flex", flexDirection: "column", gap: 12 }}>
          {t.details ? <p style={{ margin: 0, color: "#404040", whiteSpace: "pre-wrap" }}>{t.details}</p> : null}
          {t.steps.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="cv-kicker">STEPS</span>
              {t.steps.map((x) => (
                <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                  <span aria-hidden="true" className={x.done ? "zk-box on" : "zk-box"}>
                    {x.done ? "✓" : ""}
                  </span>
                  <span style={x.done ? { color: "#6B6B6B", textDecoration: "line-through" } : { color: "#141210" }}>{x.label}</span>
                  <span className="z-sr">{x.done ? "done" : "not done yet"}</span>
                </div>
              ))}
            </div>
          ) : null}
          {!finished ? <span style={{ fontSize: 13, color: "#404040" }}>Needs your OK when {first} marks it done.</span> : null}
          {t.note && !isClosed(t) ? (
            <p style={{ margin: 0, padding: "10px 12px", borderRadius: 10, fontSize: 13, ...(t.status === "help" ? { background: "#FDEBDC", color: "#8A3A04" } : { background: "#F5F5F5", color: "#404040" }) }}>
              <b>{noteByOf(t, first)}:</b> {t.note}
            </p>
          ) : null}
          {t.status === "review" ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="z-btn sm green" disabled={busy} onClick={() => void run(() => taskActions.approve(t))}>
                Approve
              </button>
              <button type="button" className="z-btn sm" disabled={busy} onClick={() => void run(() => taskActions.reopen(t, "Please check the last step again."))}>
                Reopen
              </button>
            </div>
          ) : null}
          {t.status === "help" ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="z-btn sm pri" onClick={() => onReply("")}>
                Reply in chat
              </button>
              <button type="button" className="z-btn sm" disabled={busy} onClick={() => void run(() => taskActions.moveDue(t))}>
                Move due to tomorrow
              </button>
            </div>
          ) : null}
          {error ? (
            <p role="alert" style={{ margin: 0, fontSize: 13, color: "#C0331C" }}>
              {error}
            </p>
          ) : null}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            {onThread ? (
              <button type="button" className="zk-link" onClick={onThread}>
                {t.talkCount ? `Thread · ${t.talkCount} ${t.talkCount === 1 ? "reply" : "replies"}` : "Ask about this task"}
              </button>
            ) : null}
            {!finished ? (
              <button type="button" className="zk-link" onClick={onEdit}>
                Edit task
              </button>
            ) : null}
            {isClosed(t) ? (
              <button type="button" className="zk-link" disabled={busy} onClick={() => void run(() => taskActions.reopen(t, "Please take another look."))}>
                Reopen
              </button>
            ) : null}
            <Link className="zk-link" to={`/app/tasks#task=${t.id}`}>
              Open in Tasks
            </Link>
          </div>
        </div>
      ) : null}
    </article>
  );
}
