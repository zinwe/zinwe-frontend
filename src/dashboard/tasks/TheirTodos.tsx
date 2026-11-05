import { useState, type ReactElement } from "react";
import type { MemberTodo } from "../../lib/api";
import { firstName } from "../team/format";
import { Sk } from "../ui/States";
import { ZIcon } from "../ui/ZIcon";
import { AMBER, dayName, NEUTRAL, RED } from "./model";
import { todayIso } from "./types";
import { sortTodos } from "./useMemberTodos";
import "../../styles/dash13/todos.css";

/** Rows shown before "Show N more" (cards: a few more, they sit side by side). */
const SHOWN = 4;
const SHOWN_CARDS = 8;
const OPEN_KEY = "zinwe.todos.open.";

/** F-06: folded or open, remembered per person on this browser (open by default). */
function readOpen(memberId: number | undefined): boolean {
  if (memberId === undefined) return true;
  try {
    return localStorage.getItem(OPEN_KEY + memberId) !== "0";
  } catch {
    return true;
  }
}

function writeOpen(memberId: number | undefined, open: boolean): void {
  if (memberId === undefined) return;
  try {
    if (open) localStorage.removeItem(OPEN_KEY + memberId);
    else localStorage.setItem(OPEN_KEY + memberId, "0");
  } catch {
    /* storage blocked: it opens again next visit */
  }
}

function dueText(t: MemberTodo): { text: string; late: boolean } {
  if (t.status === "done") return { text: "Done", late: false };
  if (!t.due_date) return { text: "No date", late: false };
  const late = t.due_date < todayIso();
  return { text: `${late ? "Overdue · " : ""}${dayName(t.due_date)}`, late };
}

/** The due pill, coloured like an assigned task's: overdue, due today, or plain. */
function dueStyleOf(t: MemberTodo): { background: string; color: string } {
  if (t.status === "done" || !t.due_date) return NEUTRAL;
  if (t.due_date < todayIso()) return RED;
  return t.due_date === todayIso() ? AMBER : NEUTRAL;
}

function TodoCard({ t, first }: { t: MemberTodo; first: string | null }): ReactElement {
  const done = t.status === "done";
  const stepsDone = t.steps.filter((s) => s.done).length;
  const n = t.steps.length;
  return (
    <li className={done ? "ztd__card done" : "ztd__card"}>
      <span className="ztd__card-top">
        <span className="zk-pill" style={NEUTRAL}>
          {done ? "Done" : "Open"}
        </span>
        {first ? null : <span className="ztd__who">{firstName(t.member_name)}</span>}
      </span>
      <span className={done ? "ztd__card-t done" : "ztd__card-t"}>{t.title}</span>
      {done ? null : (
        <span className="ztd__card-due">
          <span className="zk-pill" style={dueStyleOf(t)}>
            {dueText(t).text}
          </span>
        </span>
      )}
      {n ? (
        <span className="ztd__steps" aria-label={`${stepsDone} of ${n} steps done`}>
          <span className="ztd__bar">
            <span style={{ width: `${Math.round((stepsDone / n) * 100)}%`, background: stepsDone === n ? "#0A0A0A" : "#F26A0A" }} />
          </span>
          <span className="z-num z-mono ztd__steps-n">
            {stepsDone}/{n}
          </span>
        </span>
      ) : null}
    </li>
  );
}

/**
 * "Their own to-dos": what a person added for themselves in their Zinwe app (DashTeam card, Tasks page). Read-only: the
 * owner can see them but never change them. `first` null = everyone's, each row with the person's first name.
 * On the Team card the list folds under a chevron, remembered per person (F-06); the Tasks page keeps it open and shows
 * each to-do as a card in the same style as assigned tasks (F-05a).
 */
export function TheirTodos({
  todos,
  failed,
  first,
  label = "Their own to-dos",
  className = "",
  memberId,
  collapsible = false,
  cards = false,
}: {
  /** undefined while loading. */
  todos: readonly MemberTodo[] | undefined;
  failed: boolean;
  first: string | null;
  label?: string;
  className?: string;
  /** Whose list: folded / open is remembered per person. */
  memberId?: number;
  /** A chevron in the header folds the list (Team card). */
  collapsible?: boolean;
  /** Cards like the Tasks board instead of a compact list (Tasks page). */
  cards?: boolean;
}): ReactElement {
  const [all, setAll] = useState(false);
  const [unfolded, setUnfolded] = useState(() => readOpen(memberId));
  const expanded = !collapsible || unfolded;
  const sorted = todos ? sortTodos(todos) : [];
  const cap = cards ? SHOWN_CARDS : SHOWN;
  const shown = all ? sorted : sorted.slice(0, cap);
  const open = sorted.filter((t) => t.status === "open").length;
  const bodyId = `ztd-body-${memberId ?? "all"}`;
  const count = sorted.length > 0 ? <span className="z-num ztd__n">{open} open</span> : null;
  const toggle = () => {
    writeOpen(memberId, !unfolded);
    setUnfolded(!unfolded);
  };

  return (
    <section className={`ztd ${className}`.trim()} aria-label={first ? `${first}’s own to-dos` : label}>
      {collapsible ? (
        <button type="button" className="ztd__head ztd__fold" aria-expanded={expanded} aria-controls={bodyId} onClick={toggle}>
          <span className="z-lbl ztd__k">{label}</span>
          <span className="ztd__fold-r">
            {count}
            <ZIcon name="chevronDown" size={16} stroke={2} className={expanded ? "ztd__chev on" : "ztd__chev"} />
          </span>
        </button>
      ) : (
        <div className="ztd__head">
          <span className="z-lbl ztd__k">{label}</span>
          {count}
        </div>
      )}
      {!expanded ? null : todos === undefined ? (
        failed ? (
          <span className="ztd__note">We couldn’t load these. They’ll show when the page refreshes.</span>
        ) : (
          <span role="status" aria-busy="true">
            <span className="z-sr">Loading to-dos</span>
            <Sk w="70%" h={14} />
          </span>
        )
      ) : sorted.length === 0 ? (
        <span id={bodyId} className="ztd__note">
          {first
            ? "No to-dos yet."
            : "Nobody has added a to-do of their own yet. When they do in their Zinwe app, you’ll see them here."}
        </span>
      ) : (
        <div id={bodyId} className="ztd__body">
          {cards ? (
            <ul className="ztd__cards">
              {shown.map((t) => (
                <TodoCard key={t.id} t={t} first={first} />
              ))}
            </ul>
          ) : (
            <ul className="ztd__list">
              {shown.map((t) => {
                const due = dueText(t);
                const stepsDone = t.steps.filter((s) => s.done).length;
                return (
                  <li key={t.id} className="ztd__row">
                    <span className={t.status === "done" ? "ztd__mark on" : "ztd__mark"} aria-hidden="true" />
                    <span className="ztd__text">
                      <span className={t.status === "done" ? "ztd__title done" : "ztd__title"}>{t.title}</span>
                      <span className="ztd__meta">
                        {first ? null : `${firstName(t.member_name)} · `}
                        <span className={due.late ? "ztd__late" : undefined}>{due.text}</span>
                        {t.steps.length ? ` · ${stepsDone}/${t.steps.length} steps` : ""}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {sorted.length > cap ? (
            <button type="button" className="ztd__more" aria-expanded={all} onClick={() => setAll(!all)}>
              {all ? "Show less" : `Show ${sorted.length - cap} more`}
            </button>
          ) : null}
          <span className="ztd__note">View only. Added in their Zinwe app.</span>
        </div>
      )}
    </section>
  );
}
