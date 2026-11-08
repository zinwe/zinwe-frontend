import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BREAK_NOTE_MAX, breakNoteLength, decideBreak, errorMessage, type Leave, type WorkLogEntry } from "../../lib/api";
import { AskSheet, type AskTarget } from "../alerts/AskSheet";
import { firstName, formatTime, KIND_ICON, type AlertView } from "../alerts/alertModel";
import { repeatLabel } from "../features/requests";
import { SAMPLES_ON } from "../fixtures";
import { useShell } from "../shell/shellContext";
import { LEVEL_DEF } from "../fixtures/majorAlerts";
import { dueOf, namesOf, personIn, stepInfo, type TTask } from "../tasks2/engine";
import type { TeamTasks } from "../tasks2/useTeamTasks";
import { dayGroup } from "../time";
import { SkRows } from "../ui/States";
import { decideLeaveRequest } from "../rules/rulesData";
import { leaveDay, leaveDoneText, leaveTitle } from "./leave";
import { needsLine } from "./needs";
import { TipBody, type TipRow } from "../ui/Tooltip";
import type { Tip } from "../ui/useTip";
import { ZIcon } from "../ui/ZIcon";

/** Needs you shows this many, then "Show all (N)". */
const NEEDS_FIRST = 7;

const ICON = {
  task: "M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM8.5 12.5l2.5 2.5 4.5-5",
  clock: "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  out: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  leave: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
};

/** What each level pill in Needs you means (its tooltip). */
const LEVEL_TEXT: Record<string, string> = {
  "Needs you": LEVEL_DEF.needs,
  "Waiting for your OK": "a break or an early End day that needs your Approve or Not approved.",
  Leave: "a day or half day off they asked for in their Zinwe window. Approve or Decline; they see your answer there, and reports count an approved day as Leave.",
  "Task · Needs help": "they asked for help from their Zinwe app. Reply on the task.",
  "Task · Waiting for your OK": "they marked it done. Approve it, or open it to reopen it with a note.",
  "Task · Can’t do it": "they told you they can't do it. Give it to someone else, or reply.",
};

const TONE = {
  alert: { bg: "#FCE8E4", fg: "#C0331C" },
  request: { bg: "#FDEBDC", fg: "#A84505" },
  task: { bg: "#FDEBDC", fg: "#8A3A04" },
} as const;

interface Need {
  id: string;
  tone: keyof typeof TONE;
  icon: string;
  title: string;
  level: string;
  /** Tooltip key when it differs from the pill's words (tasks: "Task · …"). */
  tipKey?: string;
  meta: string;
  /** The detail sentence: screen-reader text on the row and the title's tooltip. */
  body: string;
  tip: ReactNode;
  ask?: { label: string; reply?: string };
  actions: ReactNode;
  note?: ReactNode;
}

interface Last {
  text: string;
  undo?: () => void;
}

function minutesSince(iso: string, now: number): number {
  return Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
}

/**
 * Needs you (DashOverview): everything waiting on the owner, in a fixed order — requests waiting for your OK
 * (real work-log breaks and early End days), then leave requests (v1.4.1), then Needs you alerts not yet marked as fine (real), then task
 * sign-offs (FR-20: they need help, or finished and wait for your OK). One compact row each; 7 shown, then Show all (N).
 */
