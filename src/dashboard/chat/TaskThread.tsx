import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { errorMessage, getMemberThread, sendMessage, type Message } from "../../lib/api";
import { Linkified } from "../components/Linkified";
import { CHAT_POLL_MS } from "../features/chatEvents";
import { dueLabel, dueStyle, sepLabel, statusStyle, type TaskPerson } from "../tasks/model";
import { isoDay, TASK_STATUS, type TaskView } from "../tasks/types";
import { clockTime } from "../ui/time";

/** The lines of a thread: the ones said about this task (or own to-do), oldest first. */
function threadLines(all: readonly Message[], t: TaskView): Message[] {
  const own = !!t.own;
  const id = own ? -t.id : t.id;
  return all.filter((m) => (own ? m.about_todo === id : m.about_task === id)).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

/**
 * v1.3.5 (F-17): one task's thread, beside the chat (full screen on a phone). The task on top, then every line said
 * about it (yours and theirs, from the same conversation: `Message.about_task` / `about_todo`), and a box to ask
 * about it. A line sent here also shows in the main chat with the task's name above it; the member sees it under the
 * task in their Zinwe app. Own to-dos (`t.own`, id negated) get a thread too.
 */
export function TaskThread({
  person,
  task: t,
  reloadKey,
  outbox,
  onSent,
  onClose,
}: {
  person: TaskPerson & { memberId: number };
  task: TaskView;
  /** Changes when the thread should fetch again. */
  reloadKey: string;
  /** Lines you just sent (the chat page keeps them until the next fetch has them). */
  outbox: readonly Message[];
  onSent: (message: Message) => void;
  onClose: () => void;
}): ReactElement {
  const [all, setAll] = useState<Message[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const first = person.first;

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    getMemberThread(person.memberId, controller.signal)
      .then((msgs) => {
        if (!alive) return;
        setAll(msgs);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!alive || controller.signal.aborted) return;
        setError(errorMessage(err));
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [person.memberId, reloadKey, tick]);

  // Keep the thread fresh while it is open.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") setTick((n) => n + 1);
    }, CHAT_POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    window.setTimeout(() => textRef.current?.focus(), 60);
  }, [t.id]);

  const merged: Message[] = [...(all ?? [])];
  for (const m of outbox) if (!merged.some((x) => x.id === m.id)) merged.push(m);
  const lines = threadLines(merged, t);
  const lastId = lines.length ? lines[lines.length - 1].id : 0;
  const loaded = all !== undefined;
  useLayoutEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId, loaded]);

  const send = async () => {
    const body = text.trim();
    if (!body || pending) return;
    setPending(true);
    setSendError(null);
    try {
      const sent = await sendMessage(person.memberId, {
        title: `About: ${t.title}`.slice(0, 120),
        body,
        severity: "info",
        channel: "chat",
        ...(t.own ? { about_todo: -t.id } : { about_task: t.id }),
      });
      setText("");
      onSent(sent);
    } catch (err) {
      setSendError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    const composing = e.nativeEvent.isComposing || e.keyCode === 229;
    const phone = !!window.matchMedia?.("(max-width: 760px)").matches;
    if (e.key === "Enter" && !e.shiftKey && !composing && !phone) {
      e.preventDefault();
      void send();
    }
  };

  const stage = t.own ? (t.status === "approved" ? "Done" : t.status === "progress" ? "In progress" : "Open") : TASK_STATUS[t.status][0];
  const openHref = t.own ? `/app/tasks#m=${person.key}` : `/app/tasks#task=${t.id}`;
  return (
    <aside className="cv-tpanel" aria-label={`Thread: ${t.title}`}>
      <div className="cv-tpanel__head">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <b style={{ fontSize: 15 }}>Thread</b>
          <button type="button" className="cv-tpanel__x" aria-label="Close the thread" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="cv-tpanel__task">
          <span className="cv-kicker">{t.own ? `${first.toUpperCase()}’S OWN TO-DO` : "TASK"}</span>
          <b style={{ fontSize: 14, lineHeight: 1.35 }}>{t.title}</b>
          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 12, color: "#404040" }}>
            <span className="cv-pill" style={t.own ? { background: "#F5F5F5", color: "#404040" } : statusStyle(t.status)}>
              {stage}
            </span>
            {t.due ? (
              <span className="cv-pill" style={dueStyle(t)}>
                {dueLabel(t)}
              </span>
            ) : null}
            {t.steps.length ? <span>{t.steps.filter((s) => s.done).length}/{t.steps.length} steps</span> : null}
          </span>
          <Link className="zk-link" to={openHref} style={{ alignSelf: "flex-start", fontSize: 13 }}>
            {t.own ? "See it on Tasks" : "Open the task"}
          </Link>
        </div>
      </div>

      <div ref={box} className="cv-tpanel__body" role="log" aria-label={`Replies about ${t.title}`}>
        {error && all === undefined ? (
          <p role="alert" style={{ margin: "auto 0", textAlign: "center", color: "#C0331C" }}>
            {error}{" "}
            <button type="button" className="zk-link" onClick={() => setTick((n) => n + 1)}>
              Try again
            </button>
          </p>
        ) : all === undefined ? (
          <p role="status" aria-busy="true" style={{ margin: "auto 0", textAlign: "center", color: "#6B6B6B" }}>
            Loading…
          </p>
        ) : lines.length === 0 ? (
          <p style={{ margin: "auto 0", textAlign: "center", color: "#404040", fontSize: 14 }}>
            Nothing said about this yet. Ask {first} below: your question stays with the {t.own ? "to-do" : "task"}, and they answer from it in their Zinwe app.
          </p>
        ) : (
          lines.map((m, i) => {
            const at = new Date(m.created_at);
            const day = isoDay(at);
            const prevDay = i > 0 ? isoDay(new Date(lines[i - 1].created_at)) : null;
            const mine = m.sender === "owner";
            return (
              <div key={m.id} style={{ display: "contents" }}>
                {day !== prevDay ? (
                  <div style={{ display: "flex", justifyContent: "center", padding: "2px 0" }}>
                    <span className="cv-sep">{sepLabel(day)}</span>
                  </div>
                ) : null}
                <div className={mine ? "cv-tline out" : "cv-tline in"}>
                  <span className="cv-tline__who">
                    {mine ? "You" : first} · {clockTime(at)}
                  </span>
                  <div className={mine ? "cv-bubble out" : "cv-bubble in"}>
                    <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.body ? <Linkified text={m.body} /> : m.title || "—"}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="cv-tpanel__compose">
        <div className="cbox">
          <label htmlFor="thread-msg" className="z-sr">
            Ask {first} about this {t.own ? "to-do" : "task"}
          </label>
          <textarea
            id="thread-msg"
            ref={textRef}
            className="cv-text"
            rows={2}
            maxLength={2000}
            value={text}
            placeholder={`Ask ${first} about this ${t.own ? "to-do" : "task"}…`}
            readOnly={pending}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
          />
          <button type="button" className="csend" aria-label="Send" disabled={pending || !text.trim()} onClick={() => void send()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />
            </svg>
          </button>
        </div>
        {sendError ? (
          <p role="alert" style={{ margin: 0, fontSize: 13, color: "#C0331C" }}>
            {sendError}
          </p>
        ) : null}
        <span style={{ fontSize: 12, color: "#6B6B6B" }}>Stays with this {t.own ? "to-do" : "task"}. {first} sees it under it in their Zinwe app and can answer from there.</span>
      </div>
    </aside>
  );
}
