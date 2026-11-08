import { useState, type ReactElement } from "react";
import { errorMessage, type ChatReport } from "../../lib/api";
import { clockTime } from "../ui/time";
import { firstOf, whenLabel } from "./groupModel";
import { handleReport } from "./groupsSource";

/**
 * Reports (owner only, board DashChat "Reports" tile): a message a member reported to the owner, with their note.
 * Only that message comes here; the owner can't read the rest of a chat between members. Message either person, or
 * Mark as handled ("✓ Handled by you · 3:10 PM").
 */
export function ReportsPane({
  reports,
  loading,
  error,
  onRetry,
  onChanged,
  onMessage,
  people,
}: {
  reports: readonly ChatReport[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onChanged: (r: ChatReport) => void;
  /** Open the owner's own chat with a member. */
  onMessage: (memberId: number) => void;
  /** The team: the API names a reported line's writer by name only. */
  people: ReadonlyArray<{ memberId: number; name: string }>;
}): ReactElement {
  const [busy, setBusy] = useState<number | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const handle = async (r: ChatReport) => {
    setBusy(r.id);
    setFailed(null);
    try {
      onChanged(await handleReport(r.id));
    } catch (e) {
      setFailed(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="cv-thread cv-reports" role="log" aria-label="Reports">
      <p className="cv-reports__lede">
        When someone on your team reports a message, only that message comes here, with their note. You can’t read the rest of their chat, and the other person is told it was reported.
      </p>
      {error ? (
        <p role="alert" style={{ color: "#C0331C", margin: 0 }}>
          {error}{" "}
          <button type="button" className="zk-link" onClick={onRetry}>
            Try again
          </button>
        </p>
      ) : null}
      {failed ? (
        <p role="alert" style={{ color: "#C0331C", margin: 0 }}>
          {failed}
        </p>
      ) : null}
      {loading && !reports.length ? <p className="cv-reports__none">Loading reports…</p> : null}
      {!loading && !error && !reports.length ? <p className="cv-reports__none">No reports. When someone reports a message, it shows here.</p> : null}
      {reports.map((r) => {
        const from = r.reporter?.name ?? "Someone";
        const about = r.message?.by?.name ?? "";
        const aboutId = r.message?.by?.member_id ?? people.find((p) => p.name === about)?.memberId ?? null;
        return (
          <article key={r.id} className={`cv-report${r.handled_at ? " done" : ""}`}>
            <div className="cv-report__h">
              <b>
                {firstOf(from)} reported a message{about ? ` from ${firstOf(about)}` : ""}
              </b>
              <small>{whenLabel(r.created_at)}</small>
            </div>
            {r.message ? (
              <div className="cv-report__msg">
                <small>
                  {about ? firstOf(about) : "Message"} · {r.message.at ? clockTime(new Date(r.message.at)) : ""}
                  {r.conversation?.kind === "group" ? ` · in ${r.conversation.name}` : ""}
                </small>
                <span>{r.message.body}</span>
              </div>
            ) : null}
            {r.note ? (
              <p className="cv-report__note">
                <b>{firstOf(from)}’s note:</b> {r.note}
              </p>
            ) : null}
            <div className="cv-report__acts">
              {aboutId != null ? (
                <button type="button" className="z-btn sm" onClick={() => onMessage(aboutId)}>
                  Message {firstOf(about)}
                </button>
              ) : null}
              {r.reporter ? (
                <button type="button" className="z-btn sm" onClick={() => onMessage(r.reporter!.member_id)}>
                  Message {firstOf(from)}
                </button>
              ) : null}
              {r.handled_at ? (
                <span className="cv-report__done">✓ Handled by you · {clockTime(new Date(r.handled_at))}</span>
              ) : (
                <button type="button" className="z-btn sm pri" disabled={busy === r.id} onClick={() => void handle(r)}>
                  {busy === r.id ? "Saving…" : "Mark as handled"}
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
