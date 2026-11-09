/**
 * Owner ↔ member messaging: the two-way thread (admin notes + the member's
 * replies from their Zinwe widget) and the composers. Used by the Team tile's
 * chat dialog and the Team → Chat tab.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import {
  errorMessage,
  getMemberThread,
  batchRuns,
  normaliseFile,
  sendMessage,
  MESSAGE_BODY_MAX,
  MESSAGE_TITLE_MAX,
  type EventSeverity,
  type Member,
  type Message,
  type MessageField,
  type MessagePayload,
} from "../../lib/api";
import { cx } from "../../lib/cx";
import { TASK_STATUS } from "../tasks/types";
import { compactErrors, focusFirstInvalid, requiredError, type FieldErrorMap } from "../../lib/validation";
import { apiFieldErrors, apiFormError } from "../../portal/failure";
import { Field } from "../../components/forms/Field";
import { FormAlert } from "../../portal/components/FormAlert";
import { CHAT_READ_EVENT } from "../features/chatEvents";
import { formatRelative, useNow } from "../time";
import { FileBubbleBody } from "../chat/ChatFiles";
import { DashIcon } from "./DashIcon";
import { Linkified } from "./Linkified";
import { TaggedComposer } from "./TaggedComposer";

const MESSAGE_FIELDS: readonly MessageField[] = ["title", "body", "severity"];

/** The importance levels, matched to the agent's "info" | "warning" | "critical". */
const SEVERITY_OPTIONS: ReadonlyArray<{ value: EventSeverity; label: string }> = [
  { value: "info", label: "Info — a normal heads-up" },
  { value: "warning", label: "Warning — please take note" },
  { value: "critical", label: "Critical — needs attention now" },
];

/** One-click fill for the most common notice. The owner can still edit it before sending. */
const USB_PRESET = {
  title: "USB storage is now blocked",
  body: "Your company has blocked copying to USB drives on this PC.",
  severity: "warning" as EventSeverity,
};

function titleError(value: string): string | undefined {
  const required = requiredError(value);
  if (required) return required;
  return value.trim().length > MESSAGE_TITLE_MAX
    ? `Keep the title to ${MESSAGE_TITLE_MAX} characters or fewer.`
    : undefined;
}

function bodyError(value: string): string | undefined {
  return value.trim().length > MESSAGE_BODY_MAX
    ? `Keep the message to ${MESSAGE_BODY_MAX} characters or fewer.`
    : undefined;
}

/** How an admin line went out, after its time ("" for plain chat). */
const CHANNEL_NOTE: Record<NonNullable<Message["channel"]>, string> = {
  chat: "",
  chat_email: " · chat + email",
  email: " · email only",
};

/**
 * Read receipt for the admin's latest line: Sent → Delivered (on their PC) → Seen (opened in the widget).
 * An email-only line never reaches the PC, so it just says it was emailed.
 */
function Receipt({ message: m, now, online }: { message: Message; now: number; online?: boolean }): ReactElement {
  const label =
    m.channel === "email"
      ? "Emailed"
      : m.read_by_member
        ? m.read_by_member_at
          ? `Seen ${formatRelative(m.read_by_member_at, now, "just now")}`
          : "Seen"
        : m.delivered_at
          ? "Delivered"
          : online === false
            ? "Sent — shows on their PC when it's online"
            : "Sent — on its way to their PC";
  return (
    <span className={cx("team-chat__receipt", m.read_by_member && "is-seen")} aria-live="polite">
      {label}
    </span>
  );
}

