import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { roleColour } from "../roleColour";
import { Avatar } from "./Avatar";
import { dueKey, NUDGEABLE, personOfTask, type TaskPerson } from "./model";
import { finishedAt, lastParts, PHONE_GROUPS, phoneChip, phoneGroupOf, phoneSub, type PhoneGroupId } from "./pageModel";
import type { TaskView } from "./types";

type StatusFilter = "all" | "late" | "mine" | "done";

const STATUS_CHIPS: ReadonlyArray<[StatusFilter, string, string]> = [
  ["all", "All", ""],
  ["late", "Late", "#C0331C"],
  ["mine", "Waiting on you", "#F26A0A"],
  ["done", "Done", "#17663F"],
];

const EMPTY: Record<StatusFilter, [string, string]> = {
  all: ["No tasks", "Send someone a task with +."],
  late: ["Nothing late", "Every open task is on time."],
  mine: ["Nothing waits on you", "Approvals and questions show here."],
  done: ["Nothing done yet", "Approved tasks show here."],
};

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

/**
 * The Tasks page on a phone (LabPhoneChatTasks, page="Tasks"): a search field, one row of chips (All · Late ·
 * Waiting on you · Done, then Role ▾ and Member ▾), and the tasks in groups. A row opens in place with its steps, the
 * last update and its actions: Approve / Reopen, Reply (opens their chat), Reopen, Nudge. Members' own to-dos sit
 * among them, read-only. Filters combine; the counts follow the search, role and member.
 */
