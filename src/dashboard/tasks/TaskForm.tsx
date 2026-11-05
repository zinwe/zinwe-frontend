import { useEffect, useRef, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { errorMessage } from "../../lib/api";
import { ZIcon } from "../ui/ZIcon";
import { CalendarMark } from "./icons";
import { dayName, fmtISO, isISO, MONTH_FULL, moreSummary, type TaskPerson } from "./model";
import { addDays, todayIso, type TaskView } from "./types";

/** What the form hands back: the fields of a new or edited task. */
export interface TaskFormValues {
  person: TaskPerson;
  title: string;
  details: string;
  due: string;
  time: string;
  high: boolean;
  steps: string[];
}

const TIMES = ["9:00 AM", "12:00 PM", "2:00 PM", "5:00 PM", "6:30 PM"] as const;

interface FormState {
  who: string;
  title: string;
  details: string;
  due: "today" | "tomorrow" | "date";
  date: string;
  time: string;
  high: boolean;
  steps: string[];
  step: string;
  calOpen: boolean;
  /** Months after this one shown in the calendar (0–2). */
  calM: number;
  more: boolean;
}

function monthsAhead(iso: string): number {
  const t = new Date(`${todayIso()}T00:00:00`);
  const d = new Date(`${iso}T00:00:00`);
  return Math.min(2, Math.max(0, (d.getFullYear() - t.getFullYear()) * 12 + d.getMonth() - t.getMonth()));
}

function blank(who: string, title = ""): FormState {
  return { who, title, details: "", due: "today", date: "", time: "", high: false, steps: [], step: "", calOpen: false, calM: 0, more: false };
}

function fromTask(t: TaskView, who: string): FormState {
  const today = todayIso();
  const preset = !t.due || t.due === today ? "today" : t.due === addDays(today, 1) ? "tomorrow" : "date";
  return {
    ...blank(who, t.title),
    details: t.details,
    due: preset,
    date: preset === "date" ? t.due : "",
    calM: preset === "date" ? monthsAhead(t.due) : 0,
    time: t.time,
    high: t.high,
    steps: t.steps.map((x) => x.label),
    more: true,
  };
}

/**
 * New task / Edit task: the side drawer on desktop, a full-screen sheet on a phone (DashTasks + DashChat, same form).
 * Escape closes the calendar first, then the form. Focus starts in the title and returns to the opener.
 */
export function TaskForm({
  people,
  who,
  editing = null,
  title: startTitle = "",
  onClose,
  onSubmit,
}: {
  people: readonly TaskPerson[];
  /** Person key to fill in. */
  who: string | null;
  editing?: TaskView | null;
  /** A title to start from (Chat's "/task Send the deck"). */
  title?: string;
  onClose: () => void;
  onSubmit: (values: TaskFormValues, editing: TaskView | null) => void | Promise<void>;
}): ReactElement {
  const startWho = who && people.some((p) => p.key === who) ? who : (people[0]?.key ?? "");
  const [f, setF] = useState<FormState>(() => (editing ? fromTask(editing, startWho) : blank(startWho, startTitle)));
  const set = (patch: Partial<FormState>) => setF((s) => ({ ...s, ...patch }));
  const panel = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const calOpenRef = useRef(f.calOpen);
  useEffect(() => {
    closeRef.current = onClose;
    calOpenRef.current = f.calOpen;
  });

  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    const id = window.setTimeout(() => document.getElementById("cm-title")?.focus(), 40);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (calOpenRef.current) setF((s) => ({ ...s, calOpen: false }));
        else closeRef.current();
        return;
      }
      const root = panel.current;
      if (e.key !== "Tab" || !root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, a[href]"));
      if (!items.length) return;
      const a = items[0];
      const z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("keydown", onKey, true);
      if (back && document.contains(back)) back.focus();
    };
  }, []);

  const person = people.find((p) => p.key === f.who) ?? people[0];
  const today = todayIso();
  const dateBad = f.due === "date" && (!isISO(f.date) || f.date < today);
  const cannotSend = !f.title.trim() || dateBad || !person;
  const isEditing = editing !== null;
  const dueDay = f.due === "today" ? today : f.due === "tomorrow" ? addDays(today, 1) : isISO(f.date) ? f.date : "";
  const dueLine = !dueDay
    ? `Pick a day for ${person?.first ?? "them"}.`
    : `Due ${f.due === "date" ? dayName(dueDay).replace(/^(Today|Tomorrow)$/, (w) => w.toLowerCase()) : f.due}${f.time ? `, ${f.time}` : ""}. ${person?.first ?? "They"} sees it in their Zinwe app.`;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (cannotSend || !person || saving) return;
    const due = f.due === "today" ? today : f.due === "tomorrow" ? addDays(today, 1) : f.date;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ person, title: f.title.trim(), details: f.details.trim(), due, time: f.time, high: f.high, steps: f.steps }, editing);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };
  const addStep = () => {
    if (f.step.trim()) set({ steps: [...f.steps, f.step.trim()], step: "" });
  };

  // Calendar: this month and the next two, Monday first; days before today can't be picked.
  const base = new Date(`${today}T00:00:00`);
  const view = new Date(base.getFullYear(), base.getMonth() + f.calM, 1);
  const lead = (view.getDay() + 6) % 7;
  const len = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <div>
      <button type="button" className="zk-sheet-bg" aria-label="Close" tabIndex={-1} onClick={onClose} style={{ zIndex: 93, background: "rgba(20,18,16,.36)" }} />
      <aside ref={panel} role="dialog" aria-modal="true" aria-labelledby="cm-h" className="zk-sheet" style={{ zIndex: 94, width: "min(520px, 100%)", boxShadow: "-14px 0 36px rgba(20,18,16,.18)" }}>
        <div style={{ padding: "16px 22px", borderBottom: "1px solid #F5F5F5", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <h2 id="cm-h" style={{ margin: 0, fontSize: 19 }}>
            {isEditing ? "Edit task" : "New task"}
          </h2>
          <button type="button" className="zk-ic" aria-label="Close" onClick={onClose}>
            <ZIcon d="M6 6l12 12M18 6 6 18" size={16} stroke={2.2} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label className="zk-lab" htmlFor="cm-who">
              Assign to
            </label>
            {people.length === 0 && !isEditing ? (
              // A new owner with nobody on Team yet: an empty "Assign to" list was a dead end.
              <p id="cm-who" style={{ margin: 0, padding: "12px 14px", borderRadius: 12, background: "#FDEBDC", color: "#8A3A04", fontSize: 14, lineHeight: 1.45 }}>
                A task goes to one person's Zinwe app, and nobody is on your team yet.{" "}
                <Link to="/app/team#add=1" onClick={onClose} style={{ fontWeight: 600, color: "#8A3A04" }}>
                  Add your first person
                </Link>
                , then send them a task.
              </p>
            ) : (
              <select id="cm-who" className="zk-sel" style={{ minHeight: 40, fontSize: 14 }} value={f.who} disabled={isEditing} onChange={(e) => set({ who: e.target.value })}>
                {people.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name} · {p.role}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label className="zk-lab" htmlFor="cm-title">
              What needs doing
            </label>
            <input
              id="cm-title"
              className="zk-inp"
              value={f.title}
              maxLength={120}
              onChange={(e) => set({ title: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="e.g. Send the October invoices to Sunline Cafe"
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="zk-lab">Due</span>
            <div role="group" aria-label="Due" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
              {(
                [
                  ["today", "Today"],
                  ["tomorrow", "Tomorrow"],
                ] as const
              ).map(([k, label]) => (
                <button key={k} type="button" className={f.due === k ? "zk-chip on" : "zk-chip"} aria-pressed={f.due === k} onClick={() => set({ due: k, calOpen: false })}>
                  {label}
                </button>
              ))}
              <button
                type="button"
                className={f.due === "date" || f.calOpen ? "zk-chip on" : "zk-chip"}
                aria-pressed={f.due === "date"}
                aria-expanded={f.calOpen}
                aria-controls="cm-cal"
                onClick={() => set({ calOpen: !f.calOpen })}
              >
                <CalendarMark />
                {f.due === "date" && isISO(f.date) ? fmtISO(f.date) : "Pick a date"}
                <span aria-hidden="true" style={{ display: "inline-flex", marginLeft: 2, transition: "transform .15s", transform: `rotate(${f.calOpen ? 180 : 0}deg)` }}>
                  <ZIcon d="m6 9 6 6 6-6" size={13} stroke={2.4} />
                </span>
              </button>
            </div>
            {/* The calendar opens inside the form, under the Due chips, so it never covers anything (LabDashTasks). */}
            {f.calOpen ? (
              <div id="cm-cal" role="group" aria-label="Pick a due date" style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, border: "1px solid #E5E5E5", borderRadius: 14, background: "#fff", maxWidth: 320 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <button type="button" className="zk-nav" aria-label="Previous month" disabled={f.calM <= 0} onClick={() => set({ calM: Math.max(0, f.calM - 1) })}>
                    ‹
                  </button>
                  <b style={{ fontSize: 14 }}>
                    {MONTH_FULL[view.getMonth()]} {view.getFullYear()}
                  </b>
                  <button type="button" className="zk-nav" aria-label="Next month" disabled={f.calM >= 2} onClick={() => set({ calM: Math.min(2, f.calM + 1) })}>
                    ›
                  </button>
                </div>
                <div className="zk-cal">
                  {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((w) => (
                    <span key={w} className="zk-wk">
                      {w}
                    </span>
                  ))}
                  {Array.from({ length: lead }, (_, i) => (
                    <span key={`b${i}`} className="zk-cd blank" aria-hidden="true" />
                  ))}
                  {Array.from({ length: len }, (_, i) => {
                    const iso = `${view.getFullYear()}-${pad(view.getMonth() + 1)}-${pad(i + 1)}`;
                    const on = f.due === "date" && f.date === iso;
                    return (
                      <button
                        key={iso}
                        type="button"
                        className={`zk-cd${on ? " edge" : ""}${iso === today ? " today" : ""}`}
                        disabled={iso < today}
                        aria-label={iso === today ? `Today, ${fmtISO(iso)}` : fmtISO(iso)}
                        aria-pressed={on}
                        onClick={() => {
                          if (iso >= today) set({ due: "date", date: iso, calOpen: false });
                        }}
                      >
                        {i + 1}
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12, color: "#6B6B6B", borderTop: "1px solid #F5F5F5", paddingTop: 8 }}>
                  <span>Today is outlined. Days before today can’t be picked.</span>
                  <button type="button" className="zk-link" onClick={() => set({ calOpen: false })}>
                    Close
                  </button>
                </div>
              </div>
            ) : null}
            {dateBad ? <span style={{ fontSize: 12, color: "#C0331C" }}>Pick a date from today on.</span> : null}
            {person ? <span style={{ fontSize: 12, color: "#6B6B6B" }}>{dueLine}</span> : null}
          </div>
          <button type="button" className="zk-more" aria-expanded={f.more} onClick={() => set({ more: !f.more })}>
            <span className="zk-more__chev" aria-hidden="true" style={{ transform: `rotate(${f.more ? 180 : 0}deg)` }}>
              <ZIcon d="m6 9 6 6 6-6" size={16} stroke={2.2} />
            </span>
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span>More options</span>
              <span style={{ fontSize: 12, fontWeight: 400, color: "#6B6B6B" }}>
                {moreSummary({ details: f.details, time: f.time, high: f.high, steps: f.steps })}
              </span>
            </span>
          </button>
          {f.more ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 14, background: "#FAFAFA", border: "1px solid #F5F5F5", borderRadius: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label className="zk-lab" htmlFor="cm-det">
                  Details <span style={{ fontWeight: 400, color: "#6B6B6B" }}>(optional)</span>
                </label>
                <textarea id="cm-det" rows={2} className="zk-inp" value={f.details} maxLength={1000} onChange={(e) => set({ details: e.target.value })} placeholder="Anything they need to know" style={{ resize: "vertical" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label className="zk-lab" htmlFor="cm-time">
                  Due time
                </label>
                <select id="cm-time" className="zk-sel" style={{ minHeight: 40, maxWidth: 200 }} value={f.time} onChange={(e) => set({ time: e.target.value })}>
                  <option value="">Any time that day</option>
                  {(f.time && !(TIMES as readonly string[]).includes(f.time) ? [f.time, ...TIMES] : TIMES).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="zk-lab">Priority</span>
                <div role="group" aria-label="Priority" style={{ display: "flex", gap: 6 }}>
                  <button type="button" className={f.high ? "zk-chip" : "zk-chip on"} aria-pressed={!f.high} onClick={() => set({ high: false })}>
                    Normal
                  </button>
                  <button type="button" className={f.high ? "zk-chip on" : "zk-chip"} aria-pressed={f.high} onClick={() => set({ high: true })}>
                    High
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="zk-lab">
                  Checklist <span style={{ fontWeight: 400, color: "#6B6B6B" }}>(optional)</span>
                </span>
                {f.steps.map((label, i) => (
                  <div key={`${i}-${label}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px 4px 12px", background: "#fff", border: "1px solid #F5F5F5", borderRadius: 8 }}>
                    <span className="z-mono" style={{ fontSize: 12, color: "#6B6B6B" }}>
                      {i + 1}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
                    <button type="button" className="zk-xbtn" aria-label={`Remove step ${i + 1}`} onClick={() => set({ steps: f.steps.filter((_, j) => j !== i) })}>
                      ×
                    </button>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 8 }}>
                  <label htmlFor="cm-step" className="z-sr">
                    New step
                  </label>
                  <input
                    id="cm-step"
                    className="zk-inp"
                    value={f.step}
                    onChange={(e) => set({ step: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addStep();
                      }
                    }}
                    placeholder="Add a step"
                  />
                  <button type="button" className="z-btn" disabled={!f.step.trim()} onClick={addStep}>
                    Add
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <div className="zk-sheet-foot" style={{ padding: "14px 22px", borderTop: "1px solid #F5F5F5", background: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {error ? (
            <p role="alert" style={{ margin: 0, flexBasis: "100%", fontSize: 13, color: "#C0331C" }}>
              {error}
            </p>
          ) : null}
          <span style={{ fontSize: 12, color: "#6B6B6B" }}>
            {!person ? "Add a person on Team first." : isEditing ? `${person.first} sees an “Edited” tag. Ticked steps stay ticked.` : `Lands in ${person.first}’s chat and Zinwe app. They mark it done, you give the OK.`}
          </span>
          <span style={{ display: "flex", gap: 8 }}>
            <button type="button" className="z-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="z-btn pri" disabled={cannotSend || saving} onClick={() => void submit()}>
              {saving ? (isEditing ? "Saving…" : "Sending…") : isEditing ? "Save changes" : `Send to ${person?.first ?? "them"}`}
            </button>
          </span>
        </div>
      </aside>
    </div>
  );
}
