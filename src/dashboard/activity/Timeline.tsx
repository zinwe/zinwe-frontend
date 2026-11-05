import { useState, type ReactElement, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { PersonDay } from "../features/workDay";
import type { SecondPc } from "../fixtures/pcs";
import { hm, hmDuration, hmOfMinutes } from "../team/format";
import { TipBody } from "../ui/Tooltip";
import type { Tip } from "../ui/useTip";
import { lengthLabel, segmentsOf, sumsOf, windowOf, type DayInfo, type DayRow, type LocalDecision } from "./model";

interface Line {
  at: number;
  t: string;
  what: string;
  note: ReactNode;
  color: string;
  /** A decision given earlier that the owner can change. */
  changeId?: number;
}

const WORK = "#17663F";
const BREAK = "#A84505";
const END = "#6B6B6B";

function approvalText(approval: string, decisionNote: string, local: LocalDecision | undefined): string {
  if (local) return local.val === "approved" ? "Approved by you" : `Not approved${local.note ? `: “${local.note}”` : ""}`;
  if (approval === "pending") return "Waiting for your OK";
  if (approval === "approved") return `Approved by you${decisionNote ? `: “${decisionNote}”` : ""}`;
  if (approval === "denied") return `Not approved${decisionNote ? `: “${decisionNote}”` : ""}`;
  return "";
}

function linesOf(p: PersonDay, isToday: boolean, decisions: Record<number, LocalDecision>, second: SecondPc | undefined, day: string): Line[] {
  const lines: Line[] = [];
  let started = false;
  for (const item of p.timeline) {
    const at = Date.parse(item.at);
    if (item.kind === "carry") {
      const onBreak = item.state === "on_break";
      lines.push({
        at,
        t: "12:00 AM",
        what: onBreak ? "Still on a break from yesterday" : "Still working from yesterday",
        note: item.since ? `${onBreak ? "Break" : "Started day"} at ${hm(item.since)} yesterday; the time after midnight counts on this day` : "",
        color: onBreak ? BREAK : WORK,
      });
    } else if (item.kind === "start") {
      lines.push({ at, t: hm(item.at), what: "Started day", note: started ? "" : `From ${p.hostname}`, color: WORK });
      started = true;
    } else if (item.kind === "back") {
      lines.push({ at, t: hm(item.at), what: "Back from break", note: "", color: WORK });
    } else if (item.kind === "moved") {
      const left = item.leftOff ? `; ${item.from} was last on at ${hm(item.leftOff)}` : "";
      lines.push({ at, t: hm(item.at), what: `Moved to ${item.to}`, note: `From ${item.from}${left}`, color: WORK });
    } else if (item.kind === "break") {
      const b = p.breaks.find((x) => x.start === item.at);
      const parts = [
        b ? (b.end ? hmDuration(b.seconds, "0 min") : `${hmDuration(b.seconds, "0 min")} so far`) : "",
        b ? approvalText(b.approval, b.decisionNote, decisions[b.id]) : "",
        b?.note ? `“${b.note}”` : "",
      ].filter(Boolean);
      lines.push({
        at,
        t: hm(item.at),
        what: `Took a break: ${item.reason || "No reason given"}`,
        note: parts.join(" · "),
        color: BREAK,
        changeId: b && !decisions[b.id] && (b.approval === "approved" || b.approval === "denied") ? b.id : undefined,
      });
    } else {
      const l = p.logouts.find((x) => x.at === item.at);
      const parts = [l ? approvalText(l.approval, l.decisionNote, decisions[l.id]) : "", item.note ? `“${item.note}”` : ""].filter(Boolean);
      lines.push({
        at,
        t: hm(item.at),
        what: `Ended day${item.reason ? `: ${item.reason}` : ""}`,
        note: parts.join(" · "),
        color: END,
        changeId: l && !decisions[l.id] && (l.approval === "approved" || l.approval === "denied") ? l.id : undefined,
      });
    }
  }
  // Sample (FR-36): the board's "Connected a second PC" line, on today's timeline of the person who has one.
  if (second && isToday && lines.length) {
    const [y, m, d] = day.split("-").map(Number);
    const at = new Date(y, m - 1, d, 11, 5).getTime();
    if (at <= Date.now()) {
      lines.push({ at, t: second.connectedAt, what: "Connected a second PC", note: `${second.name} joined; the day keeps running on ${p.hostname}`, color: "#404040" });
      lines.sort((a, b) => a.at - b.at);
    }
  }
  return lines;
}

/** The selected person's day (DashActivity aside): day strip + timeline. */
export function Timeline({
  row,
  day,
  info,
  isToday,
  now,
  decisions,
  second,
  tip,
  onChange,
}: {
  row: DayRow | undefined;
  day: string;
  info: DayInfo;
  isToday: boolean;
  now: number;
  decisions: Record<number, LocalDecision>;
  second: SecondPc | undefined;
  tip: Tip;
  onChange: (id: number) => void;
}): ReactElement {
  const [hot, setHot] = useState<number | null>(null);
  if (!row) {
    return (
      <aside id="timeline" className="z-card za-tl" aria-label="Timeline">
        <span className="za-muted">Select a name to see their day.</span>
      </aside>
    );
  }
  const p = row.person;
  const lines = p ? linesOf(p, isToday, decisions, second, day) : [];
  const segs = segmentsOf(p, day, isToday, now);
  // Someone who isn't in gets no tiles; a break still running counts up to now (its part ends at now).
  const sums = p ? sumsOf(p, segs) : null;
  const [y, m, d] = day.split("-").map(Number);
  const nowMin = isToday ? (now - new Date(y, m - 1, d).getTime()) / 60_000 : null;
  const { d0, d1, ticks } = windowOf(segs, nowMin);
  const pct = (min: number) => Math.max(0, Math.min(100, ((min - d0) / (d1 - d0)) * 100));
  const fill = (k: "work" | "break") => (k === "work" ? { background: WORK } : { background: "#FDEBDC", boxShadow: "inset 0 0 0 1.5px #A84505" });
  const nameOf = (s: (typeof segs)[number]) => (s.kind === "work" ? "Working" : `On a break: ${s.why}`);

  return (
    <aside id="timeline" className="z-card za-tl" aria-label="Timeline">
      <div className="za-tl__head">
        <h2>{row.name}</h2>
        {row.memberId != null ? (
          <Link to={`/app/chat/${row.memberId}`} className="za-chat">
            Chat with {row.first}
          </Link>
        ) : null}
      </div>
      <span className="za-muted">
        {row.pc} · {info.short}
      </span>
      {sums ? (
        <div className="za-sums" role="group" aria-label={`${row.first}’s day in numbers`}>
          <div className="za-sum">
            <span>Worked {info.short}</span>
            <b className="z-num">
              {hmDuration(sums.workMin * 60, "0 min")}
              {p?.openEnded ? <span aria-hidden="true">*</span> : null}
            </b>
          </div>
          <div className="za-sum">
            <span>Breaks</span>
            {sums.breaks ? (
              <b className="z-num">
                <span className="za-sum__v">{hmDuration(sums.breakMin * 60, "0 min")}</span>{" "}
                <span className="za-sum__n">
                  <span className="za-sum__dot">· </span>
                  {sums.breaks} {sums.breaks === 1 ? "break" : "breaks"}
                </span>
              </b>
            ) : (
              <b>{isToday ? "None yet" : "None"}</b>
            )}
          </div>
        </div>
      ) : null}
      {segs.length > 0 ? (
        <div className="za-strip-wrap">
          <div
            className="za-strip"
            role="group"
            aria-label={`${row.first}’s day, ${info.tip}, ${hmOfMinutes(d0)} to ${hmOfMinutes(d1)}. ${segs.length} parts; move through them with Tab.`}
            onMouseLeave={() => {
              setHot(null);
              tip.hide();
            }}
          >
            {segs.map((s, i) => {
              const toTxt = s.live ? "now" : hmOfMinutes(s.to);
              const length = `${s.live ? "so far " : ""}${lengthLabel(s.to - s.from)}`;
              const content = (
                <TipBody
                  title={nameOf(s)}
                  color={s.kind === "work" ? WORK : "#FDEBDC"}
                  sub={`${row.first} · ${info.tip}`}
                  rows={[
                    { label: "From", value: hmOfMinutes(s.from) },
                    { label: "To", value: toTxt },
                    { label: "Length", value: length },
                  ]}
                  hint={s.waiting ? `Waiting for your OK: Approve or Not approved in ${row.first}’s row` : undefined}
                />
              );
              const show = (el: HTMLElement) => {
                setHot(i);
                tip.showAt(`seg-${i}`, content, el.getBoundingClientRect(), { wide: true });
              };
              return (
                <span
                  key={`${s.from}-${i}`}
                  className="za-seg"
                  tabIndex={0}
                  role="img"
                  aria-label={`${nameOf(s)}, ${hmOfMinutes(s.from)} to ${toTxt}, ${length}`}
                  onMouseEnter={(e) => show(e.currentTarget)}
                  onFocus={(e) => show(e.currentTarget)}
                  onBlur={() => {
                    setHot(null);
                    tip.hide();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setHot(null);
                      tip.hide();
                    }
                  }}
                  style={{
                    left: `${pct(s.from)}%`,
                    width: `max(3px, ${pct(s.to) - pct(s.from)}%)`,
                    ...fill(s.kind),
                    opacity: hot !== null && hot !== i ? 0.35 : 1,
                  }}
                />
              );
            })}
            {nowMin !== null ? <span aria-hidden="true" className="za-now" style={{ left: `${pct(nowMin)}%` }} /> : null}
          </div>
          <div aria-hidden="true" className="za-ticks">
            <span style={{ left: 0 }}>{hmOfMinutes(d0).replace(":00", "")}</span>
            {ticks.map((t) => (
              <span key={t} style={{ left: `${pct(t)}%`, transform: "translateX(-50%)" }}>
                {hmOfMinutes(t).replace(":00", "")}
              </span>
            ))}
            <span style={{ right: 0 }}>{d1 >= 1440 ? "12 AM" : hmOfMinutes(d1).replace(":00", "")}</span>
          </div>
          <div aria-hidden="true" className="za-legend">
            <span>
              <i style={{ background: WORK }} />
              Working
            </span>
            <span>
              <i style={{ background: "#FDEBDC", boxShadow: "inset 0 0 0 1.5px #A84505" }} />
              On a break
            </span>
            {nowMin !== null ? (
              <span>
                <i style={{ width: 2, height: 12, background: "#F26A0A", borderRadius: 0 }} />
                Now, {hmOfMinutes(nowMin)}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
      <ol className="za-events">
        {lines.map((e, i) => (
          <li key={`${e.at}-${i}`}>
            <span className="za-rail">
              <span className="za-dot" style={{ background: e.color }} />
              <span className="za-line" />
            </span>
            <span className="za-ev">
              <span className="z-num z-mono za-t">{e.t}</span>
              <br />
              <b>{e.what}</b>
              {e.note || e.changeId ? <br /> : null}
              <span className="za-evnote">
                {e.note}
                {e.changeId ? (
                  <>
                    {e.note ? " · " : ""}
                    <button type="button" className="za-linkbtn" onClick={() => onChange(e.changeId as number)}>
                      Change
                    </button>
                  </>
                ) : null}
              </span>
            </span>
          </li>
        ))}
      </ol>
      {lines.length === 0 ? <span className="za-muted">Did not press Start day this day.</span> : null}
      {p?.openEnded ? (
        <p className="za-daynote za-warn">
          * No log-out was recorded{p.openEndedFrom ? ` after ${hm(p.openEndedFrom)}` : ""}, so that time isn’t counted; they probably
          forgot to press Log out. Ask them if you need the exact finish time.
        </p>
      ) : null}
      {p?.continues && !isToday ? <p className="za-daynote">Still going at midnight: the time after midnight counts on the next day.</p> : null}
    </aside>
  );
}
