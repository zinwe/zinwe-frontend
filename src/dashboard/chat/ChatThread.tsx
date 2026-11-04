import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { errorMessage, getMemberThread, type Message } from "../../lib/api";
import { Linkified } from "../components/Linkified";
import { CHAT_READ_EVENT } from "../features/chatEvents";
import { sepLabel, type TaskPerson } from "../tasks/model";
import { isoDay, toView, type TaskView } from "../tasks/types";
import { clockTime } from "../ui/time";
import { Sk } from "../ui/States";
import { TaskCard } from "./TaskCard";
import { firstLine, quoteOf, type ReplyTarget } from "./reply";

const CHECK1 = "M2 7.5 5.5 11 12 4";
const CHECK2 = "M1 7.5 4.5 11 11 4M8 10.5l.5.5L15 4";
/** Within this distance of the bottom the thread counts as "at the bottom" and follows new lines. */
const NEAR_BOTTOM_PX = 80;
/** A task created this recently shows in the thread before its chat line comes back from the server. */
const JUST_SENT_MS = 2 * 60 * 1000;

type Item = { kind: "msg"; key: string; at: Date; m: Message } | { kind: "task"; key: string; at: Date; t: TaskView; m: Message | null };

function ReplyIcon(): ReactElement {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 6 6v5" />
    </svg>
  );
}

/** F-14: "Reply" as a small text link in the line under every bubble, always visible (not a button on hover). */
function ReplyLink({ label, onClick }: { label: string; onClick: () => void }): ReactElement {
  return (
    <>
      <span aria-hidden="true">·</span>
      <button type="button" className="cv-reply" aria-label={label} onClick={onClick}>
        <ReplyIcon />
        Reply
      </button>
    </>
  );
}

function Receipt({ kind }: { kind: "sent" | "delivered" | "seen" | "emailed" }): ReactElement {
  const label = { sent: "Sent", delivered: "Delivered", seen: "Seen", emailed: "Emailed" }[kind];
  return (
    <span className={kind === "seen" ? "cv-rc seen" : "cv-rc"}>
      <span style={{ color: "#6B6B6B" }}>·</span>
      <svg width="14" height="11" viewBox="0 0 16 14" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={kind === "sent" || kind === "emailed" ? CHECK1 : CHECK2} />
      </svg>
      {label}
    </span>
  );
}

const CHANNEL_NOTE: Record<NonNullable<Message["channel"]>, string> = { chat: "", chat_email: " · chat + email", email: " · email only" };

const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The freshest copy of a task line's task: the Tasks list (polled, changed by your actions) or the line's own. */
function taskOfLine(m: Message, tasks: readonly TaskView[]): TaskView | null {
  if (!m.task) return null;
  const fresh = tasks.find((t) => t.id === m.task?.id);
  const own = toView(m.task);
  return fresh && fresh.updatedAt >= own.updatedAt ? fresh : own;
}

/**
 * The conversation with one person (DashChat): their real messages (getMemberThread; reading it marks their replies
 * read, then CHAT_READ_EVENT lets the menu badge catch up). Task lines (FR-20, `kind: "task"`) show as task cards with
 * a live stage bar. Date separators, reply quotes, receipts Sent → Delivered → Seen on every line you sent.
 *
 * Scrolling (v1.3.1): opening a chat lands at the newest line; new lines keep it pinned to the bottom (smoothly)
 * unless you scrolled up, then a "New messages ↓" pill shows; after you send (`pin` changes) it always goes to the
 * bottom. New lines slide in (~180 ms, none with reduced motion). `outbox` = lines you just sent, shown before the
 * next fetch returns them.
 */
