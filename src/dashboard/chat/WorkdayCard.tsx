import type { ReactElement, ReactNode } from "react";
import { friendlyDuration } from "../../lib/format";
import { clockTime } from "../ui/time";
import type { WorkDecision } from "./system";
import type { WorkdaySpan } from "./workday";

/** "1:05 – 1:41 PM", or "11:50 AM – 12:20 PM" across noon. */
function range(from: string, to: string): string {
  const a = clockTime(new Date(from));
  const b = clockTime(new Date(to));
  const [at, ap] = a.split(" ");
  const [, bp] = b.split(" ");
  return ap === bp ? `${at} – ${b}` : `${a} – ${b}`;
}

function ClockMark(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" />
    </svg>
  );
}

/**
 * A break or End day decision in the thread (board LabChatWorkday): what happened (which break, from–to, how long, or
 * when they ended the day and how long they worked), their note, your decision with its time, your note as a quote,
 * and "Waiting for <first>’s reply" while a question has no answer yet. Without the work log it reads from the line.
 */
export function WorkdayCard({
  id,
  first,
  decision: d,
  span,
  at,
  waiting,
  flash,
  receipt,
}: {
  id: string;
  first: string;
  decision: WorkDecision;
  span: WorkdaySpan | null;
  /** When you sent the decision. */
  at: Date;
  waiting: boolean;
  flash: boolean;
  receipt: ReactNode;
}): ReactElement {
  const what = d.reason ? `${d.reason} break` : "Break";
  let title: string;
  const sub: string[] = [];
  let theirNote = "";
  if (span?.kind === "break") {
    title = `${first}’s ${what} · ${span.end ? range(span.start, span.end) : `from ${clockTime(new Date(span.start))}`}`;
    if (span.end) sub.push(friendlyDuration(span.seconds));
    theirNote = span.memberNote;
    if (!theirNote && d.decision === "asked") sub.push("no note");
  } else if (span?.kind === "end") {
    title = `${first} ended the day at ${clockTime(new Date(span.at))}`;
    if (span.reason) sub.push(span.reason);
    if (span.workedSeconds) sub.push(`worked ${friendlyDuration(span.workedSeconds)}`);
    theirNote = span.memberNote;
  } else {
    title = d.endDay ? `${first} ended the day at ${d.when}` : `${first}’s ${what} at ${d.when}`;
  }
  const approved = d.decision === "approved";
  return (
    <div id={id} className={`cv-wd${flash ? " flash" : ""}`}>
      <div className="cv-wd__top">
        <span className="cv-wd__ic">
          <ClockMark />
        </span>
        <span className="cv-wd__what">
          <b>{title}</b>
          {sub.length ? <span>{sub.join(" · ")}</span> : null}
        </span>
      </div>
      {theirNote ? (
        <p className="cv-wd__line">
          {first}’s note: “{theirNote}”
        </p>
      ) : null}
      <p className={`cv-wd__dec${approved ? " ok" : " ask"}`}>
        {approved ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          <i aria-hidden="true" />
        )}
        <span>
          {approved ? "You approved it" : "You asked about it"} · {clockTime(at)}
        </span>
        {receipt}
      </p>
      {d.note ? (
        <p className="cv-wd__quote">
          <b>You:</b> {d.note}
        </p>
      ) : null}
      {waiting ? <p className="cv-wd__wait">Waiting for {first}’s reply</p> : null}
    </div>
  );
}