/** The two-way conversation with one member: admin alerts and the member's replies, oldest→newest. */
export function MemberChatThread({
  member,
  reloadKey,
  online,
}: {
  member: Pick<Member, "id" | "name">;
  reloadKey: number;
  /** Whether their PC is online right now (unknown = undefined): words the "Sent" receipt. */
  online?: boolean;
}): ReactElement {
  const [thread, setThread] = useState<Message[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(30_000);
  const lastReplyId = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    // Fetching the thread also marks the member's replies read server-side.
    getMemberThread(member.id)
      .then((msgs) => {
        if (!alive) return;
        setThread(msgs);
        // A new reply was just read here: let the sidebar badge catch up instead of waiting for its poll.
        const newest = msgs.find((m) => m.sender === "member")?.id ?? null;
        if (newest !== lastReplyId.current) {
          lastReplyId.current = newest;
          window.dispatchEvent(new Event(CHAT_READ_EVENT));
        }
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [member.id, reloadKey]);

  if (error) {
    return <p className="form__err" role="alert">{error}</p>;
  }
  if (thread === undefined) {
    return <p className="dash-note">Loading conversation…</p>;
  }
  if (thread.length === 0) {
    return <p className="dash-note team-chat__empty">No messages yet — send the first one below.</p>;
  }

  const ordered = [...thread].reverse(); // API is newest-first; show like a chat (oldest → newest)
  const firstName = member.name.trim().split(/\s+/)[0] || "Member";
  // The receipt sits under the admin's latest line only (like most chat apps).
  const lastOwnerId = thread.find((m) => m.sender === "owner")?.id;
  // v1.5 round 2: photos and videos sent together show as one grid on the run's last line.
  const runs = batchRuns(ordered.map((m) => ({ key: String(m.id), from: m.sender, file: m.kind === "task" ? null : normaliseFile(m.file) })));
  return (
    <div className="team-chat" role="log" aria-label={`Conversation with ${member.name}`}>
      {ordered.map((m) => {
        // v1.5: a line with a file shows its card + caption, not its body (the fallback text for old clients).
        const file = m.kind === "task" ? null : normaliseFile(m.file);
        const run = runs.get(String(m.id));
        if (run?.role === "skip") return null;
        return (
        <div
          key={m.id}
          className={cx(
            "team-chat__msg",
            m.sender === "owner" ? "team-chat__msg--out" : "team-chat__msg--in",
            m.channel === "email" && "team-chat__msg--email",
          )}
        >
          {m.kind === "task" && m.task ? (
            // FR-20: a task line shows the task and where it stands (the full card is on Chat and Tasks).
            <>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", opacity: 0.8 }}>TASK · {TASK_STATUS[m.task.status][0].toUpperCase()}</span>
              <b className="team-chat__title">{m.task.title}</b>
              {m.task.steps.length ? (
                <span className="team-chat__body">
                  {m.task.steps.filter((s) => s.done).length}/{m.task.steps.length} steps
                </span>
              ) : null}
            </>
          ) : file ? (
            <FileBubbleBody file={file} mine={m.sender === "owner"} sender={firstName} batch={run?.role === "lead" ? run.files : null} />
          ) : (
            <>
              {/* A long chat note is sent as a cut-down title + the full text; show the text once. */}
              {m.sender === "owner" && m.title && !(m.body && m.body.startsWith(m.title.replace(/…$/, ""))) ? (
                <b className="team-chat__title">{m.title}</b>
              ) : null}
              {m.body ? <span className="team-chat__body"><Linkified text={m.body} /></span> : m.title ? null : <span className="team-chat__body">—</span>}
            </>
          )}
          <time className="team-chat__time">
            {m.sender === "owner" ? "You" : firstName} · {formatRelative(m.created_at, now, "just now")}
            {m.sender === "owner" && m.channel ? CHANNEL_NOTE[m.channel] : ""}
          </time>
          {m.id === lastOwnerId ? <Receipt message={m} now={now} online={online} /> : null}
        </div>
        );
      })}
    </div>
  );
}

/** Compose + send a short message to one member; it lands in their Zinwe widget. */
export function SendMessageForm({ member, onClose, onSent }: { member: Member; onClose: () => void; onSent?: () => void }): ReactElement {
  const [draft, setDraft] = useState<{ title: string; body: string; severity: EventSeverity }>({
    title: "",
    body: "",
    severity: "info",
  });
  const [errors, setErrors] = useState<FieldErrorMap<MessageField>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const controls = useRef<Partial<Record<MessageField, HTMLElement | null>>>({});

  const reg = (field: MessageField) => (el: HTMLElement | null) => {
    controls.current[field] = el;
  };
  const update = (patch: Partial<typeof draft>, clear?: MessageField) => {
    setDraft((d) => ({ ...d, ...patch }));
    if (clear) setErrors((e) => (e[clear] ? { ...e, [clear]: undefined } : e));
    setSent(null);
  };

  const fillPreset = () => {
    setDraft({ ...USB_PRESET });
    setErrors({});
    setFormError(null);
    setSent(null);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const clean = { title: draft.title.trim(), body: draft.body.trim() };
    const clientErrors = compactErrors<MessageField>({
      title: titleError(draft.title),
      body: bodyError(draft.body),
    });
    setErrors(clientErrors);
    setFormError(null);
    setSent(null);
    if (Object.keys(clientErrors).length > 0) return focusFirstInvalid(MESSAGE_FIELDS, clientErrors, controls.current);

    const payload: MessagePayload = { title: clean.title, severity: draft.severity };
    if (clean.body) payload.body = clean.body;

    setPending(true);
    try {
      await sendMessage(member.id, payload);
      setDraft({ title: "", body: "", severity: "info" });
      setSent(clean.title);
      onSent?.();
    } catch (error) {
      const fieldErrors = apiFieldErrors(error, MESSAGE_FIELDS);
      setErrors(fieldErrors);
      setFormError(apiFormError(error, MESSAGE_FIELDS));
      focusFirstInvalid(MESSAGE_FIELDS, fieldErrors, controls.current);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="team-msg" role="group" aria-label={`Send a message to ${member.name}`}>

      <button
        type="button"
        className="btn btn--ghost dash-btn-sm team-msg__preset"
        onClick={fillPreset}
        disabled={pending}
      >
        <DashIcon name="usb" />
        Use the "USB blocked" message
      </button>

      <form className="co-form" onSubmit={onSubmit} noValidate>
        <Field error={errors.title}>
          <label htmlFor={`msg-title-${member.id}`}>Title</label>
          <input
            ref={reg("title")}
            id={`msg-title-${member.id}`}
            maxLength={MESSAGE_TITLE_MAX}
            placeholder="USB storage is now blocked"
            value={draft.title}
            onChange={(e) => update({ title: e.target.value }, "title")}
            aria-invalid={errors.title ? true : undefined}
          />
        </Field>

        <Field error={errors.body}>
          <label htmlFor={`msg-body-${member.id}`}>
            Message <small>(optional)</small>
          </label>
          <textarea
            ref={reg("body")}
            id={`msg-body-${member.id}`}
            maxLength={MESSAGE_BODY_MAX}
            rows={3}
            placeholder="Your company has blocked copying to USB drives on this PC."
            value={draft.body}
            onChange={(e) => update({ body: e.target.value }, "body")}
            aria-invalid={errors.body ? true : undefined}
          />
        </Field>

        <Field error={errors.severity}>
          <label htmlFor={`msg-sev-${member.id}`}>Importance</label>
          <select
            ref={reg("severity")}
            id={`msg-sev-${member.id}`}
            value={draft.severity}
            onChange={(e) => update({ severity: e.target.value as EventSeverity })}
          >
            {SEVERITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <FormAlert message={formError} />
        {sent ? (
          <p className="dash-banner dash-banner--ok" role="status">
            <DashIcon name="check" />
            <span>
              Sent to <b>{member.name}</b>. "{sent}" will show in their Zinwe widget shortly.
            </span>
          </p>
        ) : null}

        <div className="co-form__foot">
          <button type="submit" className="btn btn--primary dash-btn-sm" disabled={pending}>
            {pending ? "Sending…" : "Send to widget"}
          </button>
          <button type="button" className="btn btn--ghost dash-btn-sm" onClick={onClose} disabled={pending}>
            Close
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * The Chat page composer: the same tagged composer as the chat bubble (suggestions, priority,
 * chat / chat + email / email only), without alert-only options.
 */
export function ChatComposer({ member, onSent }: { member: Member; onSent: () => void }): ReactElement {
  return (
    <div className="tchat__compose">
      <TaggedComposer person={member} onSent={onSent} />
    </div>
  );
}