export function ChatThread({
  person,
  tasks,
  reloadKey,
  pin,
  outbox,
  openCards,
  flash,
  onToggleCard,
  onReply,
  onEditTask,
  onJump,
}: {
  person: TaskPerson & { memberId: number };
  /** This person's tasks (fresh from the Tasks list). */
  tasks: readonly TaskView[];
  /** Changes when the thread should fetch again. */
  reloadKey: string;
  /** Changes when you send something: the thread goes to the bottom. */
  pin: number;
  outbox: readonly Message[];
  openCards: ReadonlySet<number>;
  flash: string | null;
  onToggleCard: (taskId: number) => void;
  onReply: (target: ReplyTarget) => void;
  onEditTask: (t: TaskView) => void;
  onJump: (key: string) => void;
}): ReactElement {
  const [thread, setThread] = useState<Message[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [pill, setPill] = useState(false);
  // When the thread was last fetched: a task created after that may not have its chat line in it yet.
  const [fetchedAt, setFetchedAt] = useState(0);
  const lastReplyId = useRef<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const first = person.first;

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    // Fetching the thread also marks their replies read server-side.
    getMemberThread(person.memberId, controller.signal)
      .then((msgs) => {
        if (!alive) return;
        setThread(msgs);
        setFetchedAt(Date.now());
        setError(null);
        const newest = msgs.find((m) => m.sender === "member")?.id ?? null;
        if (newest !== lastReplyId.current) {
          lastReplyId.current = newest;
          window.dispatchEvent(new Event(CHAT_READ_EVENT));
        }
      })
      .catch((e: unknown) => {
        if (alive && !controller.signal.aborted) setError(errorMessage(e));
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [person.memberId, reloadKey, retry]);

  // Every line once: the fetched thread plus what you just sent and it doesn't have yet.
  const lines: Message[] = [...(thread ?? [])];
  for (const m of outbox) if (!lines.some((x) => x.id === m.id)) lines.push(m);
  const lineIds = new Set(lines.map((m) => m.id));
  const items: Item[] = [
    ...lines.map((m): Item => {
      const t = m.kind === "task" ? taskOfLine(m, tasks) : null;
      return t ? { kind: "task", key: `t${t.id}`, at: new Date(m.created_at), t, m } : { kind: "msg", key: `m${m.id}`, at: new Date(m.created_at), m };
    }),
    // A task you just sent whose chat line the thread hasn't fetched yet.
    ...tasks
      .filter((t) => t.messageId != null && !lineIds.has(t.messageId) && t.createdAt > fetchedAt - JUST_SENT_MS)
      .map((t): Item => ({ kind: "task", key: `t${t.id}`, at: new Date(t.createdAt), t, m: null })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  const lastKey = items.length ? items[items.length - 1].key : "";
  const itemKeys = items.map((it) => it.key).join(" ");

  // ---- Stick to the bottom ----
  const stick = useRef(true);
  const autoScrolling = useRef(false);
  const landed = useRef(false);
  const prevLast = useRef("");
  const prevPin = useRef(pin);
  const known = useRef<Set<string>>(new Set());
  const loaded = thread !== undefined;
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !loaded) return;
    // New lines slide in (not the ones there when the chat opened).
    for (const key of itemKeys.split(" ")) {
      if (!key || known.current.has(key)) continue;
      known.current.add(key);
      if (landed.current && !reducedMotion()) document.getElementById(`msg-${key}`)?.classList.add("new");
    }
    const pinned = pin !== prevPin.current;
    prevPin.current = pin;
    const grew = lastKey !== prevLast.current;
    prevLast.current = lastKey;
    if (!landed.current) {
      // Opening a chat lands at the newest line.
      landed.current = true;
      el.scrollTop = el.scrollHeight;
      return;
    }
    if (pinned || (grew && stick.current)) {
      stick.current = true;
      autoScrolling.current = true;
      setPill(false);
      el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" });
      window.setTimeout(() => {
        autoScrolling.current = false;
      }, 700);
    } else if (grew) {
      setPill(true);
    }
  }, [loaded, itemKeys, lastKey, pin]);

  // A task card opening or updating at the bottom grows the thread: stay at the newest line if you were there.
  useLayoutEffect(() => {
    const el = box.current;
    if (el && landed.current && stick.current && !autoScrolling.current) el.scrollTop = el.scrollHeight;
  }, [openCards, tasks]);

  const toBottom = () => {
    const el = box.current;
    if (!el) return;
    stick.current = true;
    autoScrolling.current = true;
    setPill(false);
    el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" });
    window.setTimeout(() => {
      autoScrolling.current = false;
    }, 700);
  };

  if (error && thread === undefined) {
    return (
      <div className="cv-threadwrap">
        <div className="cv-thread" role="alert">
          <p style={{ margin: "auto 0", textAlign: "center", color: "#C0331C" }}>
            {error}{" "}
            <button type="button" className="zk-link" onClick={() => setRetry((r) => r + 1)}>
              Try again
            </button>
          </p>
        </div>
      </div>
    );
  }
  if (thread === undefined) {
    return (
      <div className="cv-threadwrap">
        <div className="cv-thread" role="status" aria-busy="true">
          <span className="z-sr">Loading the conversation</span>
          {[220, 300, 180, 260].map((w, i) => (
            <div key={w} style={{ display: "flex", flexDirection: "column", alignItems: i % 2 ? "flex-end" : "flex-start", gap: 6 }}>
              <Sk w={w} h={42} style={{ borderRadius: 14 }} />
              <Sk w={90} h={10} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const msgs = lines;
  return (
    <div className="cv-threadwrap">
      <div
        ref={box}
        className="cv-thread"
        role="log"
        aria-label={`Conversation with ${person.name}`}
        onScroll={(e) => {
          const el = e.currentTarget;
          const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
          if (near) {
            autoScrolling.current = false;
            setPill(false);
          }
          stick.current = near || autoScrolling.current;
        }}
      >
        {items.length === 0 ? (
          <p style={{ margin: "auto 0", textAlign: "center", color: "#404040" }}>No messages with {first} yet. Say hello below, or use + Task to send something to tick off.</p>
        ) : null}
        {items.map((it, i) => {
          const day = isoDay(it.at);
          const prevDay = i > 0 ? isoDay(items[i - 1].at) : null;
          const sep =
            day !== prevDay ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "4px 0" }}>
                <span className="cv-sep">{sepLabel(day)}</span>
              </div>
            ) : null;
          const time = clockTime(it.at);
          const flashCls = flash === it.key ? "msg flash" : "msg";

          if (it.kind === "task") {
            const t = it.t;
            const m = it.m;
            const rc = m ? (m.read_by_member || t.status !== "sent" ? "seen" : m.delivered_at ? "delivered" : "sent") : "sent";
            return (
              <Fragment key={it.key}>
                {sep}
                <div id={`msg-${it.key}`} className={`${flashCls} out`}>
                  <div className="mrow">
                    <TaskCard
                      task={t}
                      first={first}
                      open={openCards.has(t.id)}
                      onToggle={() => onToggleCard(t.id)}
                      onEdit={() => onEditTask(t)}
                      onReply={(draft) => onReply({ key: it.key, head: "Replying about this task", text: `Task: ${t.title}`, subject: `About: ${t.title}`.slice(0, 120), placeholder: first, draft })}
                    />
                  </div>
                  <span className="cv-meta">
                    You sent this task · {time}
                    <Receipt kind={rc} />
                    <ReplyLink
                      label={`Reply about this task: ${t.title}`}
                      onClick={() => onReply({ key: it.key, head: "Replying about this task", text: `Task: ${t.title}`, subject: `About: ${t.title}`.slice(0, 120), placeholder: first })}
                    />
                  </span>
                </div>
              </Fragment>
            );
          }

          const m = it.m;
          const mine = m.sender === "owner";
          const q = mine ? quoteOf(m, msgs, tasks, first) : null;
          // A long chat note goes out as a cut-down title + the full text: show the text once.
          const showTitle = mine && !q && !!m.title && !!m.body && !m.body.startsWith(m.title.replace(/…$/, ""));
          const rc = !mine ? null : m.channel === "email" ? "emailed" : m.read_by_member ? "seen" : m.delivered_at ? "delivered" : "sent";
          const text = firstLine(m);
          return (
            <Fragment key={it.key}>
              {sep}
              <div id={`msg-${it.key}`} className={`${flashCls} ${mine ? "out" : "in"}`}>
                <div className="mrow">
                  <div className={mine ? "cv-bubble out" : "cv-bubble in"}>
                    {q ? (
                      <button type="button" className="quote" onClick={() => q.key && onJump(q.key)} aria-label={`Show the message this replies to: ${q.text}`}>
                        {q.who ? <b className="quote-who">{q.who}</b> : null}
                        <span className="qt">{q.text}</span>
                      </button>
                    ) : null}
                    {showTitle ? <b style={{ display: "block", fontSize: 13 }}>{m.title}</b> : null}
                    <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.body ? <Linkified text={m.body} /> : m.title || "—"}</span>
                  </div>
                </div>
                <span className="cv-meta">
                  {mine ? "You" : first} · {time}
                  {mine && m.channel ? CHANNEL_NOTE[m.channel] : ""}
                  {rc ? <Receipt kind={rc} /> : null}
                  <ReplyLink
                    label={mine ? "Reply to your message" : `Reply to ${first}’s message`}
                    onClick={() =>
                      onReply({
                        key: it.key,
                        head: mine ? "Replying to your message" : `Replying to ${first}`,
                        text,
                        subject: `Re: ${text.length > 100 ? `${text.slice(0, 99).trimEnd()}…` : text}`,
                        placeholder: mine ? "your message" : first,
                      })
                    }
                  />
                </span>
              </div>
            </Fragment>
          );
        })}
      </div>
      {pill ? (
        <button type="button" className="cv-newpill" onClick={toBottom}>
          New messages <span aria-hidden="true">↓</span>
        </button>
      ) : null}
    </div>
  );
}
