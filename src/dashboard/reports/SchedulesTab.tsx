import { useCallback, useState, type KeyboardEvent, type ReactElement } from "react";
import {
  createReportSchedule,
  deleteReportSchedule,
  errorMessage,
  getReportSchedules,
  sendReportScheduleNow,
  updateReportSchedule,
  type Member,
  type ReportCovers,
  type ReportFrequency,
  type ReportSchedule,
  type ReportScheduleInput,
} from "../../lib/api";
import { PlanNote } from "../rules/PlanNote";
import { ErrorBlock, SkRows } from "../ui/States";
import { useNow } from "../time";
import { useResource } from "../useResource";
import { daysBetween, dMid, isoDay, shiftDay, toDate } from "./dates";
import { DatePicker } from "./RangePicker";
import { clock, scheduleName, whenText } from "./schedule";

const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;
/** Board times (TIMES): 7 AM, 9 AM, 12 PM, 6 PM, 7 PM, and 9 PM (an end-of-day send, F-10). */
const HOURS = [7, 9, 12, 18, 19, 21];
/** "Pick dates" repeats: once, or every N days (the API takes 2-90). */
const REPEATS: ReadonlyArray<[number, string]> = [
  [0, "once"],
  [2, "every 2 days"],
  [3, "every 3 days"],
  [7, "every 7 days"],
  [14, "every 14 days"],
  [30, "every 30 days"],
];
/** How far ahead "Pick dates" can start. */
const START_AHEAD_DAYS = 365;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTH_DAYS: ReadonlyArray<[number, string]> = [
  [1, "the 1st"],
  [15, "the 15th"],
];

function recipients(s: ReportSchedule, ownerEmail: string): string {
  const parts: string[] = [];
  if (s.send_to_owner) parts.push(ownerEmail);
  if (s.send_to_members) parts.push(s.member_name ? `${s.member_name} (their own report)` : "each person, their own report");
  parts.push(...s.extra_emails);
  return parts.join(", ");
}

interface Draft {
  member: number | null;
  frequency: ReportFrequency;
  weekday: number;
  monthDay: number;
  /** "Pick dates": 0 = once. */
  everyDays: number;
  /** "Pick dates": the first send day. */
  start: string;
  hour: number;
  /** Daily: today's or yesterday's work (F-10). */
  covers: ReportCovers;
  /** The owner picked `covers`; until then it follows the send time. */
  coversSet: boolean;
  to: string[];
}

/** D2 (owner, 4 Nov): a daily report sent at 6 PM or later covers that day, earlier ones the day before. */
function coversFor(hour: number): ReportCovers {
  return hour >= 18 ? "today" : "yesterday";
}

const PRESETS: ReadonlyArray<{ label: string; sub: string; frequency: ReportFrequency; weekday: number; monthDay: number; hour: number }> = [
  { label: "Weekly team summary", sub: "Mon 9 AM", frequency: "weekly", weekday: 0, monthDay: 1, hour: 9 },
  { label: "Monthly report", sub: "1st, 9 AM", frequency: "monthly", weekday: 0, monthDay: 1, hour: 9 },
  { label: "Daily digest", sub: "6 PM", frequency: "daily", weekday: 0, monthDay: 1, hour: 18 },
];

/** Is `day` a "Pick dates" send day: the start day, then every N days (0 = the start day only). */
function customDay(d: Draft, day: string): boolean {
  if (day < d.start) return false;
  const since = daysBetween(d.start, day) - 1;
  return d.everyDays > 0 ? since % d.everyDays === 0 : since === 0;
}

/** The next send of a draft, worked out here for the preview line (the server's next_run_at is the real one). */
function nextSend(d: Draft, now: Date): Date | null {
  const today = isoDay(now);
  for (let i = 0; i < 400; i++) {
    const day = shiftDay(today, i);
    const dt = toDate(day);
    const ok =
      d.frequency === "daily" ||
      (d.frequency === "weekly" && (dt.getDay() + 6) % 7 === d.weekday) ||
      (d.frequency === "monthly" && dt.getDate() === d.monthDay) ||
      (d.frequency === "custom" && customDay(d, day));
    if (!ok) continue;
    const at = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), d.hour);
    if (at > now) return at;
  }
  return null;
}

