import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from "react";
import { errorMessage } from "../../lib/api";
import { Avatar } from "../tasks/Avatar";
import { dayName, isOverdue, NUDGEABLE, type TaskPerson } from "../tasks/model";
import type { TaskView } from "../tasks/types";
import { groupOf, openTasks, type Group } from "./taskGroups";
import { taskActions } from "../tasks/useTasks";

/** What the Tasks view on the phone's Chat list shows: everything, late ones, or the ones waiting on you. */
export type OwnerTaskFilter = "all" | "late" | "mine";

const GROUPS: ReadonlyArray<readonly [Group, string]> = [
  ["late", "Late"],
  ["mine", "Waiting on you"],
  ["today", "Today"],
  ["week", "This week"],
  ["later", "Later"],
];

/** Each swipe button's width (Nudge, Done): the row slides by one or two of them. */
const ACT_PX = 80;
const actsWidth = (el: HTMLElement) => (el.parentElement?.querySelector<HTMLElement>(".cv-tacts")?.offsetWidth ?? ACT_PX * 2);

function subLine(t: TaskView, first: string): string {
  if (t.status === "review") return `${first} marked it done`;
  if (t.status === "help") return `${first} asked for help`;
  if (!t.due) return `${first} · No due date`;
  return `${first} · ${isOverdue(t) ? "Was due" : "Due"} ${dayName(t.due)}${t.time ? `, ${t.time}` : ""}`;
}

/**
 * The owner's quick tasks on a phone (Chat list → Tasks): every open task in the team, grouped Late, Waiting on you,
 * Today, This week, Later. Tap a task to open it in that person's chat; swipe it left (or Tab to its buttons) for
 * Nudge and Done, or Approve when they marked it done. Done and Approve both end the task Approved (taskActions).
 */
export function OwnerTasks({
  tasks,
  people,
  filter,
  query,
  onOpen,
}: {
  tasks: readonly TaskView[];
  people: readonly (TaskPerson & { memberId: number })[];
  filter: OwnerTaskFilter;
  query: string;
  onOpen: (person: TaskPerson, t: TaskView) => void;
}): ReactElement {
  const [swiped, setSwiped] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [said, setSaid] = useState("");
  const justSwiped = useRef(false);
  const drag = useRef<{ id: number; x: number; y: number; start: number; dx: number; moved: boolean; el: HTMLElement } | null>(null);

  const q = query.trim().toLowerCase();
  const byId = new Map(people.map((p) => [p.memberId, p]));
  const rows = openTasks(tasks)
    .map((t) => ({ t, p: byId.get(t.memberId), g: groupOf(t) }))
    .filter((r): r is { t: TaskView; p: TaskPerson & { memberId: number }; g: Group } => !!r.p)
    .filter((r) => filter === "all" || (filter === "late" ? r.g === "late" : r.g === "mine"))
    .filter((r) => !q || `${r.t.title} ${r.p.name}`.toLowerCase().includes(q));

  const act = async (t: TaskView, p: TaskPerson, kind: "nudge" | "done") => {
    setBusy(t.id);
    try {
      if (kind === "nudge") {
        await taskActions.nudge(t);
        setSaid(`Reminder sent to ${p.first}.`);
      } else {
        await taskActions.approve(t);
        setSaid(t.status === "review" ? `Approved: ${t.title}` : `Marked done: ${t.title}`);
      }
      setSwiped(null);
    } catch (e) {
      setSaid(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const down = (id: number) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = e.currentTarget;
    drag.current = { id, x: e.clientX, y: e.clientY, start: swiped === id ? -actsWidth(el) : 0, dx: 0, moved: false, el };
  };
  const move = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 8) return;
    // A mostly vertical move is a scroll, not a swipe.
    if (!d.moved && Math.abs(e.clientY - d.y) > Math.abs(dx)) {
      drag.current = null;
      return;
    }
    d.moved = true;
    d.dx = Math.max(-actsWidth(d.el), Math.min(0, d.start + dx));
    d.el.style.transition = "none";
    d.el.style.transform = `translateX(${d.dx}px)`;
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    justSwiped.current = true;
    window.setTimeout(() => {
      justSwiped.current = false;
    }, 0);
    const w = actsWidth(d.el);
    const opened = d.dx < -w / 2;
    d.el.style.transition = "";
    d.el.style.transform = opened ? `translateX(-${w}px)` : "";
    setSwiped(opened ? d.id : null);
  };

  if (!rows.length) {
    return (
      <div className="cv-tlist">
        <p className="cv-tempty">{q ? `No task or person matches “${query.trim()}”.` : filter === "all" ? "No open tasks. Send one with + at the top." : filter === "late" ? "Nothing is late." : "Nothing is waiting on you."}</p>
        <p className="z-sr" role="status">
          {said}
        </p>
      </div>
    );
  }

  return (
    <div className="cv-tlist">
      <p className="cv-tsaid" role="status">
        {said}
      </p>
      {GROUPS.map(([g, label]) => {
        const mine = rows.filter((r) => r.g === g);
        if (!mine.length) return null;
        return (
          <section key={g} aria-label={label}>
            <h2 className="cv-tg">
              {g === "late" ? <i aria-hidden="true" /> : null}
              {label} · {mine.length}
            </h2>
            {mine.map(({ t, p }) => {
              const canNudge = NUDGEABLE.includes(t.status) && !t.nudgedAt;
              const open = swiped === t.id;
              return (
                <div key={t.id} className={`cv-trow2${open ? " open" : ""}`}>
                  <div className="cv-tacts">
                    {canNudge ? (
                      <button type="button" className="nudge" disabled={busy === t.id} onFocus={() => setSwiped(t.id)} onClick={() => void act(t, p, "nudge")} aria-label={`Nudge ${p.first}: ${t.title}`}>
                        Nudge
                      </button>
                    ) : null}
                    <button type="button" className="done" disabled={busy === t.id} onFocus={() => setSwiped(t.id)} onClick={() => void act(t, p, "done")} aria-label={`${t.status === "review" ? "Approve" : "Mark done"}: ${t.title}`}>
                      {t.status === "review" ? "Approve" : "Done"}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="cv-tfront"
                    style={open ? { transform: `translateX(-${canNudge ? ACT_PX * 2 : ACT_PX}px)` } : undefined}
                    onPointerDown={down(t.id)}
                    onPointerMove={move}
                    onPointerUp={up}
                    onPointerCancel={up}
                    onClick={() => {
                      // The click that ends a swipe doesn't open the chat.
                      if (justSwiped.current) return;
                      if (open) {
                        setSwiped(null);
                        return;
                      }
                      onOpen(p, t);
                    }}
                    aria-label={`${t.title}, ${subLine(t, p.first)}. Open in ${p.first}’s chat`}
                  >
                    <span className="cv-tav">
                      <Avatar person={p} size={36} />
                    </span>
                    <span className="cv-ttext">
                      <span className="cv-tline">
                        <b>{t.title}</b>
                        {t.status === "review" ? <span className="cv-ttag dark">Check</span> : t.status === "help" ? <span className="cv-ttag dark">Help</span> : t.high ? <span className="cv-ttag hi">High</span> : null}
                      </span>
                      <span className="cv-tsub">{subLine(t, p.first)}</span>
                    </span>
                  </button>
                </div>
              );
            })}
          </section>
        );
      })}
      <p className="cv-thint">Swipe a task left to nudge or mark it done. Tap it to open the chat.</p>
    </div>
  );
}
