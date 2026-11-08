import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { CHAT_EDIT_MS, errorMessage, seenOf, type ChatGroup, type ChatMessage } from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { Linkified } from "../components/Linkified";
import { roleColour } from "../roleColour";
import { sepLabel, type TaskPerson } from "../tasks/model";
import { isoDay } from "../tasks/types";
import { useNow } from "../time";
import { Sk } from "../ui/States";
import { clockTime } from "../ui/time";
import { firstOf, nameList } from "./groupModel";
import { loadGroupMessages } from "./groupsSource";
import type { ReplyTarget } from "./reply";

type Person = TaskPerson & { memberId: number };

const CHECK1 = "M2 7.5 5.5 11 12 4";
const CHECK2 = "M1 7.5 4.5 11 11 4M8 10.5l.5.5L15 4";
const NEAR_BOTTOM_PX = 80;
const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const isPhone = () => !!window.matchMedia?.("(max-width: 760px)").matches;

function ReplyIcon(): ReactElement {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 6 6v5" />
    </svg>
  );
}

/** "@Karan" in a line, picked out in the accent ink (only names of people in the group, and "@" + the owner). */
function withMentions(text: string, names: readonly string[]): ReactNode {
  if (!text.includes("@")) return <Linkified text={text} />;
  const parts = text.split(/(@[A-Za-z][\w-]*)/g);
  return parts.map((part, i) =>
    part.startsWith("@") && names.some((n) => n.toLowerCase() === part.slice(1).toLowerCase()) ? (
      <b key={i} className="cv-mention">
        {part}
      </b>
    ) : (
      <Linkified key={i} text={part} />
    ),
  );
}

/**
 * A group's thread (v1.4, board DashChat "Design"): the production bubbles and times, the sender's first name above
 * their lines (role colour), reply quotes, "Seen by N" on your lines (hover lists names when the server says),
 * system lines in the middle ("You added Emily."), task cards with their thread footer (`renderTask`, from tasks2),
 * and under your lines Edit / Delete for 15 minutes (desktop: on hover next to Reply; phone: tap the line).
 * Opening and every fetch that brings new lines from others marks the group read (`onRead`).
 */