function coversText(d: Draft): string {
  if (d.frequency === "daily") return d.covers === "today" ? "covers that day's work" : "covers the day before";
  if (d.frequency === "weekly") return "covers the previous week";
  if (d.frequency === "monthly") return "covers the previous month";
  return d.everyDays > 0 ? "covers the days since the last one" : "sent once";
}

/** "Thu 6 Nov, 9 PM" (whole hours without ":00"). */
function nextText(at: Date): string {
  const time = at.getMinutes() ? clock(at.getHours(), at.getMinutes()) : clock(at.getHours()).replace(":00", "");
  return `${dMid(isoDay(at))}, ${time}`;
}

/**
 * Scheduled (board DashReports `v.sched`): the account's report schedules (GET reports/schedules/) with on/off,
 * Send now, Change and remove, and a "New schedule" sentence form with three presets. New ones need reports_pro;
 * a schedule kept after a downgrade still shows and can be paused or removed.
 * v1.3.3: three ways to repeat (Every day · Every week · Pick dates, F-09), "Covers" for daily reports (F-10), and a
 * new schedule always starts as the whole team's, not the person picked on Reports.
 */
export function SchedulesTab({
  members,
  ownerEmail,
  pro,
  today,
  onToast,
  onSent,
}: {
  members: readonly Member[];
  ownerEmail: string;
  pro: boolean;
  today: string;
  onToast: (text: string) => void;
  /** A report went out (Send now): refresh Sent. */
  onSent: () => void;
}): ReactElement {
  const load = useCallback((signal: AbortSignal) => getReportSchedules(signal), []);
  const schedules = useResource(load);
  const fresh = (): Draft => ({
    member: null,
    frequency: "weekly",
    weekday: 0,
    monthDay: 1,
    everyDays: 0,
    start: today,
    hour: 9,
    covers: coversFor(9),
    coversSet: false,
    to: ownerEmail ? [ownerEmail] : [],
  });
  const [draft, setDraft] = useState<Draft>(fresh);
  const [editing, setEditing] = useState<ReportSchedule | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState<number | "form" | null>(null);
  const [calOpen, setCalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(60_000);
  const list = [...(schedules.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  // A new send time moves "Covers" with it until the owner picks one (D2).
  const setHour = (hour: number) => setDraft((d) => ({ ...d, hour, covers: d.coversSet ? d.covers : coversFor(hour) }));

  const run = async (key: number | "form", fn: () => Promise<string | null>) => {
    setBusy(key);
    setError(null);
    try {
      const text = await fn();
      if (text) onToast(text);
      schedules.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const pending = newEmail.trim().replace(/,$/, "").toLowerCase();
  const addPending = (): string[] | null => {
    if (!pending) return draft.to;
    if (!EMAIL.test(pending)) {
      onToast("Check that email address.");
      return null;
    }
    const to = draft.to.includes(pending) ? draft.to : [...draft.to, pending];
    set({ to });
    setNewEmail("");
    return to;
  };

  const inputFor = (d: Draft, to: string[]): ReportScheduleInput => {
    const owner = ownerEmail.toLowerCase();
    return {
      member: d.member,
      frequency: d.frequency,
      weekday: d.weekday,
      month_day: d.monthDay,
      every_days: d.everyDays,
      ...(d.frequency === "custom" ? { start_date: d.start } : {}),
      covers: d.covers,
      send_hour: d.hour,
      send_to_owner: to.some((e) => e.toLowerCase() === owner),
      send_to_members: editing?.send_to_members ?? false,
      extra_emails: to.filter((e) => e.toLowerCase() !== owner),
      include_csv: editing?.include_csv ?? false,
      is_active: editing?.is_active ?? true,
    };
  };

  const save = () => {
    const to = addPending();
    if (!to) return;
    if (!to.length && !editing?.send_to_members) return onToast("Add an email to send to.");
    if (draft.frequency === "custom" && !nextSend(draft, new Date(now))) return onToast("Pick a start date from today on.");
    const input = inputFor(draft, to);
    if (input.extra_emails.length > 5) return onToast("Add up to 5 other addresses.");
    void run("form", async () => {
      const saved = editing ? await updateReportSchedule(editing.id, input) : await createReportSchedule(input);
      setEditing(null);
      setDraft(fresh());
      return editing
        ? "Schedule saved."
        : saved.next_run_at
          ? `Saved. First report ${whenText(saved.next_run_at, today)}.`
          : "Saved.";
    });
  };

  const startEdit = (s: ReportSchedule) => {
    setEditing(s);
    setNewEmail("");
    setDraft({
      member: s.member,
      frequency: s.frequency,
      weekday: s.weekday,
      monthDay: s.month_day,
      everyDays: s.every_days,
      start: s.start_date && s.start_date >= today ? s.start_date : today,
      hour: s.send_hour,
      // Before v1.3.3 a daily report always covered the day before.
      covers: s.covers ?? "yesterday",
      coversSet: true,
      to: [...(s.send_to_owner && ownerEmail ? [ownerEmail] : []), ...s.extra_emails],
    });
    window.setTimeout(() => document.getElementById("new-h")?.scrollIntoView({ block: "start", behavior: "smooth" }), 30);
  };

  const next = nextSend(draft, new Date(now));
  const preview = next ? `Next: ${nextText(next)} · ${coversText(draft)}` : "Pick a start date from today on.";
  const hours = HOURS.includes(draft.hour) ? HOURS : [...HOURS, draft.hour].sort((a, b) => a - b);
  const repeats = REPEATS.some(([n]) => n === draft.everyDays)
    ? REPEATS
    : [...REPEATS, [draft.everyDays, `every ${draft.everyDays} days`] as [number, string]].sort((a, b) => a[0] - b[0]);
  // F-09: three choices; "Every month" shows only while changing a monthly schedule (or after the Monthly preset).
  const freqs: ReadonlyArray<[ReportFrequency, string]> = [
    ["daily", "Every day"],
    ["weekly", "Every week"],
    ...(draft.frequency === "monthly" ? [["monthly", "Every month"] as [ReportFrequency, string]] : []),
    ["custom", "Pick dates"],
  ];
  const monthDays = MONTH_DAYS.some(([d]) => d === draft.monthDay) ? MONTH_DAYS : [...MONTH_DAYS, [draft.monthDay, `the ${draft.monthDay}th`] as [number, string]];
  const aboutOpts = members.filter((m) => m.is_active || m.id === draft.member);

  const emailKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addPending();
    } else if (e.key === "Backspace" && !newEmail && draft.to.length) set({ to: draft.to.slice(0, -1) });
  };

  return (
    <>
      {error ? (
        <p className="z-err" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
      <section className="z-card" aria-labelledby="sch-h" style={{ overflow: "hidden" }}>
        <h2 id="sch-h" style={{ margin: 0, fontSize: 17, padding: "16px 16px 10px" }}>
          Schedules
        </h2>
        {schedules.data === undefined ? (
          schedules.error ? (
            <div style={{ padding: "0 16px 16px" }}>
              <ErrorBlock message={errorMessage(schedules.error)} onRetry={schedules.reload} />
            </div>
          ) : (
            <SkRows label="Loading schedules…" rows={3} avatar={false} />
          )
        ) : list.length === 0 ? (
          <p style={{ margin: 0, padding: "12px 16px 16px", borderTop: "1px solid #F5F5F5", color: "#6B6B6B", fontSize: 13 }}>
            No schedules yet. Add one below.
          </p>
        ) : (
          list.map((s) => {
            const name = scheduleName(s);
            const planPaused = s.is_active && !pro;
            const nextLine = !s.is_active ? "Paused" : planPaused ? "Paused by plan" : s.next_run_at ? `Next ${whenText(s.next_run_at, today)}` : "Ended";
            const lit = s.is_active && !planPaused && Boolean(s.next_run_at);
            return (
              <div key={s.id} className="rp-srow">
                <div style={{ flex: "1 1 280px", minWidth: 0 }}>
                  <b>{name}</b>
                  <br />
                  <span className="rp-k" style={{ fontSize: 13, overflowWrap: "anywhere" }}>
                    {s.description} · {s.member_name ?? "Everyone"} · {recipients(s, ownerEmail)}
                    {s.include_csv ? " · PDF + CSV" : ""}
                  </span>
                  {s.last_sent_at || s.last_status ? (
                    <>
                      <br />
                      <span className="rp-k">
                        {s.last_sent_at ? `Last sent ${whenText(s.last_sent_at, today)}. ` : ""}
                        {s.last_status}
                      </span>
                    </>
                  ) : null}
                </div>
                <span className="rp-num" style={{ fontSize: 13, ...(lit ? { color: "#141210", fontWeight: 600 } : { color: "#6B6B6B" }) }}>
                  {nextLine}
                </span>
                {pro ? (
                  <>
                    <button
                      type="button"
                      className="z-btn sm"
                      disabled={busy === s.id}
                      onClick={() =>
                        void run(s.id, async () => {
                          const d = await sendReportScheduleNow(s.id);
                          onSent();
                          return d.status === "skipped" || d.status === "failed" ? d.detail : `Report sent. ${d.detail}`;
                        })
                      }
                    >
                      Send now
                    </button>
                    <button type="button" className="z-btn sm" onClick={() => startEdit(s)}>
                      Change
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="rp-toggle"
                  role="switch"
                  aria-checked={s.is_active}
                  aria-label={`${name} on`}
                  disabled={busy === s.id || (!pro && !s.is_active)}
                  onClick={() =>
                    void run(s.id, async () => {
                      await updateReportSchedule(s.id, { is_active: !s.is_active });
                      return s.is_active ? `${name} paused.` : `${name} on again.`;
                    })
                  }
                >
                  <span />
                </button>
                <button
                  type="button"
                  className="rp-icbtn"
                  style={{ width: 32, height: 32, borderColor: "transparent", color: "#6B6B6B" }}
                  aria-label={`Remove ${name}`}
                  disabled={busy === s.id}
                  onClick={() => {
                    if (!window.confirm(`Remove ${name}? Reports already sent stay in Sent.`)) return;
                    void run(s.id, async () => {
                      await deleteReportSchedule(s.id);
                      if (editing?.id === s.id) {
                        setEditing(null);
                        setDraft(fresh());
                      }
                      return `${name} removed.`;
                    });
                  }}
                >
                  ✕
                </button>
              </div>
            );
          })
        )}
      </section>

      <section className="z-card" aria-labelledby="new-h" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 id="new-h" style={{ margin: 0, fontSize: 17 }}>
          {editing ? `Change ${scheduleName(editing)}` : "New schedule"}
        </h2>
        {!pro ? (
          <PlanNote module="reports_pro" title="Scheduled reports">
            Get the team report, or each person's own, by email every day, week or month, without opening the dashboard.
          </PlanNote>
        ) : (
          <>
            {editing ? null : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {PRESETS.map((p) => {
                  const added = list.some(
                    (x) =>
                      x.member === null &&
                      x.frequency === p.frequency &&
                      x.send_hour === p.hour &&
                      (p.frequency !== "weekly" || x.weekday === p.weekday) &&
                      (p.frequency !== "monthly" || x.month_day === p.monthDay),
                  );
                  return (
                    <button
                      key={p.label}
                      type="button"
                      className="rp-preset"
                      disabled={added || busy === "form" || schedules.data === undefined}
                      aria-label={added ? `${p.label}, already scheduled` : `Add ${p.label}, ${p.sub}`}
                      onClick={() =>
                        void run("form", async () => {
                          const saved = await createReportSchedule({
                            member: null,
                            frequency: p.frequency,
                            weekday: p.weekday,
                            month_day: p.monthDay,
                            every_days: 14,
                            covers: coversFor(p.hour),
                            send_hour: p.hour,
                            send_to_owner: true,
                            send_to_members: false,
                            extra_emails: [],
                            include_csv: false,
                            is_active: true,
                          });
                          return `${p.label} added.${saved.next_run_at ? ` First report ${whenText(saved.next_run_at, today)}.` : ""}`;
                        })
                      }
                    >
                      <span aria-hidden="true">{added ? "✓" : "+"}</span>
                      <b>{p.label}</b>
                      <span className="rp-k">{added ? "Added" : p.sub}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div role="group" aria-label="How often" className="rp-segs rp-sfreq">
              {freqs.map(([f, label]) => (
                <button
                  key={f}
                  type="button"
                  className={draft.frequency === f ? "rp-seg on" : "rp-seg"}
                  aria-pressed={draft.frequency === f}
                  onClick={() => {
                    set({ frequency: f });
                    setCalOpen(false);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 15 }}>
              <span>Send</span>
              <select className="rp-isel" aria-label="Report about" value={draft.member ?? ""} onChange={(e) => set({ member: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Everyone</option>
                {aboutOpts.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <span>report</span>
              {draft.frequency === "custom" ? (
                <>
                  <span>on</span>
                  <span style={{ position: "relative" }}>
                    <button
                      type="button"
                      className="rp-isel rp-datebtn"
                      aria-haspopup="dialog"
                      aria-expanded={calOpen}
                      aria-label={`First send day, ${dMid(draft.start)}`}
                      onClick={() => setCalOpen(!calOpen)}
                    >
                      {draft.start === today ? "today" : dMid(draft.start)}
                      <span aria-hidden="true" style={{ fontSize: 10, color: "#6B6B6B" }}>
                        ▾
                      </span>
                    </button>
                    {calOpen ? (
                      <DatePicker
                        value={draft.start}
                        min={today}
                        max={shiftDay(today, START_AHEAD_DAYS)}
                        label="First send day"
                        onPick={(day) => {
                          set({ start: day });
                          setCalOpen(false);
                        }}
                        onClose={() => setCalOpen(false)}
                      />
                    ) : null}
                  </span>
                  <select className="rp-isel" aria-label="Repeat" value={draft.everyDays} onChange={(e) => set({ everyDays: Number(e.target.value) })}>
                    {repeats.map(([n, label]) => (
                      <option key={n} value={n}>
                        {n === 0 ? "once" : `then ${label}`}
                      </option>
                    ))}
                  </select>
                </>
              ) : null}
              {draft.frequency === "weekly" || draft.frequency === "monthly" ? (
                <>
                  <span>on</span>
                  {draft.frequency === "weekly" ? (
                    <select className="rp-isel" aria-label="Day" value={draft.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })}>
                      {WEEKDAYS.map((d, i) => (
                        <option key={d} value={i}>
                          {d}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select className="rp-isel" aria-label="Day" value={draft.monthDay} onChange={(e) => set({ monthDay: Number(e.target.value) })}>
                      {monthDays.map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              ) : null}
              <span>at</span>
              <select className="rp-isel" aria-label="Time" value={draft.hour} onChange={(e) => setHour(Number(e.target.value))}>
                {hours.map((h) => (
                  <option key={h} value={h}>
                    {clock(h)}
                  </option>
                ))}
              </select>
              <span>to</span>
              <div className="rp-emails">
                {draft.to.map((m) => (
                  <span key={m} className="rp-pill" style={{ background: "#F5F5F5", color: "#141210", padding: "2px 2px 2px 9px" }}>
                    {m}
                    <button
                      type="button"
                      aria-label={`Remove ${m}`}
                      onClick={() => set({ to: draft.to.filter((y) => y !== m) })}
                      style={{ border: 0, background: "none", padding: "0 6px", lineHeight: 1, fontSize: 13, color: "#6B6B6B" }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
                <input
                  type="email"
                  aria-label="Add email"
                  placeholder="Add email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  onKeyDown={emailKey}
                  onBlur={() => {
                    if (EMAIL.test(pending)) addPending();
                  }}
                />
              </div>
            </div>
            {draft.frequency === "daily" ? (
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 15 }}>
                <span id="sch-covers">Covers</span>
                <div role="group" aria-labelledby="sch-covers" className="rp-segs">
                  {(["today", "yesterday"] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={draft.covers === c ? "rp-seg on" : "rp-seg"}
                      aria-pressed={draft.covers === c}
                      onClick={() => set({ covers: c, coversSet: true })}
                    >
                      {c === "today" ? "Today's work" : "Yesterday's work"}
                    </button>
                  ))}
                </div>
                <span className="rp-k" style={{ fontSize: 13 }}>
                  {draft.covers === "today" ? "Best for an evening send, after the day ends." : "Best for a morning send."}
                </span>
              </div>
            ) : null}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 14px", alignItems: "center", borderTop: "1px solid #F5F5F5", paddingTop: 12 }}>
              <span className="rp-num" style={{ fontSize: 13 }}>
                {preview}
              </span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                {editing ? (
                  <button
                    type="button"
                    className="z-btn"
                    onClick={() => {
                      setEditing(null);
                      setDraft(fresh());
                    }}
                  >
                    Cancel
                  </button>
                ) : null}
                <button type="button" className="z-btn pri" disabled={busy === "form"} onClick={save}>
                  {busy === "form" ? "Saving…" : "Save"}
                </button>
              </span>
            </div>
          </>
        )}
      </section>
    </>
  );
}
