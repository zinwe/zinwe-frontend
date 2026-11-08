import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { ApiError, emailAlert, errorMessage, sendMessage, MESSAGE_BODY_MAX, type DeviceEvent, type MessageChannel } from "../../lib/api";
import { cx } from "../../lib/cx";
import { contextOf, DELIVERIES, deliveryFor, draftPreview, subjectLine, tagsFor, URGENCY, type MessageTag, type Urgency } from "../features/messageTags";
import { eventMeta } from "../features/events";
import { AttachButton, FileChip } from "../chat/ChatFiles";
import { useFileSharing } from "../chat/fileSharing";
import { dropProps, pasteFile, useAttach } from "../chat/useAttach";
import { DashIcon, type DashIconName } from "./DashIcon";

/**
 * How a note reaches the person: the Zinwe widget on their PC ("chat"), the widget plus their inbox
 * ("chat_email"), or their inbox only ("email"). With an alert, "email" is the one-off alert email.
 */
export type Delivery = MessageChannel;

export interface ComposerPerson {
  id: number;
  name: string;
  email?: string;
}

export interface MenuOption<T extends string> {
  value: T;
  label: string;
  /** Second line, e.g. what the option does or the draft it fills in. */
  note?: string;
  icon?: DashIconName;
  /** A priority dot instead of an icon. */
  dot?: Urgency;
}

/**
 * A small dropdown in the composer's toolbar: the trigger shows the current choice, the menu opens
 * upwards (the composer sits at the bottom of the chat). Arrow keys move, Escape closes, a click outside
 * closes.
 */