export function NeedsCard({
  requests,
  leave,
  alerts,
  tasks,
  team,
  worthText,
  canAsk,
  now,
  tip,
  onMark,
  onRequestsChanged,
  onLeaveChanged,
}: {
  requests: WorkLogEntry[] | undefined;
  /** Leave requests waiting for a decision (v1.4.1); Approve / Decline run here. */
  leave?: Leave[];
  alerts: AlertView[] | undefined;
  /** Team tasks (v1.4); `team` runs Approve in place. */
  tasks: TTask[] | undefined;
  team?: TeamTasks;
  /** "166 more alerts are worth a look" (null while loading). */
  worthText: string | null;
  canAsk: boolean;
  now: number;
  tip: Tip;
  /** Mark an alert row as fine (true) or open it again (false). */
  onMark: (view: AlertView, handled: boolean) => Promise<void>;
  onRequestsChanged: () => void;
  onLeaveChanged?: () => void;
}): ReactElement {
  const [all, setAll] = useState(false);
  // Decisions live in the shell (F-02): one made here, on Today's activity or anywhere else hides the row everywhere.
  const { decided, markDecided } = useShell();
  const [noting, setNoting] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [last, setLast] = useState<Last | null>(null);
  const [ask, setAsk] = useState<AskTarget | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  // Leave decided here: off the list at once, before the next load.
  const [leaveDone, setLeaveDone] = useState<ReadonlySet<number>>(() => new Set());

  useEffect(() => {
    if (!last) return;
    const id = window.setTimeout(() => setLast(null), 8000);
    return () => window.clearTimeout(id);
  }, [last]);

  const setRowBusy = (id: string, on: boolean) =>
    setBusy((b) => {
      const next = new Set(b);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const decide = async (r: WorkLogEntry, decision: "approved" | "denied", what: string) => {
    const first = firstName(r.member_name) || "They";
    const note = decision === "denied" ? (notes[r.id] ?? "").trim() : "";
    markDecided(r.id, decision);
    setNoting(null);
    try {
      await decideBreak(r.id, decision, note);
      setLast({
        text:
          decision === "approved"
            ? `Approved ${first}’s ${what}.`
            : `Not approved: ${first}’s ${what}${note ? ", with your note." : "."} ${first} sees it in the Zinwe app.`,
      });
      onRequestsChanged();
    } catch (err) {
      markDecided(r.id, null);
      setLast({ text: `Couldn't save: ${errorMessage(err)}` });
    }
  };

  // ---- Requests waiting for your OK ----
  const reqItems: Need[] = (requests ?? [])
    .filter((r) => r.approval === "pending" && !decided[r.id])
    .map((r) => {
      const name = r.member_name || r.hostname || "Someone";
      const first = firstName(r.member_name) || name;
      const isBreak = r.state === "on_break";
      const what = isBreak ? "break" : "early end of day";
      const at = formatTime(r.at);
      const mins = minutesSince(r.at, now);
      const quote = r.note ? `“${r.note}”` : "";
      // "2nd break today · 2:10 PM": a second request doesn't read like the approved one coming back.
      const again = repeatLabel(r, requests ?? []);
      const noteId = `ov-note-${r.id}`;
      const noteText = notes[r.id] ?? "";
      const tooLong = breakNoteLength(noteText) > BREAK_NOTE_MAX;
      const rows: TipRow[] = isBreak
        ? [
            { label: "On break since", value: at },
            { label: "So far", value: `${mins} min` },
          ]
        : [{ label: "Pressed End day", value: at }];
      if (isBreak && r.reason) rows.unshift({ label: "Reason", value: r.reason });
      return {
        id: `req-${r.id}`,
        tone: "request",
        icon: isBreak ? ICON.clock : ICON.out,
        title: isBreak
          ? `${first} wants ${r.reason ? `a ${r.reason.toLowerCase()} break` : "a break"} approved`
          : `${first} ended the day early`,
        level: "Waiting for your OK",
        meta: again
          ? `${again} · ${name} · ${isBreak ? `${mins} min so far` : r.hostname || "PC"}`
          : `${name} · ${r.hostname || "PC"} · ${isBreak ? `since ${at} (${mins} min)` : at}`,
        body: isBreak
          ? `Took a break at ${at}${quote ? `: ${quote}` : ""}. ${mins} min so far.`
          : `Pressed End day at ${at}${quote ? `: ${quote}` : "."}`,
        tip: <TipBody rows={rows} text={quote || undefined} hint={`${first} sees your answer in the Zinwe app`} />,
        actions:
          noting === r.id ? null : (
            <>
              <button type="button" className="z-btn xs green" aria-label={`Approve ${first}’s ${what}`} onClick={() => void decide(r, "approved", what)}>
                Approve
              </button>
              <button
                type="button"
                className="z-btn xs"
                aria-label={`Do not approve ${first}’s ${what}, add an optional note`}
                onClick={() => setNoting(r.id)}
              >
                Not approved
              </button>
            </>
          ),
        note:
          noting === r.id ? (
            <div className="zn-ov-note">
              <label htmlFor={noteId} className="z-sr">
                Note for {first} (optional)
              </label>
              <input
                id={noteId}
                value={noteText}
                placeholder={`Note for ${first} (optional)`}
                onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                aria-invalid={tooLong || undefined}
              />
              <button type="button" className="z-btn xs dark" disabled={tooLong} onClick={() => void decide(r, "denied", what)}>
                Send
              </button>
              <button type="button" className="z-btn xs" onClick={() => setNoting(null)}>
                Cancel
              </button>
              {tooLong ? <span className="z-err">Keep it under {BREAK_NOTE_MAX} characters.</span> : null}
            </div>
          ) : undefined,
      };
    });

  // ---- Leave requests waiting for a decision (v1.4.1) ----
  const decideLv = async (l: Leave, decision: "approve" | "decline") => {
    const key = `leave-${l.id}`;
    setRowBusy(key, true);
    try {
      await decideLeaveRequest(l.id, decision);
      setLeaveDone((d) => new Set(d).add(l.id));
      setLast({ text: leaveDoneText(l, decision) });
      onLeaveChanged?.();
    } catch (err) {
      setLast({ text: `Couldn't save: ${errorMessage(err)}` });
    } finally {
      setRowBusy(key, false);
    }
  };
  const leaveItems: Need[] = (leave ?? [])
    .filter((l) => l.status === "requested" && !leaveDone.has(l.id))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((l) => {
      const key = `leave-${l.id}`;
      const name = l.member_name?.trim() || "Someone";
      const first = firstName(l.member_name) || name;
      const title = leaveTitle(l, now);
      const kind = l.half ? "Half day" : "Full day";
      const note = l.note.trim();
      const quote = note ? `“${note.replace(/[.\s]+$/, "")}”` : "";
      return {
        id: key,
        tone: "request",
        icon: ICON.leave,
        title,
        level: "Waiting for your OK",
        tipKey: "Leave",
        meta: [quote, kind].filter(Boolean).join(" · "),
        body: `${title}.${quote ? ` ${quote}` : ""}`,
        tip: (
          <TipBody
            rows={[
              { label: "Day", value: leaveDay(l.date, now).replace(/^./, (c) => c.toUpperCase()) },
              { label: "Asked for", value: kind },
            ]}
            text={quote || undefined}
            hint={`${first} sees your answer in the Zinwe window`}
          />
        ),
        actions: (
          <>
            <button type="button" className="z-btn xs green" aria-label={`Approve ${first}’s leave`} disabled={busy.has(key)} onClick={() => void decideLv(l, "approve")}>
              Approve
            </button>
            <button type="button" className="z-btn xs" aria-label={`Decline ${first}’s leave`} disabled={busy.has(key)} onClick={() => void decideLv(l, "decline")}>
              Decline
            </button>
          </>
        ),
      };
    });

  // ---- Needs you alerts not yet marked as fine ----
  const alertItems: Need[] = (alerts ?? [])
    .filter((a) => !a.done && a.level === "needs")
    .map((a) => {
      const key = `al-${a.id}`;
      const asked = !!a.ask;
      const reply = a.ask?.reply;
      const day = dayGroup(a.latest.occurred_at, now).label;
      const fine = (dark: boolean) => (
        <button
          type="button"
          className={`z-btn xs${dark ? " dark" : ""}`}
          aria-label={`Mark as fine: ${a.title}`}
          disabled={busy.has(key)}
          onClick={async () => {
            setRowBusy(key, true);
            try {
              await onMark(a, true);
              setLast({
                text: `Marked “${a.title}” as fine.`,
                undo: () => {
                  setLast(null);
                  void onMark(a, false);
                },
              });
            } catch (err) {
              setLast({ text: `Couldn't save: ${errorMessage(err)}` });
            } finally {
              setRowBusy(key, false);
            }
          }}
        >
          Mark as fine
        </button>
      );
      const chat = (
        <Link className="z-btn xs" to={`/app/chat#m=${a.first.toLowerCase()}`} aria-label={`Open your chat with ${a.first}`}>
          Open chat
        </Link>
      );
      const askBtn =
        a.person && canAsk ? (
          <button
            type="button"
            className="z-btn xs dark"
            aria-label={`Ask ${a.first} about: ${a.title}`}
            aria-haspopup="dialog"
            onClick={() => {
              tip.hide();
              setAsk({
                ids: a.ids,
                memberId: a.person?.id ?? 0,
                first: a.first,
                title: a.title,
                severity: "critical",
                draft: a.draft,
              });
            }}
          >
            Ask {a.first}
          </button>
        ) : null;
      return {
        id: key,
        tone: "alert",
        icon: KIND_ICON[a.kind],
        title: a.title,
        level: "Needs you",
        meta: `${a.person?.name ?? "No one linked"} · ${a.pc} · ${day === "Today" ? a.time : `${day}, ${a.time}`}`,
        body: `${a.body}${reply ? ` ${a.first} replied at ${reply.at}: “${reply.text}”` : ""}`,
        tip: (
          <TipBody
            rows={[
              ...(a.limit ? [{ label: "Size", value: a.limit.text.split(" · ")[0].replace(" copied", "") }] : []),
              ...(a.count > 1 ? [{ label: "Times", value: String(a.count) }] : []),
              { label: "PC", value: a.pc },
            ]}
            text={a.body}
          />
        ),
        ask: asked ? { label: reply ? "Asked · replied" : "Asked · waiting for reply", reply: reply ? `${a.first}, ${reply.at}: “${reply.text}”` : undefined } : undefined,
        actions: asked ? (
          <>
            {fine(true)}
            {chat}
          </>
        ) : (
          <>
            {askBtn}
            {fine(false)}
          </>
        ),
      };
    });

  // ---- Tasks waiting on you (v1.4, DashHome): your OK, a reply, or a decision on "can't do it"; soonest due first ----
  const taskItems: Need[] = (tasks ?? [])
    .filter((t) => t.status === "review" || t.status === "help" || t.status === "cantdo")
    .sort((x, y) => (x.dueAt ?? Number.MAX_SAFE_INTEGER) - (y.dueAt ?? Number.MAX_SAFE_INTEGER))
    .map((t) => {
      const dir = team?.dir;
      const first = (k: string | undefined) => (dir && k ? personIn(dir, k).first : "") || "They";
      const info = stepInfo(t);
      const stepsTxt = info.n ? `${info.done} of ${info.n} steps` : "";
      const due = dueOf(t, now);
      const dueTxt = due.d === null ? "" : `due ${due.short.charAt(0).toLowerCase()}${due.short.slice(1)}`;
      const help = t.status === "help";
      const cant = t.status === "cantdo";
      const many = t.people.length > 1;
      const who = help ? first(t.help?.who) : cant ? first(t.cantdo?.who) : first(t.people[0]);
      const quote = (x: string | undefined) => `“${(x ?? "").replace(/[.\s]+$/, "")}”`;
      const meta = help
        ? [`${who} asks: ${quote(t.help?.text)}`, stepsTxt].filter(Boolean).join(" · ")
        : cant
          ? [`${who}: ${quote(t.cantdo?.text)}`, t.high ? "High priority" : dueTxt].filter(Boolean).join(" · ")
          : many
            ? ["Everyone is done", t.people.map((k) => first(k)).join(", "), stepsTxt].filter(Boolean).join(" · ")
            : [`${who} is done`, stepsTxt, dueTxt].filter(Boolean).join(" · ");
      const rows: TipRow[] = [];
      if (info.n) rows.push({ label: "Steps", value: `${info.done} of ${info.n}` });
      if (due.d !== null) rows.push({ label: "Due", value: due.short });
      if (dir) rows.push({ label: many ? "People" : "Person", value: namesOf(dir, t.people) });
      const key = `task-${t.id}`;
      const openLink = (
        <Link className="z-btn xs" to={`/app/tasks?open=${t.id}`} aria-label={`Open the task: ${t.title}`}>
          Open
        </Link>
      );
      return {
        id: key,
        tone: "task",
        icon: ICON.task,
        title: t.title,
        level: help ? "Needs help" : cant ? "Can’t do it" : "Waiting for your OK",
        tipKey: help ? "Task · Needs help" : cant ? "Task · Can’t do it" : "Task · Waiting for your OK",
        meta,
        body: help ? `${who} asked for help on this task.` : cant ? `${who} cannot do this task.` : `${many ? "Everyone" : who} finished the task. Check it and give your OK.`,
        tip: <TipBody title={t.title} rows={rows} text={help ? quote(t.help?.text) : cant ? quote(t.cantdo?.text) : undefined} />,
        actions: help ? (
          <>
            <Link className="z-btn xs green" to={`/app/tasks?open=${t.id}&act=reply`} aria-label={`Reply to ${who}: ${t.title}`}>
              Reply
            </Link>
            {openLink}
          </>
        ) : cant ? (
          <>
            <Link className="z-btn xs green" to={`/app/tasks?open=${t.id}&act=reassign`} aria-label={`Give ${t.title} to someone else`}>
              Reassign
            </Link>
            {openLink}
          </>
        ) : (
          <>
            {team ? (
              <button
                type="button"
                className="z-btn xs green"
                aria-label={`Approve: ${t.title}`}
                disabled={busy.has(key)}
                onClick={async () => {
                  setRowBusy(key, true);
                  try {
                    await team.act.action(t.id, { action: "approve" });
                    setLast({ text: `Approved. ${dir ? namesOf(dir, t.people) : who} see${t.people.length === 1 ? "s" : ""} it in the Zinwe app.` });
                  } catch (err) {
                    setLast({ text: `Couldn't save: ${errorMessage(err)}` });
                  } finally {
                    setRowBusy(key, false);
                  }
                }}
              >
                Approve
              </button>
            ) : null}
            {openLink}
          </>
        ),
      };
    });

  const left = [...reqItems, ...leaveItems, ...alertItems, ...taskItems];
  const loading = requests === undefined && alerts === undefined && tasks === undefined;
  const shown = all ? left : left.slice(0, NEEDS_FIRST);

  return (
    <section id="needs" className="z-card zn-ov-needs" aria-labelledby="needs-h" data-tip-bound="needs">
      <div style={{ flex: "none" }}>
        <h2 id="needs-h" className="zn-ov-h2">
          Needs you
        </h2>
        <span className="z-num" style={{ fontSize: 13, color: "#404040", fontWeight: 600 }}>
          {loading ? "Loading…" : needsLine(left.length, reqItems.length + leaveItems.length, alertItems.length, taskItems.length)}
        </span>
      </div>
      <div id="needs-list" className="zn-ov-needs-list">
        {loading ? (
          <SkRows label="Loading what needs you" rows={4} />
        ) : left.length === 0 ? (
          <div className="zn-ov-clear">
            <span aria-hidden="true">
              <ZIcon name="check" size={20} stroke={2.6} />
            </span>
            <b>Nothing needs you right now.</b>
          </div>
        ) : (
          shown.map((n) => {
            const tone = TONE[n.tone];
            const lead = n.level.replace("Task · ", "");
            return (
              <article key={n.id} className="zn-need">
                <span className="zn-need-ico" style={{ background: tone.bg, color: tone.fg }} aria-hidden="true">
                  <ZIcon d={n.icon} size={15} stroke={2} />
                </span>
                <div className="zn-need-main">
                  <div className="zn-need-top">
                    <span className="zn-need-t zn-help" tabIndex={0} {...tip.anchor(`need-${n.id}`, n.tip)}>
                      {n.title}
                    </span>
                    <span
                      className="z-pill zn-help"
                      tabIndex={0}
                      style={{ background: tone.bg, color: tone.fg }}
                      {...tip.anchor(`lv-${n.id}`, <TipBody text={<><b>{lead}</b> — {LEVEL_TEXT[n.tipKey ?? n.level]}</>} />)}
                    >
                      {n.level}
                    </span>
                  </div>
                  <span className="z-ell zn-need-meta">{n.meta}</span>
                  {n.ask ? (
                    <div className="zn-need-ask">
                      <span className="z-pill blue">{n.ask.label}</span>
                      {n.ask.reply ? <span style={{ fontSize: 13, lineHeight: "18px", color: "#404040", minWidth: 0 }}>{n.ask.reply}</span> : null}
                    </div>
                  ) : null}
                  <span className="z-sr">{n.body}</span>
                </div>
                {n.actions ? <div className="zn-need-act">{n.actions}</div> : null}
                {n.note ?? null}
              </article>
            );
          })
        )}
      </div>
      {last ? (
        <div role="status" className="zn-ov-toast">
          <span>{last.text}</span>
          {last.undo ? (
            <button type="button" onClick={last.undo}>
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="zn-ov-foot">
        <span style={{ color: "#6B6B6B" }}>{worthText ?? ""}</span>
        <span className="zn-ov-foot-r">
          <Link to="/app/alerts" style={{ fontWeight: 600 }}>
            Open Alerts →
          </Link>
          {left.length > NEEDS_FIRST ? (
            <button type="button" className="z-btn xs" aria-expanded={all} aria-controls="needs-list" onClick={() => setAll((v) => !v)}>
              {all ? "Show fewer" : `Show all (${left.length})`}
            </button>
          ) : null}
        </span>
      </div>
      <AskSheet
        target={ask}
        where="here"
        onClose={() => setAsk(null)}
        onSent={(t) => {
          setAsk(null);
          setLast({ text: `Sent to ${t.first}’s Zinwe app. The reply shows ${SAMPLES_ON ? "here and " : ""}in Chat.` });
        }}
      />
    </section>
  );
}