export function GroupThread({
  group,
  people,
  reloadKey,
  pin,
  outbox,
  flash,
  renderTask,
  onReply,
  onEdit,
  onDelete,
  onJump,
  onRead,
  ownerFirst,
}: {
  group: ChatGroup;
  /** The whole team (names, roles, avatars); members who left still show by the name on their lines. */
  people: readonly Person[];
  reloadKey: string;
  /** Changes when you send something: the thread goes to the bottom. */
  pin: number;
  /** Lines you just sent, shown before the next fetch has them. */
  outbox: readonly ChatMessage[];
  flash: string | null;
  /** A task card line: the card (tasks2 TaskCard with its thread footer), or null when the task isn't known. */
  renderTask: (taskId: number) => ReactNode | null;
  onReply: (target: ReplyTarget) => void;
  onEdit: (m: ChatMessage) => void;
  onDelete: (m: ChatMessage) => Promise<void>;
  onJump: (key: string) => void;
  onRead: () => void;
  /** The owner's first name ("@Ananya" is picked out too). */
  ownerFirst: string;
}): ReactElement {
  const [lines, setLines] = useState<ChatMessage[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [pill, setPill] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const actingAt = useRef(0);
  const lastOther = useRef<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const now = useNow(30_000);
  const onReadRef = useRef(onRead);
  useEffect(() => {
    onReadRef.current = onRead;
  }, [onRead]);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    loadGroupMessages(group.id, controller.signal)
      .then((msgs) => {
        if (!alive) return;
        setLines(msgs);
        setError(null);
        // New lines from others (or the first look): the owner has read the group now.
        const newest = [...msgs].reverse().find((m) => m.by?.kind === "member")?.id ?? null;
        if (newest !== lastOther.current) {
          lastOther.current = newest;
          onReadRef.current();
        }
      })
      .catch((e: unknown) => {
        if (alive && !controller.signal.aborted) setError(errorMessage(e));
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [group.id, reloadKey, retry]);

  const all: ChatMessage[] = [...(lines ?? [])];
  for (const m of outbox) if (!all.some((x) => x.id === m.id)) all.push(m);
  const keys = all.map((m) => `g${m.id}`).join(" ");
  const lastKey = all.length ? `g${all[all.length - 1].id}` : "";
  const peopleById = new Map(people.map((p) => [p.memberId, p]));
  const storedRoles = people.map((p) => p.member?.role ?? "");
  const inGroup = people.filter((p) => group.member_ids.includes(p.memberId));
  const mentionNames = [...inGroup.map((p) => p.first), ownerFirst, "everyone", "all"];
  const total = group.member_ids.length;

  // ---- Stick to the bottom (as ChatThread) ----
  const stick = useRef(true);
  const autoScrolling = useRef(false);
  const landed = useRef(false);
  const prevLast = useRef("");
  const prevPin = useRef(pin);
  const known = useRef<Set<string>>(new Set());
  const loaded = lines !== undefined;
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !loaded) return;
    for (const key of keys.split(" ")) {
      if (!key || known.current.has(key)) continue;
      known.current.add(key);
      if (landed.current && !reducedMotion()) document.getElementById(`msg-${key}`)?.classList.add("new");
    }
    const pinned = pin !== prevPin.current;
    prevPin.current = pin;
    const grew = lastKey !== prevLast.current;
    prevLast.current = lastKey;
    if (!landed.current) {
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
  }, [loaded, keys, lastKey, pin]);

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

  if (error && lines === undefined) {
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
  if (lines === undefined) {
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

  const whoOf = (m: Pick<ChatMessage, "by">): string => (m.by?.kind === "owner" ? "You" : m.by?.member_id != null ? (peopleById.get(m.by.member_id)?.first ?? firstOf(m.by.name)) : firstOf(m.by?.name ?? ""));

  return (
    <div className="cv-threadwrap">
      <div
        ref={box}
        className="cv-thread"
        role="log"
        aria-label={`Conversation in ${group.name}`}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (acting && Math.abs(el.scrollTop - actingAt.current) > 40) setActing(null);
          const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
          if (near) {
            autoScrolling.current = false;
            setPill(false);
          }
          stick.current = near || autoScrolling.current;
        }}
      >
        {all.length === 0 ? (
          <p style={{ margin: "auto 0", textAlign: "center", color: "#404040" }}>No messages in {group.name} yet. Say hello below, or send a task everyone can follow with + Task.</p>
        ) : null}
        {all.map((m, i) => {
          const at = new Date(m.at);
          const day = isoDay(at);
          const prev = i > 0 ? all[i - 1] : null;
          const sep =
            !prev || isoDay(new Date(prev.at)) !== day ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "4px 0" }}>
                <span className="cv-sep">{sepLabel(day)}</span>
              </div>
            ) : null;
          const key = `g${m.id}`;
          if (m.system) {
            return (
              <Fragment key={key}>
                {sep}
                <div id={`msg-${key}`} className="cv-sys">
                  <span>{m.body}</span>
                </div>
              </Fragment>
            );
          }
          const mine = m.by?.kind === "owner";
          const who = whoOf(m);
          const author = m.by?.member_id != null ? peopleById.get(m.by.member_id) : undefined;
          const time = clockTime(at);
          const seen = seenOf(m);
          const seenText = seen.count <= 0 ? "Sent" : `Seen by ${seen.count}`;
          const seenTip = seen.names.length ? `Seen by ${nameList(seen.names.map(firstOf))}` : seen.count >= total && total > 0 ? "Seen by everyone" : undefined;
          const receipt =
            mine && !m.deleted ? (
              <span className={seen.count > 0 ? "cv-rc seen" : "cv-rc"} title={seenTip}>
                <span style={{ color: "#6B6B6B" }}>·</span>
                <svg width="14" height="11" viewBox="0 0 16 14" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={seen.count > 0 ? CHECK2 : CHECK1} />
                </svg>
                {seenText}
              </span>
            ) : null;
          const text = m.deleted ? (mine ? "You deleted this message" : "This message was deleted") : m.body;
          const replyTo = () =>
            onReply({
              key,
              head: mine ? "Replying to your message" : `Replying to ${who}`,
              text: m.task_id ? "Task" : m.body.split("\n")[0],
              subject: "",
              placeholder: mine ? "your message" : who,
              messageId: m.id,
            });
          const canChange = mine && !m.deleted && !m.task_id && now - at.getTime() < CHAT_EDIT_MS && m.id > 0;
          const del = async () => {
            setBusy(m.id);
            try {
              await onDelete(m);
            } finally {
              setBusy(null);
            }
          };
          const flashCls = flash === key ? "msg flash" : "msg";

          if (m.task_id != null && !m.deleted) {
            const card = renderTask(m.task_id);
            return (
              <Fragment key={key}>
                {sep}
                <div id={`msg-${key}`} className={`${flashCls} ${mine ? "out" : "in"}`}>
                  {!mine ? (
                    <span className="cv-sender" style={{ color: roleColour(author?.member?.role ?? "", storedRoles) }}>
                      {who}
                    </span>
                  ) : null}
                  <div className="mrow">
                    {card ?? (
                      <div className={mine ? "cv-bubble out" : "cv-bubble in"}>
                        <b style={{ display: "block", fontSize: 13 }}>Task</b>
                        <span>{m.body || "A task for the group"}</span>
                      </div>
                    )}
                  </div>
                  <span className="cv-meta">
                    {mine ? "You" : who} · {time}
                    {receipt}
                    <span className="cv-replyat">
                      <span aria-hidden="true">·</span>
                      <button type="button" className="cv-reply" aria-label="Reply about this task" onClick={replyTo}>
                        <ReplyIcon />
                        Reply
                      </button>
                    </span>
                  </span>
                </div>
              </Fragment>
            );
          }

          // A run of lines from the same person shows their name once.
          const showWho = !mine && (!prev || prev.system || prev.by?.member_id !== m.by?.member_id || prev.by?.kind !== m.by?.kind || isoDay(new Date(prev.at)) !== day);
          const open = acting === key;
          const q = m.reply_to;
          return (
            <Fragment key={key}>
              {sep}
              <div id={`msg-${key}`} className={`${flashCls} ${mine ? "out" : "in"} cv-gmsg`}>
                {showWho ? (
                  <span className="cv-sender" style={{ color: roleColour(author?.member?.role ?? "", storedRoles) }}>
                    {who}
                  </span>
                ) : null}
                {open ? (
                  <div className="cv-acts" role="group" aria-label="Message actions">
                    {!m.deleted ? (
                      <button
                        type="button"
                        onClick={() => {
                          setActing(null);
                          replyTo();
                        }}
                      >
                        <ReplyIcon /> Reply
                      </button>
                    ) : null}
                    {!m.deleted ? (
                      <button
                        type="button"
                        onClick={() => {
                          setActing(null);
                          void copyText(m.body);
                        }}
                      >
                        Copy
                      </button>
                    ) : null}
                    {canChange ? (
                      <button
                        type="button"
                        onClick={() => {
                          setActing(null);
                          onEdit(m);
                        }}
                      >
                        Edit
                      </button>
                    ) : null}
                    {canChange ? (
                      <button
                        type="button"
                        onClick={() => {
                          setActing(null);
                          void del();
                        }}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <div className="mrow">
                  <div
                    className={`${mine ? "cv-bubble out" : "cv-bubble in"}${m.deleted ? " del" : ""}`}
                    onClick={(e) => {
                      if (!isPhone() || m.deleted || (e.target as HTMLElement).closest("a, button")) return;
                      actingAt.current = box.current?.scrollTop ?? 0;
                      setActing(open ? null : key);
                    }}
                  >
                    {q && !m.deleted ? (
                      <button type="button" className="quote" onClick={() => onJump(`g${q.id}`)} aria-label={`Show the message this replies to: ${q.body}`}>
                        <b className="quote-who">{whoOf(q)}</b>
                        <span className="qt">{q.body || "Deleted message"}</span>
                      </button>
                    ) : null}
                    <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.deleted ? text : withMentions(text, mentionNames)}</span>
                  </div>
                </div>
                <span className="cv-meta">
                  {mine ? "You" : who} · {time}
                  {m.edited && !m.deleted ? " · Edited" : ""}
                  {receipt}
                  {!m.deleted ? (
                    <span className="cv-replyat">
                      <span aria-hidden="true">·</span>
                      <button type="button" className="cv-reply" aria-label={mine ? "Reply to your message" : `Reply to ${who}’s message`} onClick={replyTo}>
                        <ReplyIcon />
                        Reply
                      </button>
                    </span>
                  ) : null}
                  {canChange ? (
                    <span className="cv-mx">
                      <span aria-hidden="true">·</span>
                      <button type="button" className="cv-reply" onClick={() => onEdit(m)}>
                        Edit
                      </button>
                      <span aria-hidden="true">·</span>
                      <button type="button" className="cv-reply" disabled={busy === m.id} onClick={() => void del()} aria-label="Delete for everyone">
                        {busy === m.id ? "Deleting…" : "Delete"}
                      </button>
                    </span>
                  ) : null}
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
