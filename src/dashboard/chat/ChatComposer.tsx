import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { errorMessage, MESSAGE_BODY_MAX, sendMessage, type Message, type MessageChannel } from "../../lib/api";
import { ComposerMenu } from "../components/TaggedComposer";
import { DashIcon } from "../components/DashIcon";
import { DELIVERIES, deliveryFor, draftPreview, subjectLine, tagsFor, URGENCY, type MessageTag, type Urgency } from "../features/messageTags";
import type { TaskPerson } from "../tasks/model";
import { TaskMark } from "../tasks/icons";
import type { ReplyTarget } from "./reply";

/**
 * The Chat page composer (DashChat): the task button, the message box and the round Send inside one box; "/" opens
 * the actions menu ("/task Send the deck" opens the task form with the title filled in). Under it, the same
 * Suggestions / Priority / Send via (Chat, Chat + email, Email only) as the chat bubble. Enter sends,
 * Shift + Enter starts a new line. Without `onTask` there is no task button and no "/" menu.
 *
 * Phone: one row (⋮, the box, Send). ⋮ opens a sheet with Send a task, Use a ready message, Priority and Send via;
 * chips above the box show what isn't the default (a ready message, Important / Urgent, Chat + email, Email only).
 */
export function ChatComposer({
  person,
  reply,
  onCancelReply,
  onJumpReply,
  onTask,
  onSent,
}: {
  person: TaskPerson & { memberId: number };
  reply: ReplyTarget | null;
  onCancelReply: () => void;
  onJumpReply: () => void;
  /** Open the task form for this person, optionally with a title. Leave out to hide every task control. */
  onTask?: (title?: string) => void;
  /** After a send: how it went out, and the new line (shown in the thread at once). */
  onSent: (delivery: MessageChannel, message?: Message) => void;
}): ReactElement {
  const first = person.first;
  const email = person.member?.email ?? "their email";
  const tags = tagsFor(null);
  const [text, setText] = useState("");
  const [tag, setTag] = useState<MessageTag | null>(null);
  const [urgency, setUrgencyState] = useState<Urgency>("info");
  const [delivery, setDelivery] = useState<MessageChannel>("chat");
  const [deliveryPicked, setDeliveryPicked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [slashClosed, setSlashClosed] = useState(false);
  const [sheet, setSheet] = useState<"" | "main" | "ready">("");
  const textRef = useRef<HTMLTextAreaElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (sheet) sheetRef.current?.querySelector<HTMLElement>("button:not([tabindex='-1'])")?.focus();
  }, [sheet]);
  const closeSheet = () => {
    setSheet("");
    moreRef.current?.focus();
  };

  // A reply that comes with a draft ("Done, you have edit access now. ") fills the box once.
  const [seenReply, setSeenReply] = useState<ReplyTarget | null>(null);
  if (reply !== seenReply) {
    setSeenReply(reply);
    if (reply?.draft) setText(reply.draft);
  }

  const setUrgency = (next: Urgency) => {
    setUrgencyState(next);
    if (!deliveryPicked) setDelivery(deliveryFor(next));
  };
  const priority = URGENCY.find((u) => u.value === urgency) ?? URGENCY[0];
  const via = DELIVERIES.find((d) => d.value === delivery) ?? DELIVERIES[0];
  const noCtx = { subject: null, detail: null, suggested: "", feature: null };
  const pickTag = (id: string | null) => {
    const next = tags.find((t) => t.id === id) ?? null;
    if (!next || tag?.id === next.id) {
      setTag(null);
      return;
    }
    setTag(next);
    setUrgency(next.urgency);
    setText(next.draft(first, noCtx));
    setNotice(null);
    textRef.current?.focus();
  };
  const pickDelivery = (value: MessageChannel) => {
    setDelivery(value);
    setDeliveryPicked(true);
    setNotice(null);
  };

  const slashWord = /^\/(\S*)/.exec(text)?.[1];
  const slashOpen = onTask !== undefined && slashWord !== undefined && !slashClosed && "task".startsWith(slashWord.toLowerCase()) && !/^\/\S*\n/.test(text);
  const slashTitle = text.replace(/^\/\S*\s*/, "").trim();
  const pickSlash = () => {
    onTask?.(slashTitle || undefined);
    setText("");
    setSlashClosed(false);
  };

  const send = async () => {
    const body = text.trim();
    if (!body || pending || slashOpen) return;
    setPending(true);
    setError(null);
    try {
      const fallback = body.split("\n")[0].slice(0, 80) + (body.length > 80 ? "…" : "");
      const sent = await sendMessage(person.memberId, {
        title: reply ? reply.subject : subjectLine(tag, null, fallback),
        body,
        severity: urgency,
        channel: delivery,
      });
      setNotice(delivery === "email" ? `Emailed to ${email}.` : delivery === "chat_email" ? `Sent to ${first}'s PC and emailed.` : null);
      setText("");
      setTag(null);
      onSent(delivery, sent);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen) {
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickSlash();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashClosed(true);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        return;
      }
    }
    if (e.key === "Escape" && reply) {
      e.preventDefault();
      onCancelReply();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const replyWho = reply ? reply.placeholder : "";
  return (
    <div className="cv-compose">
      {reply ? (
        <div className="cv-replying">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A84505" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}>
            <path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 6 6v5" />
          </svg>
          <button type="button" onClick={onJumpReply} className="cv-replying__what">
            <span style={{ fontSize: 12, fontWeight: 600, color: "#A84505" }}>{reply.head}</span>
            <span className="qt" style={{ fontSize: 13, color: "#404040" }}>
              {reply.text}
            </span>
          </button>
          <button type="button" aria-label="Cancel reply" onClick={onCancelReply} className="cv-replying__x">
            ×
          </button>
        </div>
      ) : null}
      {tag || urgency !== "info" || delivery !== "chat" ? (
        <div className="cv-chips zk-m-only">
          {tag ? (
            <button type="button" className="cv-chip" aria-label={`Ready message: ${tag.label}. Remove`} onClick={() => pickTag(null)}>
              {tag.label} <span aria-hidden="true">✕</span>
            </button>
          ) : null}
          {urgency !== "info" ? (
            <button type="button" className="cv-chip" aria-label={`Priority ${priority.label}. Back to Normal`} onClick={() => setUrgency("info")}>
              <i className={`tc-dot tc-dot--${priority.value}`} aria-hidden="true" />
              {priority.label} <span aria-hidden="true">✕</span>
            </button>
          ) : null}
          {delivery !== "chat" ? (
            <button type="button" className="cv-chip" aria-label={`Send via ${via.label}. Back to Chat`} onClick={() => pickDelivery("chat")}>
              {via.label} <span aria-hidden="true">✕</span>
            </button>
          ) : null}
        </div>
      ) : null}
      <div style={{ position: "relative" }}>
        {slashOpen ? (
          <div id="slash-menu" role="listbox" aria-label="Actions" className="cv-slash">
            <span className="cv-slash__head">ACTIONS</span>
            <button
              type="button"
              role="option"
              aria-selected="true"
              className="slash-opt"
              onMouseDown={(e) => {
                e.preventDefault();
                pickSlash();
              }}
            >
              <span aria-hidden="true" className="cv-slash__mark">
                <TaskMark />
              </span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.3, textAlign: "left" }}>
                <b style={{ fontSize: 14 }}>Create a task for {first}</b>
                <small style={{ fontSize: 12, color: "#6B6B6B", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {slashTitle ? `“${slashTitle}”` : `Opens the task form with ${first} filled in`}
                </small>
              </span>
              <span className="z-mono" style={{ flex: "none", fontSize: 12, color: "#6B6B6B" }}>
                /task
              </span>
            </button>
            <span style={{ fontSize: 11.5, color: "#6B6B6B", padding: "4px 8px" }}>↑ ↓ to choose · Enter to open · Esc to close</span>
          </div>
        ) : null}
        <div className="cbox">
          <button
            ref={moreRef}
            type="button"
            className="cicon cmore zk-m-only"
            aria-label="Message options: task, ready message, priority, send via"
            aria-haspopup="dialog"
            aria-expanded={sheet !== ""}
            onClick={() => setSheet("main")}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="12" cy="5" r="1.9" />
              <circle cx="12" cy="12" r="1.9" />
              <circle cx="12" cy="19" r="1.9" />
            </svg>
          </button>
          {onTask ? (
            <button type="button" id="new-task" className="cicon ctask zk-d-only" aria-label={`Add a task for ${first} (or type /task)`} title="Add a task · or type /task" aria-haspopup="dialog" onClick={() => onTask()}>
              <TaskMark size={16} stroke={2} />
              <span aria-hidden="true">+ Task</span>
            </button>
          ) : null}
          <label htmlFor="msg" className="z-sr">
            Message {first}
          </label>
          <textarea
            ref={textRef}
            id="msg"
            rows={1}
            maxLength={MESSAGE_BODY_MAX}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSlashClosed(false);
              setNotice(null);
            }}
            onKeyDown={onKey}
            placeholder={reply ? `Reply to ${replyWho}…` : `Message ${first}…`}
            aria-autocomplete="list"
            aria-controls={slashOpen ? "slash-menu" : undefined}
            aria-expanded={slashOpen}
            disabled={pending}
            className="cv-text"
          />
          <button type="button" className="csend" aria-label={`Send message to ${first}`} disabled={!text.trim() || slashOpen || pending} onClick={() => void send()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h13M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>
      <div className="cv-tools zk-d-only">
        <ComposerMenu
          label="Suggestions"
          current={tag?.id ?? null}
          options={tags.map((t) => ({ value: t.id, label: t.label, icon: t.icon, note: draftPreview(t.draft(first, noCtx)) }))}
          onPick={pickTag}
          trigger={
            <>
              <DashIcon name={tag?.icon ?? "book"} />
              <span className="tc-dd__label tc-dd__label--suggest">{tag?.label ?? "Suggestions"}</span>
            </>
          }
        />
        <ComposerMenu
          label="Priority"
          current={urgency}
          options={URGENCY.map((u) => ({ value: u.value, label: u.label, note: u.hint, dot: u.value }))}
          onPick={setUrgency}
          trigger={
            <>
              <i className={`tc-dot tc-dot--${priority.value}`} aria-hidden="true" />
              <span className="tc-dd__label">{priority.label}</span>
            </>
          }
        />
        <ComposerMenu
          label="Send via"
          current={delivery}
          options={DELIVERIES}
          onPick={pickDelivery}
          trigger={
            <>
              <DashIcon name={via.icon} />
              <span className="tc-dd__label">{via.label}</span>
            </>
          }
        />
      </div>
      {sheet ? (
        <div className="cv-osheet-wrap">
          <button type="button" tabIndex={-1} className="cv-osheet-scrim" aria-label="Close message options" onClick={closeSheet} />
          <div
            ref={sheetRef}
            className="cv-osheet"
            role="dialog"
            aria-modal="true"
            aria-label={sheet === "ready" ? "Ready messages" : "Message options"}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                closeSheet();
              }
            }}
          >
            <span className="cv-osheet__grab" aria-hidden="true" />
            {sheet === "main" ? (
              <>
                <b className="cv-osheet__title">Message options</b>
                {onTask ? (
                  <button
                    type="button"
                    className="cv-orow"
                    onClick={() => {
                      setSheet("");
                      onTask();
                    }}
                  >
                    <TaskMark size={18} stroke={2} />
                    <span>
                      Send a task
                      <small>Something {first} can tick off</small>
                    </span>
                  </button>
                ) : null}
                <button type="button" className="cv-orow" onClick={() => setSheet("ready")}>
                  <DashIcon name="book" />
                  <span>
                    Use a ready message
                    <small>{tag ? tag.label : `${tags.slice(0, 3).map((t) => t.label).join(", ")}…`}</small>
                  </span>
                </button>
                <span className="cv-osheet__lab" id="cv-o-pri">
                  Priority
                </span>
                <div className="cv-oseg" role="group" aria-labelledby="cv-o-pri">
                  {URGENCY.map((u) => (
                    <button key={u.value} type="button" className={u.value === urgency ? "on" : ""} aria-pressed={u.value === urgency} onClick={() => setUrgency(u.value)}>
                      {u.label}
                    </button>
                  ))}
                </div>
                <span className="cv-osheet__lab" id="cv-o-via">
                  Send via
                </span>
                <div className="cv-oseg" role="group" aria-labelledby="cv-o-via">
                  {DELIVERIES.map((d) => (
                    <button key={d.value} type="button" className={d.value === delivery ? "on" : ""} aria-pressed={d.value === delivery} onClick={() => pickDelivery(d.value)}>
                      {d.label}
                    </button>
                  ))}
                </div>
                <span className="cv-osheet__hint">{via.note}. Important and Urgent also send an email, unless you pick Chat.</span>
                <button type="button" className="cv-osheet__done" onClick={closeSheet}>
                  Done
                </button>
              </>
            ) : (
              <>
                <button type="button" className="cv-osheet__back" onClick={() => setSheet("main")}>
                  ‹ Message options
                </button>
                <b className="cv-osheet__title">Ready messages</b>
                <div className="cv-osheet__list">
                  {tags.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`cv-orow${tag?.id === t.id ? " on" : ""}`}
                      onClick={() => {
                        setSheet("");
                        pickTag(t.id);
                      }}
                    >
                      <DashIcon name={t.icon} />
                      <span>
                        {t.label}
                        <small>{draftPreview(t.draft(first, noCtx))}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="cv-err" role="alert">
          {error}
        </p>
      ) : notice ? (
        <p className="cv-ok" role="status">
          {notice}
        </p>
      ) : (
        <span className="cv-hint">
          {onTask ? (
            <>
              Type <b className="z-mono">/</b> for actions, like <b className="z-mono">/task</b> ·{" "}
            </>
          ) : null}
          Enter sends · Shift + Enter for a new line ·{" "}
          {delivery === "email" ? `Goes to ${email} only` : `Lands in the Zinwe window on ${first}’s PC`}
        </span>
      )}
    </div>
  );
}
