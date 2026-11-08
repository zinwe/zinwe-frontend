import { useState, type KeyboardEvent, type MouseEvent, type ReactElement } from "react";
import { errorMessage } from "../../lib/api";
import { dueOf, happen, journey, namesOf, personIn, pillOf, when, type TTask } from "./engine";
import { runDirect } from "./actions";
import { Av, Avs, IcChat, IcSend, type OpenOpts, type PanelCard, type Say } from "./parts";
import type { TeamTasks } from "./useTeamTasks";

const CARD_OF: Record<string, PanelCard> = { reply: "reply", reopen: "reopen", reassign: "reassign", due: "due" };

/** Chat icon + count (unread dot) for a row or card: opens the task chat. */
export function ChatCount({ t, onOpen, size = 14 }: { t: TTask; onOpen: (id: number, opts?: OpenOpts) => void; size?: number }): ReactElement {
  const n = t.chat.count;
  const u = t.chat.unread;
  return (
    <button
      type="button"
      className="tv-cc"
      data-unread={u ? "true" : "false"}
      aria-label={`Task chat: ${n} ${n === 1 ? "message" : "messages"}${u ? `, ${u} new` : ""}`}
      title="Task chat"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(t.id, { tab: "chat" });
      }}
    >
      <IcChat size={size} />
      {n > 0 ? <span>{n}</span> : null}
    </button>
  );
}

/** The one primary button of a row or card (the "What's happening" card's first button). */
export function PrimaryButton({ t, team, onOpen, say }: { t: TTask; team: TeamTasks; onOpen: (id: number, opts?: OpenOpts) => void; say?: Say }): ReactElement | null {
  const [busy, setBusy] = useState(false);
  const b = happen(t, team.dir, team.now).btns.find((x) => !x.off);
  if (!b) return null;
  const go = async (e: MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    const done = await runDirect(team, t, b.act, say ?? (() => undefined));
    setBusy(false);
    if (!done) onOpen(t.id, { card: CARD_OF[b.act] ?? null });
  };
  return (
    <button type="button" className={b.pri ? "tv-btn sm pri" : "tv-btn sm"} disabled={busy} onClick={(e) => void go(e)}>
      {b.label}
    </button>
  );
}

/**
 * The compact task card (board view, phone list, chat threads): blocks A–D of the panel — pill, due, title, the
 * short "What's happening" line, the mini journey bar, faces, chat count and the one primary button. `thread` adds
 * the footer used in chat: the last reply, "N replies", "Open task chat" and a reply box (it goes into the task chat).
 */
export function TaskCard({
  task: t,
  team,
  onOpen,
  thread = false,
  flash = false,
  say,
}: {
  task: TTask;
  team: TeamTasks;
  /** Open the task panel (optionally on its Chat tab, or with an inline card such as Reply). */
  onOpen: (id: number, opts?: OpenOpts) => void;
  thread?: boolean;
  flash?: boolean;
  say?: Say;
}): ReactElement {
  const { dir, now } = team;
  const h = happen(t, dir, now);
  const pill = pillOf(t);
  const due = dueOf(t, now);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");
  const tell: Say = say ?? (() => undefined);

  const send = async () => {
    const x = reply.trim();
    if (!x || busy) return;
    setBusy(true);
    try {
      await team.act.say(t.id, x);
      setReply("");
    } catch (err) {
      tell(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const openChat = (e: MouseEvent) => {
    e.stopPropagation();
    onOpen(t.id, { tab: "chat" });
  };
  const last = t.chat.last;
  const n = t.chat.count;
  const u = t.chat.unread;

  return (
    <article
      className={`tv-card${flash ? " tv-flash" : ""}`}
      data-tone={h.tone}
      aria-label={t.title}
      tabIndex={0}
      onClick={() => onOpen(t.id)}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen(t.id);
        }
      }}
    >
      <div className="tv-card__top">
        <span className="tv-pill" data-tone={pill.tone}>
          {pill.label}
        </span>
        <span className="tv-due" data-kind={due.kind}>
          {due.short}
        </span>
        {t.high ? <span className="tv-high">High</span> : null}
      </div>
      <span className="tv-card__t">{t.title}</span>
      <span className="tv-say" data-tone={h.tone}>
        <span>{h.short || h.text}</span>
      </span>
      <span className="tv-mj__bar" style={{ width: "100%" }}>
        {journey(t, dir, now).map((s, i) => (
          <i key={i} data-st={s.st} />
        ))}
      </span>
      <div className="tv-card__foot">
        <Avs dir={dir} keys={t.people} />
        {thread ? null : <ChatCount t={t} onOpen={onOpen} />}
        <PrimaryButton t={t} team={team} onOpen={onOpen} say={say} />
      </div>
      {thread ? (
        <div className="tv-thr" onClick={(e) => e.stopPropagation()}>
          {last ? (
            <button type="button" className="tv-thr__last" onClick={openChat}>
              <Av dir={dir} k={last.key ?? ""} />
              <span className="tv-thr__txt">
                <b>{last.key === "me" ? "You" : last.key ? personIn(dir, last.key).first : last.name}</b> {last.text}
              </span>
              <small>{when(last.at, now)}</small>
            </button>
          ) : null}
          <div className="tv-thr__row">
            <button type="button" className="tv-thr__n" data-unread={u ? "true" : "false"} onClick={openChat}>
              <IcChat size={13} />
              {n ? `${n} ${n === 1 ? "reply" : "replies"}${u ? ` · ${u} new` : ""}` : "No replies yet"}
            </button>
            <button type="button" className="tv-thr__open" onClick={openChat}>
              Open task chat
            </button>
          </div>
          <div className="tv-thr__in">
            <input
              aria-label="Reply to this task…"
              placeholder="Reply to this task…"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button type="button" className="tv-send sm" aria-label="Send reply" disabled={busy} onClick={() => void send()}>
              <IcSend />
            </button>
          </div>
        </div>
      ) : null}
      <span className="tv-sr">{`For ${namesOf(dir, t.people)}. ${h.text}`}</span>
    </article>
  );
}