export function PhoneTasks({
  tasks,
  people,
  member,
  onMember,
  onApprove,
  onReopen,
  onNudge,
  onReply,
  onChat,
  onOpen,
}: {
  tasks: readonly TaskView[];
  people: readonly TaskPerson[];
  /** The Member chip's person (shared with the desktop Person filter and #m=<first>), null = everyone. */
  member: number | null;
  onMember: (memberId: number | null) => void;
  onApprove: (t: TaskView) => void;
  onReopen: (t: TaskView) => void;
  onNudge: (t: TaskView) => void;
  /** Needs help: open Chat with that person. */
  onReply: (t: TaskView) => void;
  /** v1.3.5 (F-17): open the task's thread in Chat (own to-dos too). */
  onChat: (t: TaskView) => void;
  /** The task's full drawer (edit, cancel, activity). */
  onOpen: (t: TaskView) => void;
}): ReactElement {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [role, setRole] = useState("");
  const [menu, setMenu] = useState<"role" | "member" | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);

  // Role colours: the distinct roles of the company's active members (member.role, "" = none), as People & PCs uses
  // them, so a role wears the same colour on both pages. A person with no role reads "Team member" in grey.
  const allRoles = useMemo(() => people.map((p) => p.member?.role ?? "").filter(Boolean), [people]);
  const roles = useMemo(() => [...new Set(people.map((p) => p.role).filter(Boolean))].sort(byName), [people]);
  const rows = useMemo(() => tasks.map((t) => ({ t, p: personOfTask(t, people) })), [tasks, people]);
  const openRows = rows.filter((r) => phoneGroupOf(r.t) !== "done");
  const memberP = member != null ? (people.find((p) => p.memberId === member) ?? null) : null;

  // Esc closes the open Role / Member menu (focus goes back to its chip); the first choice gets focus when it opens.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMenu(null);
        opener.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const id = window.setTimeout(() => menuRef.current?.querySelector<HTMLElement>("[role=menuitemradio]")?.focus(), 30);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(id);
    };
  }, [menu]);

  const ql = q.trim().toLowerCase();
  const base = rows.filter(
    ({ t, p }) => (!ql || t.title.toLowerCase().includes(ql) || p.name.toLowerCase().includes(ql)) && (!role || p.role === role) && (member == null || t.memberId === member),
  );
  const countOf = (f: StatusFilter) => (f === "all" ? base.length : base.filter(({ t }) => phoneGroupOf(t) === f).length);
  const shown = base.filter(({ t }) => filter === "all" || phoneGroupOf(t) === filter);
  const groups = PHONE_GROUPS.map((g) => ({
    ...g,
    rows: shown
      .filter(({ t }) => phoneGroupOf(t) === g.id)
      .sort((a, b) => (g.id === "done" ? finishedAt(b.t) - finishedAt(a.t) : dueKey(a.t) < dueKey(b.t) ? -1 : dueKey(a.t) > dueKey(b.t) ? 1 : 0)),
  })).filter((g) => g.rows.length > 0);
  const narrowed = !!ql || !!role || member != null;

  const chipStyle = (on: boolean) => ({ background: on ? "#141210" : "#FFFFFF", borderColor: on ? "#141210" : "#D4D4D4", color: on ? "#FFFFFF" : "#141210" });

  const toggleMenu = (which: "role" | "member", el: HTMLButtonElement) => {
    opener.current = el;
    setMenu((m) => (m === which ? null : which));
  };
  const pick = (fn: () => void) => {
    fn();
    setMenu(null);
    setOpen(null);
    opener.current?.focus();
  };

  return (
    <div className="tq-ph">
      <div className="tq-ph-top">
        <label className="tq-ph-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" stroke="#6B6B6B" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks or people" aria-label="Search tasks or people" />
        </label>
        <div className="tq-ph-chips" role="toolbar" aria-label="Show">
          {STATUS_CHIPS.map(([id, label, dot]) => {
            const on = filter === id;
            return (
              <button
                key={id}
                type="button"
                className="tq-ph-chip"
                aria-pressed={on}
                style={chipStyle(on)}
                onClick={() => {
                  setFilter(id);
                  setOpen(null);
                }}
              >
                {dot ? <span aria-hidden="true" className="tq-ph-dot" style={{ background: dot, boxShadow: `0 0 0 2px ${on ? "rgba(255,255,255,.9)" : "transparent"}` }} /> : null}
                <span>{label}</span>
                <span className="tq-ph-n" style={{ color: on ? "#FFFFFF" : "#6B6B6B" }}>
                  {countOf(id)}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            className="tq-ph-chip"
            style={chipStyle(!!role)}
            aria-haspopup={role ? undefined : "menu"}
            aria-expanded={role ? undefined : menu === "role"}
            aria-label={role ? `Role: ${role}. Clear` : "Filter by role"}
            onClick={(e) => (role ? pick(() => setRole("")) : toggleMenu("role", e.currentTarget))}
          >
            {role ? <span aria-hidden="true" className="tq-ph-dot" style={{ background: roleColour(role, allRoles), boxShadow: "0 0 0 2px rgba(255,255,255,.9)" }} /> : null}
            <span style={{ whiteSpace: "nowrap" }}>{role || "Role"}</span>
            <span aria-hidden="true" className="tq-ph-ic">
              {role ? "✕" : "▾"}
            </span>
          </button>
          <button
            type="button"
            className="tq-ph-chip"
            style={chipStyle(!!memberP)}
            aria-haspopup={memberP ? undefined : "menu"}
            aria-expanded={memberP ? undefined : menu === "member"}
            aria-label={memberP ? `Member: ${memberP.name}. Clear` : "Filter by member"}
            onClick={(e) => (memberP ? pick(() => onMember(null)) : toggleMenu("member", e.currentTarget))}
          >
            {memberP ? <span aria-hidden="true" className="tq-ph-dot" style={{ background: roleColour(memberP.role, allRoles), boxShadow: "0 0 0 2px rgba(255,255,255,.9)" }} /> : null}
            <span style={{ whiteSpace: "nowrap" }}>{memberP ? memberP.first : "Member"}</span>
            <span aria-hidden="true" className="tq-ph-ic">
              {memberP ? "✕" : "▾"}
            </span>
          </button>
        </div>
        {menu ? (
          <>
            <button type="button" className="tq-ph-scrim" aria-label="Close" tabIndex={-1} onClick={() => setMenu(null)} />
            <div ref={menuRef} role="menu" aria-label={menu === "member" ? "Show tasks of" : "Show tasks for the role"} className="tq-ph-menu">
              <div className="tq-ph-mh">{menu === "member" ? "Show tasks of" : "Show tasks for the role"}</div>
              {menu === "role"
                ? roles.map((r) => (
                    <button key={r} type="button" role="menuitemradio" aria-checked={role === r} className="tq-ph-mi" onClick={() => pick(() => setRole(r))}>
                      <span className="tq-ph-ml">
                        <span aria-hidden="true" className="tq-ph-mdot" style={{ background: roleColour(r, allRoles) }} />
                        <span>{r}</span>
                      </span>
                      <span className="tq-ph-mn">{openRows.filter((x) => x.p.role === r).length} open</span>
                    </button>
                  ))
                : [...people]
                    .sort((a, b) => byName(a.name, b.name))
                    .map((p) => (
                      <button key={p.key} type="button" role="menuitemradio" aria-checked={member === p.memberId} className="tq-ph-mi" onClick={() => pick(() => onMember(p.memberId))}>
                        <span className="tq-ph-ml">
                          <span aria-hidden="true" className="tq-ph-mdot" style={{ background: roleColour(p.role, allRoles) }} />
                          <span>{p.name}</span>
                        </span>
                        <span className="tq-ph-mn">
                          {p.role} · {openRows.filter((x) => x.t.memberId === p.memberId).length} open
                        </span>
                      </button>
                    ))}
              {(menu === "role" ? roles.length : people.length) === 0 ? <div className="tq-ph-mn" style={{ padding: "8px 10px" }}>Nobody on your team yet.</div> : null}
            </div>
          </>
        ) : null}
      </div>

      <div className="tq-ph-list">
        {groups.length === 0 ? (
          <div className="tq-ph-empty" role="status">
            <b>{narrowed ? "No tasks match" : EMPTY[filter][0]}</b>
            <span>{narrowed ? "Try another search, role or member." : EMPTY[filter][1]}</span>
            {narrowed ? (
              <button
                type="button"
                className="zk-link"
                onClick={() => {
                  setQ("");
                  setRole("");
                  onMember(null);
                }}
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : null}
        {groups.map((g) => (
          <section key={g.id} aria-labelledby={`tqg-${g.id}`}>
            <h2 id={`tqg-${g.id}`} className="tq-ph-gh">
              <span aria-hidden="true" className="tq-ph-gdot" style={{ background: g.dot }} />
              <span>{g.label}</span>
              <span className="tq-ph-gn">{g.rows.length}</span>
            </h2>
            {g.rows.map(({ t, p }) => (
              <PhoneRow
                key={t.id}
                t={t}
                p={p}
                group={g.id}
                open={open === t.id}
                onToggle={() => setOpen(open === t.id ? null : t.id)}
                onApprove={onApprove}
                onReopen={onReopen}
                onNudge={onNudge}
                onReply={onReply}
                onChat={onChat}
                onOpen={onOpen}
              />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function PhoneRow({
  t,
  p,
  group,
  open,
  onToggle,
  onApprove,
  onReopen,
  onNudge,
  onReply,
  onChat,
  onOpen,
}: {
  t: TaskView;
  p: TaskPerson;
  group: PhoneGroupId;
  open: boolean;
  onToggle: () => void;
  onApprove: (t: TaskView) => void;
  onReopen: (t: TaskView) => void;
  onNudge: (t: TaskView) => void;
  onReply: (t: TaskView) => void;
  onChat: (t: TaskView) => void;
  onOpen: (t: TaskView) => void;
}): ReactElement {
  const sub = phoneSub(t, p.first);
  const [chip, chipBg, chipC] = phoneChip(t);
  const n = t.steps.length;
  const dn = t.steps.filter((s) => s.done).length;
  const done = group === "done";
  const [lastA, lastB] = lastParts(t, p.first, p.pcOn);
  const panel = `tqp-${t.id}`;

  const acts: Array<{ label: string; pri?: boolean; disabled?: boolean; go: () => void }> = [];
  if (!t.own) {
    if (t.status === "review") acts.push({ label: "Approve", pri: true, go: () => onApprove(t) }, { label: "Reopen", go: () => onReopen(t) });
    else if (t.status === "help") acts.push({ label: "Reply", pri: true, go: () => onReply(t) });
    else if (t.status === "approved") acts.push({ label: "Reopen", go: () => onReopen(t) });
    else if (NUDGEABLE.includes(t.status)) acts.push({ label: t.nudgedAt ? "Nudged" : "Nudge", disabled: !!t.nudgedAt, go: () => onNudge(t) });
  }
  // v1.3.5 (F-17): the task's thread in Chat, on every task.
  acts.push({ label: t.talkCount ? `Chat · ${t.talkCount}` : "Chat", go: () => onChat(t) });

  return (
    <div className="tq-ph-row" data-card={t.id}>
      <button type="button" className="tq-ph-rb" aria-expanded={open} aria-controls={panel} aria-label={`${t.title}, ${sub.text}, ${chip}`} onClick={onToggle}>
        <Avatar person={p} size={36} />
        <span className="tq-ph-rt">
          <span className="tq-ph-title" style={{ color: done ? "#6B6B6B" : "#141210" }}>
            {t.title}
          </span>
          <span className="tq-ph-sub" style={{ color: sub.late ? "#C0331C" : "#6B6B6B" }}>
            {sub.text}
          </span>
          {n ? (
            <span className="tq-ph-steps">
              <span className="tq-ph-bar">
                <span style={{ width: `${Math.round((100 * dn) / n)}%`, background: dn === n ? "#17663F" : "#F26A0A" }} />
              </span>
              <span>
                {dn}/{n} steps
              </span>
            </span>
          ) : null}
        </span>
        <span className="tq-ph-stage" style={{ background: chipBg, color: chipC }}>
          {chip}
        </span>
      </button>
      {open ? (
        <div id={panel} className="tq-ph-open">
          {n ? (
            <ul className="tq-ph-check">
              {t.steps.map((s) => (
                <li key={s.id}>
                  <span aria-hidden="true" className="tq-ph-box" style={{ background: s.done ? "#141210" : "#FFFFFF", borderColor: s.done ? "#141210" : "#D4D4D4" }}>
                    {s.done ? "✓" : ""}
                  </span>
                  <span style={{ color: s.done ? "#6B6B6B" : "#141210", textDecoration: s.done ? "line-through" : "none" }}>{s.label}</span>
                  <span className="z-sr">{s.done ? ", done" : ", not done yet"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="tq-ph-none">No steps on this task</p>
          )}
          <p className="tq-ph-last">
            {t.own ? "Their own to-do. They tick it in their Zinwe app." : [lastA, lastB].filter(Boolean).join(" · ")}
          </p>
          {acts.length || !t.own ? (
            <div className="tq-ph-acts">
              {acts.map((a) => (
                <button key={a.label} type="button" className={a.pri ? "tq-ph-act pri" : "tq-ph-act"} disabled={a.disabled} onClick={a.go}>
                  {a.label}
                </button>
              ))}
              {!t.own ? (
                <button type="button" id={`open-${t.id}`} className="zk-link tq-ph-more" onClick={() => onOpen(t)}>
                  All details
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