export function ComposerMenu<T extends string>({
  label,
  current,
  options,
  onPick,
  trigger,
  alignEnd = false,
}: {
  label: string;
  current: T | null;
  options: ReadonlyArray<MenuOption<T>>;
  onPick: (value: T) => void;
  trigger: ReactNode;
  /** Open the menu leftwards from the trigger's right edge (the last control, near the bubble's edge). */
  alignEnd?: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    // Start on the chosen option (or the first) so the keyboard can carry on from there.
    wrap.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"], [role="option"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number) => {
      e.preventDefault();
      items[(i + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Tab") setOpen(false);
  };

  const chosen = options.find((o) => o.value === current);

  return (
    <div className={cx("tc-dd", open && "is-open")} ref={wrap}>
      <button
        ref={button}
        type="button"
        className={cx("tc-dd__btn", chosen && "has-value")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${label}: ${chosen?.label ?? "none"}`}
        title={label}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
        <span className="tc-dd__caret" aria-hidden="true" />
      </button>
      {open ? (
        <div className={cx("tc-dd__menu", alignEnd && "tc-dd__menu--end")} id={listId} role="listbox" aria-label={label} onKeyDown={onListKey}>
          <p className="tc-dd__head" aria-hidden="true">
            {label}
          </p>
          {options.map((o) => {
            const on = o.value === current;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={on}
                className={cx("tc-dd__opt", on && "is-on")}
                onClick={() => {
                  onPick(o.value);
                  setOpen(false);
                  button.current?.focus();
                }}
              >
                {o.dot ? <i className={`tc-dot tc-dot--${o.dot}`} aria-hidden="true" /> : o.icon ? <DashIcon name={o.icon} /> : null}
                <span className="tc-dd__text">
                  <b>{o.label}</b>
                  {o.note ? <small>{o.note}</small> : null}
                </span>
                <span className="tc-dd__tick" aria-hidden="true">
                  {on ? <DashIcon name="check" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The one composer for messaging a team member (chat bubble and Chat page): a message box with a
 * toolbar underneath — Suggestions (fills in a draft, its usual priority and the subject line),
 * Priority, Send via (chat, chat + email, email only) — and Send. Everything stays editable.
 * Enter sends, Shift+Enter starts a new line.
 *
 * v1.5 (file sharing): a paperclip ("Attach a file") first in the toolbar when Settings › Chat › Allow file sharing
 * is on (not for the one-off alert email). The file waits in a chip above the text, which becomes its caption;
 * Send uploads it (a thin orange bar), then sends the note with `file_id`. Dropping a file or pasting a picture
 * works too.
 */
export function TaggedComposer({
  person,
  event = null,
  initialTag = null,
  initialText,
  initialUrgency,
  initialDelivery,
  compact = false,
  onSent,
}: {
  person: ComposerPerson;
  event?: DeviceEvent | null;
  initialTag?: string | null;
  /** A ready-made note to start from (used when no suggestion is picked). */
  initialText?: string;
  initialUrgency?: Urgency;
  /** Omit to follow the priority: Normal → chat, Important / Urgent → chat + email. */
  initialDelivery?: Delivery;
  compact?: boolean;
  onSent: (delivery: Delivery) => void;
}): ReactElement {
  const first = person.name.trim().split(/\s+/)[0] || person.name;
  const inbox = person.email ?? "their email";
  const tags = tagsFor(event);
  const ctx = contextOf(event);
  const startTag = tags.find((t) => t.id === initialTag) ?? null;

  const [tag, setTag] = useState<MessageTag | null>(startTag);
  const startUrgency: Urgency = initialUrgency ?? startTag?.urgency ?? "info";
  const [urgency, setUrgencyState] = useState<Urgency>(startUrgency);
  const [delivery, setDelivery] = useState<Delivery>(initialDelivery ?? deliveryFor(startUrgency));
  // The owner chose "Send via" (or the caller did): the priority no longer changes it.
  const [deliveryPicked, setDeliveryPicked] = useState(initialDelivery !== undefined);
  const setUrgency = (next: Urgency) => {
    setUrgencyState(next);
    if (!deliveryPicked) setDelivery(deliveryFor(next));
  };
  const [text, setText] = useState(startTag ? startTag.draft(first, ctx) : (initialText ?? ""));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // The alert email has its own wording and no priority; every other note has both.
  const alertEmail = delivery === "email" && event !== null;
  // v1.5: a file waiting to go with this note.
  const filesOn = useFileSharing();
  const attach = useAttach();
  const canAttach = filesOn && !alertEmail;
  const hasFile = !!attach.file;
  const fileBlocks = hasFile && !!attach.view?.blocksSend;
  const priority = URGENCY.find((u) => u.value === urgency) ?? URGENCY[0];
  const via = DELIVERIES.find((d) => d.value === delivery) ?? DELIVERIES[0];

  const pickTag = (id: string) => {
    const next = tags.find((t) => t.id === id);
    if (!next) return;
    if (tag?.id === next.id) {
      setTag(null);
      return;
    }
    setTag(next);
    setUrgency(next.urgency);
    setText(next.draft(first, ctx));
    setNotice(null);
    textRef.current?.focus();
  };

  const sentNotice = () =>
    setNotice(delivery === "email" ? `Emailed to ${inbox}.` : delivery === "chat_email" ? `Sent to ${first}'s PC and emailed.` : `Sent to ${first}'s PC.`);

  // v1.5: the note with a file: upload (the chip shows how it goes), then send it with file_id. The text is the caption.
  const sendFile = async (body: string) => {
    if (delivery === "email") {
      setError("A file goes to their PC. Pick Chat or Chat + email to send it.");
      return;
    }
    const name = attach.file?.name ?? "";
    setPending(true);
    setError(null);
    const fallback = body ? body.split("\n")[0].slice(0, 80) + (body.length > 80 ? "…" : "") : `📎 ${name}`;
    const sent = await attach.send((fileId) =>
      sendMessage(person.id, {
        title: subjectLine(tag, event, fallback),
        body,
        severity: urgency,
        channel: delivery,
        file_id: fileId,
        ...(event ? { event_id: event.id } : {}),
      }),
    );
    setPending(false);
    if (!sent) return;
    sentNotice();
    setText("");
    setTag(null);
    onSent(delivery);
  };

  const send = async () => {
    const body = text.trim();
    if ((!body && !hasFile) || pending || fileBlocks) return;
    if (hasFile) {
      void sendFile(body);
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (alertEmail && event) {
        await emailAlert(event.id, { label: subjectLine(tag, event, eventMeta(event.type).label), suggested: body.slice(0, 300) });
      } else {
        const fallback = body.split("\n")[0].slice(0, 80) + (body.length > 80 ? "…" : "");
        await sendMessage(person.id, {
          title: subjectLine(tag, event, fallback),
          body,
          severity: urgency,
          channel: delivery,
          // Sending a note about an alert marks that alert handled.
          ...(event ? { event_id: event.id } : {}),
        });
      }
      sentNotice();
      setText("");
      setTag(null);
      onSent(delivery);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? "This alert was already emailed to them." : errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send();
  };

  return (
    <form className={cx("tc", compact && "tc--compact")} onSubmit={onSubmit} noValidate {...dropProps(attach, canAttach)}>
      <div className="tc__box">
        {hasFile ? <FileChip attach={attach} onRetry={() => void send()} /> : null}
        <label className="dash-sr" htmlFor={`tc-${person.id}`}>
          Message to {person.name}
        </label>
        <textarea
          ref={textRef}
          id={`tc-${person.id}`}
          className="tc__text"
          rows={2}
          maxLength={alertEmail ? 300 : MESSAGE_BODY_MAX}
          placeholder={`Message ${first}…`}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setNotice(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          onPaste={pasteFile(attach, canAttach)}
          disabled={pending}
        />

        <div className="tc__tools">
          {canAttach ? <AttachButton attach={attach} className="tc-dd__btn tc-attach" size={16} disabled={pending} /> : null}
          <ComposerMenu
            label="Suggestions"
            current={tag?.id ?? null}
            options={tags.map((t) => ({ value: t.id, label: t.label, icon: t.icon, note: draftPreview(t.draft(first, ctx)) }))}
            onPick={pickTag}
            trigger={
              <>
                <DashIcon name={tag?.icon ?? "book"} />
                {/* The bubble is narrow: there the picked suggestion shows as its icon (the text is in the box). */}
                {compact ? null : <span className="tc-dd__label tc-dd__label--suggest">{tag?.label ?? "Suggestions"}</span>}
              </>
            }
          />
          {!alertEmail ? (
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
          ) : null}
          <ComposerMenu
            label="Send via"
            alignEnd
            current={delivery}
            options={DELIVERIES.map((d) => ({
              ...d,
              note: d.value === "email" && event ? "One email about this alert" : d.note,
            }))}
            onPick={(value) => {
              setDelivery(value);
              setDeliveryPicked(true);
              setNotice(null);
            }}
            trigger={
              <>
                <DashIcon name={via.icon} />
                <span className="tc-dd__label">{via.label}</span>
              </>
            }
          />
          <button
            type="submit"
            className="btn btn--primary dash-btn-sm tc__send"
            disabled={pending || (!text.trim() && !hasFile) || fileBlocks}
            aria-label={pending ? "Sending" : "Send"}
          >
            <DashIcon name="send" />
            <span className="tc__send-label">{pending ? "Sending…" : "Send"}</span>
          </button>
        </div>
      </div>

      {error ? (
        <p className="form__err" role="alert">
          {error}
        </p>
      ) : notice ? (
        <p className="tc__notice" role="status">
          <DashIcon name="check" />
          {notice}
        </p>
      ) : (
        <p className="tc__hint" aria-hidden="true">
          <kbd>Enter</kbd> to send · <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line
        </p>
      )}
    </form>
  );
}

export default TaggedComposer;
