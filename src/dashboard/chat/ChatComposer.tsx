import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { useIsPhone } from "../../hooks/useIsPhone";
import { CHAT_BODY_MAX, errorMessage, MESSAGE_BODY_MAX, sendMessage, type ChatGroup, type ChatMessage, type Message, type MessageChannel } from "../../lib/api";
import { ComposerMenu } from "../components/TaggedComposer";
import { DashIcon } from "../components/DashIcon";
import { DELIVERIES, deliveryFor, draftPreview, subjectLine, tagsFor, URGENCY, type MessageTag, type Urgency } from "../features/messageTags";
import { Avatar } from "../tasks/Avatar";
import type { TaskPerson } from "../tasks/model";
import { TaskMark } from "../tasks/icons";
import { AttachButton, SendTray } from "./ChatFiles";
import { useFileSharing } from "./fileSharing";
import { changeGroupMessage, postGroupMessage } from "./groupsSource";
import { dropProps, pasteFile, useAttach } from "./useAttach";
import type { ReplyTarget } from "./reply";

type Person = TaskPerson & { memberId: number };

/**
 * The Chat page composer (DashChat): the task button, the message box and the round Send inside one box; "/" opens
 * the actions menu ("/task Send the deck" opens the task form with the title filled in). Under the text, the same
 * Suggestions / Priority / Send via (Chat, Chat + email, Email only) as the chat bubble. Enter sends,
 * Shift + Enter starts a new line. Without `onTask` there is no task button and no "/" menu.
 *
 * v1.4 (board DashChat): on desktop the box is taller and holds a row under the text (+ Task, Suggestions, Priority,
 * Send via, then the round Send); no help line under it. In a GROUP (`group`) the line goes to everyone in it (the
 * group API takes text and a reply only, so Priority and Send via are left out), typing "@" opens the group's people
 * in the "/" menu's look and inserts "@Karan", and `edit` turns the box into "Editing your message" (Send saves).
 *
 * Phone (760 px and under): one rounded box, the text on top and a row inside it: Task (icon), Ready message (icon,
 * opens a bottom sheet), the Priority and Send via chips (each opens a small menu above it) and the round Send. A chip
 * that isn't the default gets a grey fill. One muted line under the box says where the message goes. Phone keyboards
 * have no Shift, so there Enter starts a new line and only the Send button sends.
 *
 * v1.5 (file sharing): a paperclip ("Attach a file") next to + Task (desktop) or the Task icon (phone), shown when
 * Settings › Chat › Allow file sharing is on and not while editing. The picked file sits in a chip above the box
 * (dropping a file on the composer or pasting a picture does the same); the text becomes its caption. Send uploads
 * it with a thin orange bar in the chip, then posts the line with `file_id`.
 */
export function ChatComposer({
  person,
  group,
  edit = null,
  onCancelEdit,
  reply,
  onCancelReply,
  onJumpReply,
  onTask,
  onSent,
  onGroupSent,
}: {
  /** The person this chat is with (their own chat with the owner). */
  person?: Person;
  /** v1.4: a group conversation, and the team (for "@"). */
  group?: { group: ChatGroup; people: readonly Person[] };
  /** v1.4 groups: your line being edited (within 15 minutes). */
  edit?: { id: number; text: string } | null;
  onCancelEdit?: () => void;
  reply: ReplyTarget | null;
  onCancelReply: () => void;
  onJumpReply: () => void;
  /** Open the task form for this person, optionally with a title. Leave out to hide every task control. */
  onTask?: (title?: string) => void;
  /** After a send: how it went out, and the new line (shown in the thread at once). */
  onSent?: (delivery: MessageChannel, message?: Message) => void;
  /** v1.4 groups: after a send or an edit, the line as the server has it. */
  onGroupSent?: (message: ChatMessage, edited: boolean) => void;
}): ReactElement {
  const g = group?.group ?? null;
  const first = g ? g.name : (person?.first ?? "");
  // Ready messages greet the person, or everyone in a group.
  const greet = g ? "everyone" : first;
  const email = person?.member?.email ?? "their email";
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
  const phone = useIsPhone();
  // v1.5: a file waiting to go with this message (its chip shows above the box).
  const filesOn = useFileSharing();
  const attach = useAttach();
  const canAttach = filesOn && !edit;
  const hasFile = attach.has && !edit;
  const fileBlocks = hasFile && (attach.blocksSend || attach.busy);
  const [sheet, setSheet] = useState(false);
  const [menu, setMenu] = useState<"" | "prio" | "via">("");
  const [menuLeft, setMenuLeft] = useState(0);
  const [wasPhone, setWasPhone] = useState(phone);
  if (phone !== wasPhone) {
    setWasPhone(phone);
    if (!phone) {
      setMenu("");
      setSheet(false);
    }
  }
  const textRef = useRef<HTMLTextAreaElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const readyRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const prioRef = useRef<HTMLButtonElement>(null);
  const viaRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (sheet) sheetRef.current?.querySelector<HTMLElement>("button:not([tabindex='-1'])")?.focus();
  }, [sheet]);
  const closeSheet = () => {
    setSheet(false);
    readyRef.current?.focus();
  };

  // Phone: the box grows with the text up to six lines (Safari has no field-sizing yet).
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!phone || !el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 55), 144)}px`;
  }, [phone, text]);

  // Phone menus (Priority, Send via): open on the chosen item, close on a tap outside or Esc.
  const menuTrigger = () => (menu === "prio" ? prioRef.current : menu === "via" ? viaRef.current : null);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const trigger = menu === "prio" ? prioRef.current : viaRef.current;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !trigger?.contains(t)) setMenu("");
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMenu("");
        trigger?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);
  const toggleMenu = (which: "prio" | "via", btn: HTMLButtonElement | null) => {
    if (menu === which) {
      setMenu("");
      return;
    }
    const box = boxRef.current;
    if (box && btn) {
      const width = Math.min(272, box.clientWidth);
      const left = btn.getBoundingClientRect().left - box.getBoundingClientRect().left;
      setMenuLeft(Math.max(0, Math.min(left, box.clientWidth - width)));
    }
    setMenu(which);
  };
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number) => {
      e.preventDefault();
      items[(i + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Tab") setMenu("");
  };
  const pickFromMenu = (fn: () => void) => {
    const trigger = menuTrigger();
    fn();
    setMenu("");
    trigger?.focus();
  };

  // Editing one of your group lines: the box holds its text until Send (saves) or Cancel.
  const [seenEdit, setSeenEdit] = useState<{ id: number; text: string } | null>(null);
  if (edit !== seenEdit) {
    setSeenEdit(edit);
    setText(edit ? edit.text : "");
  }

  // A reply that comes with a draft ("Done, you have edit access now. ") fills the box once.
  const [seenReply, setSeenReply] = useState<ReplyTarget | null>(null);
  if (reply !== seenReply) {
    setSeenReply(reply);
    if (reply?.draft) setText(reply.draft);
  }

  // v1.4 groups: "@" opens the group's people; the chosen name goes in as "@Karan".
  const [atPick, setAtPick] = useState(0);
  const [atClosed, setAtClosed] = useState(false);
  const atWord = g ? /(?:^|\s)@(\w*)$/.exec(text)?.[1] : undefined;
  const atList: Person[] =
    g && atWord !== undefined && !atClosed
      ? (group?.people ?? [])
          .filter((p) => g.member_ids.includes(p.memberId))
          .filter((p) => p.first.toLowerCase().startsWith(atWord.toLowerCase()) || p.name.toLowerCase().startsWith(atWord.toLowerCase()))
          .slice(0, 6)
      : [];
  const atOpen = atList.length > 0;
  const atAt = Math.min(atPick, Math.max(0, atList.length - 1));
  const pickAt = (p: Person) => {
    setText((t) => t.replace(/@(\w*)$/, `@${p.first} `));
    setAtPick(0);
    textRef.current?.focus();
  };

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
    setText(next.draft(greet, noCtx));
    setNotice(null);
    textRef.current?.focus();
  };
  const pickDelivery = (value: MessageChannel) => {
    setDelivery(value);
    setDeliveryPicked(true);
    setNotice(null);
  };

  const slashWord = edit ? undefined : /^\/(\S*)/.exec(text)?.[1];
  const slashOpen = onTask !== undefined && slashWord !== undefined && !slashClosed && "task".startsWith(slashWord.toLowerCase()) && !/^\/\S*\n/.test(text);
  const slashTitle = text.replace(/^\/\S*\s*/, "").trim();
  const pickSlash = () => {
    onTask?.(slashTitle || undefined);
    setText("");
    setSlashClosed(false);
  };

  const send = async () => {
    const body = text.trim();
    if ((!body && !hasFile) || pending || slashOpen || fileBlocks) return;
    if (hasFile) {
      void sendFile(body);
      return;
    }
    setPending(true);
    setError(null);
    if (g) {
      try {
        const line = edit ? await changeGroupMessage(g.id, edit.id, body) : await postGroupMessage(g.id, body, reply?.messageId ?? null);
        setText("");
        setTag(null);
        onGroupSent?.(line, !!edit);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setPending(false);
      }
      return;
    }
    if (!person) {
      setPending(false);
      return;
    }
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
      onSent?.(delivery, sent);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  // v1.5: lines with files (round 2: each file is kept in this browser and registered, then one line per file, the
  // typed text as the caption of the last). The tray shows how each file goes.
  const sendFile = async (body: string) => {
    if (!g && delivery === "email") {
      setError("A file goes to their PC. Pick Chat or Chat + email to send it.");
      return;
    }
    setPending(true);
    setError(null);
    if (g) {
      const lines = await attach.send(
        async (fileId, caption, last) => {
          // A reply quotes above the last line (the batch grid and its caption sit there).
          const line = await postGroupMessage(g.id, caption, last ? (reply?.messageId ?? null) : null, fileId);
          onGroupSent?.(line, false);
          return line;
        },
        { caption: body, chat: g.name },
      );
      setPending(false);
      if (lines) {
        setText("");
        setTag(null);
      }
      return;
    }
    if (!person) {
      setPending(false);
      return;
    }
    const sent = await attach.send(
      async (fileId, caption, last, name) => {
        const fallback = caption ? caption.split("\n")[0].slice(0, 80) + (caption.length > 80 ? "…" : "") : `📎 ${name}`;
        const message = await sendMessage(person.memberId, {
          title: reply && last ? reply.subject : subjectLine(tag, null, fallback),
          body: caption,
          severity: urgency,
          channel: delivery,
          file_id: fileId,
        });
        onSent?.(delivery, message);
        return message;
      },
      { caption: body, chat: person.name },
    );
    setPending(false);
    if (!sent) return;
    setNotice(delivery === "chat_email" ? `Sent to ${first}'s PC and emailed.` : null);
    setText("");
    setTag(null);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const composing = e.nativeEvent.isComposing || e.keyCode === 229;
    if (atOpen) {
      if ((e.key === "Enter" && !composing) || e.key === "Tab") {
        e.preventDefault();
        pickAt(atList[atAt]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAtClosed(true);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setAtPick((atAt + (e.key === "ArrowDown" ? 1 : atList.length - 1)) % atList.length);
        return;
      }
    }
    if (slashOpen) {
      if ((e.key === "Enter" && !composing) || e.key === "Tab") {
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
    if (e.key === "Escape" && (reply || edit)) {
      e.preventDefault();
      if (edit) onCancelEdit?.();
      else onCancelReply();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !composing && !phone) {
      e.preventDefault();
      void send();
    }
  };

  const replyWho = reply ? reply.placeholder : "";
  // Phone: what each menu choice does, and one line under the box saying where this message goes.
  const priorityNote = (value: Urgency, hint: string) => (value === "info" || deliveryPicked ? hint : `${hint}. Emails ${first} too`);
  const viaNote = (value: MessageChannel) =>
    value === "chat" ? `${first}’s Zinwe window` : value === "chat_email" ? `The window and ${email}` : `Just ${email}, not the PC`;
  const whereLine = g
    ? `Goes to everyone in ${g.name}. It pops up on their PCs.`
    : delivery === "email"
      ? `Goes to ${email} only, not ${first}’s PC.`
      : `Goes to ${first}’s Zinwe window${delivery === "chat_email" ? ` and ${email}` : ""}. It pops up on their PC.`;
  const sendLabel = edit ? "Save your edit" : `Send message to ${first}`;
  const textarea = [
    <label key="msg-label" htmlFor="msg" className="z-sr">
      Message {first}
    </label>,
    <textarea
      key="msg"
      ref={textRef}
      id="msg"
      rows={2}
      maxLength={g ? CHAT_BODY_MAX : MESSAGE_BODY_MAX}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        setSlashClosed(false);
        setAtClosed(false);
        setNotice(null);
      }}
      onKeyDown={onKey}
      onPaste={pasteFile(attach, canAttach)}
      placeholder={edit ? "Edit your message…" : reply ? `Reply to ${replyWho}…` : `Message ${first}…`}
      aria-autocomplete="list"
      aria-controls={atOpen ? "at-menu" : slashOpen ? "slash-menu" : undefined}
      aria-expanded={slashOpen || atOpen}
      readOnly={pending}
      aria-disabled={pending || undefined}
      enterKeyHint={phone ? "enter" : "send"}
      className="cv-text"
    />,
  ];
  const sendOff = (!text.trim() && !hasFile) || slashOpen || pending || fileBlocks;
  const sendButton = (
    <button key="send" type="button" className="csend" aria-label={sendLabel} disabled={sendOff} onClick={() => void send()}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 12h13M13 6l6 6-6 6" />
      </svg>
    </button>
  );
  return (
    <div className="cv-compose" {...dropProps(attach, canAttach)}>
      {edit ? (
        <div className="cv-replying">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A84505" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}>
            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
          <span className="cv-replying__what">
            <span style={{ fontSize: 12, fontWeight: 600, color: "#A84505" }}>Editing your message</span>
            <span className="qt" style={{ fontSize: 13, color: "#404040" }}>
              {edit.text}
            </span>
          </span>
          <button type="button" aria-label="Cancel edit" onClick={onCancelEdit} className="cv-replying__x">
            ×
          </button>
        </div>
      ) : reply ? (
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
      {canAttach || hasFile ? <SendTray attach={attach} onRetry={() => void send()} /> : null}
      <div style={{ position: "relative" }} ref={boxRef}>
        {atOpen && g ? (
          <div id="at-menu" role="listbox" aria-label={`Tag someone in ${g.name}`} className="cv-slash">
            <span className="cv-slash__head">TAG SOMEONE IN {g.name.toUpperCase()}</span>
            {atList.map((p, i) => (
              <button
                key={p.memberId}
                type="button"
                role="option"
                aria-selected={i === atAt}
                className={i === atAt ? "slash-opt" : "slash-opt off"}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickAt(p);
                }}
              >
                <Avatar person={p} size={32} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.3, textAlign: "left" }}>
                  <b style={{ fontSize: 14 }}>{p.name}</b>
                  <small style={{ fontSize: 12, color: "#6B6B6B" }}>{p.role}</small>
                </span>
                <span className="z-mono" style={{ flex: "none", fontSize: 12, color: "#6B6B6B" }}>
                  @{p.first}
                </span>
              </button>
            ))}
            <span style={{ fontSize: 11.5, color: "#6B6B6B", padding: "4px 8px" }}>↑ ↓ to choose · Enter to tag · Esc to close</span>
          </div>
        ) : null}
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
                <b style={{ fontSize: 14 }}>{g ? `Create a task for the ${g.name} group` : `Create a task for ${first}`}</b>
                <small style={{ fontSize: 12, color: "#6B6B6B", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {slashTitle ? `“${slashTitle}”` : `Opens a quick task above the message box, for ${g ? "the group" : first}`}
                </small>
              </span>
              <span className="z-mono" style={{ flex: "none", fontSize: 12, color: "#6B6B6B" }}>
                /task
              </span>
            </button>
            <span style={{ fontSize: 11.5, color: "#6B6B6B", padding: "4px 8px" }}>↑ ↓ to choose · Enter to open · Esc to close</span>
          </div>
        ) : null}
        <div className={phone ? "cbox cbox--m" : "cbox cbox--d"}>
          {textarea}
          {phone ? (
            <div key="mrow" className="cv-mrow">
              {onTask ? (
                <button
                  type="button"
                  id="new-task"
                  className="cv-mtool cv-mtool--icon"
                  aria-label={g ? `Send a task to ${g.name}` : `Send a task to ${first}`}
                  title="Send a task"
                  aria-haspopup="dialog"
                  onClick={() => onTask()}
                >
                  <TaskMark size={15} stroke={1.9} />
                </button>
              ) : null}
              {canAttach ? <AttachButton attach={attach} className="cv-mtool cv-mtool--icon" size={16} disabled={pending} /> : null}
              <button
                ref={readyRef}
                type="button"
                className={`cv-mtool cv-mtool--icon${tag ? " set" : ""}`}
                aria-label={tag ? `Use a ready message (now: ${tag.label})` : "Use a ready message"}
                title="Use a ready message"
                aria-haspopup="dialog"
                aria-expanded={sheet}
                onClick={() => {
                  setMenu("");
                  setSheet(true);
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8.5 1.5L3 9h4.5l-1 5.5L12 7H7.5z" />
                </svg>
              </button>
              {g ? null : (
                <button
                  ref={prioRef}
                  type="button"
                  className={`cv-mtool cv-mtool--chip${urgency !== "info" ? ` set set--${urgency}` : ""}`}
                  aria-haspopup="menu"
                  aria-expanded={menu === "prio"}
                  aria-controls={menu === "prio" ? "cv-m-prio" : undefined}
                  aria-label={`Priority: ${priority.label}`}
                  onClick={(e) => toggleMenu("prio", e.currentTarget)}
                >
                  <i className="cv-mdot" aria-hidden="true" />
                  <span className="cv-mtool__label">{priority.label}</span>
                  <Chev />
                </button>
              )}
              {g ? null : (
                <button
                  ref={viaRef}
                  type="button"
                  className={`cv-mtool cv-mtool--chip${delivery !== "chat" ? " set" : ""}`}
                  aria-haspopup="menu"
                  aria-expanded={menu === "via"}
                  aria-controls={menu === "via" ? "cv-m-via" : undefined}
                  aria-label={`Send via: ${via.label}`}
                  onClick={(e) => toggleMenu("via", e.currentTarget)}
                >
                  <span className="cv-mtool__label cv-mtool__label--long">{via.label}</span>
                  <span className="cv-mtool__label cv-mtool__label--short" aria-hidden="true">
                    {VIA_SHORT[delivery]}
                  </span>
                  <Chev />
                </button>
              )}
              <span className="cv-mgrow" />
              <button
                type="button"
                className="csend cv-msend"
                aria-label={sendLabel}
                disabled={sendOff}
                onMouseDown={(e) => e.preventDefault() /* keep the keyboard up */}
                onClick={() => void send()}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
                </svg>
              </button>
            </div>
          ) : (
            <div key="drow" className="cv-drow">
              {onTask ? (
                <button
                  type="button"
                  id="new-task"
                  className="cicon ctask"
                  aria-label={g ? `Add a task for the ${g.name} group (or type /task)` : `Add a task for ${first} (or type /task)`}
                  title="Add a task · or type /task"
                  aria-haspopup="dialog"
                  onClick={() => onTask()}
                >
                  <TaskMark size={16} stroke={2} />
                  <span aria-hidden="true">+ Task</span>
                </button>
              ) : null}
              {canAttach ? <AttachButton attach={attach} className="cicon" disabled={pending} /> : null}
              <div className="cv-tools">
                <ComposerMenu
                  label="Suggestions"
                  current={tag?.id ?? null}
                  options={tags.map((t) => ({ value: t.id, label: t.label, icon: t.icon, note: draftPreview(t.draft(greet, noCtx)) }))}
                  onPick={pickTag}
                  trigger={
                    <>
                      <DashIcon name={tag?.icon ?? "book"} />
                      <span className="tc-dd__label tc-dd__label--suggest">{tag?.label ?? "Suggestions"}</span>
                    </>
                  }
                />
                {g ? null : (
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
                )}
                {g ? null : (
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
                )}
              </div>
              <span className="cv-mgrow" />
              {sendButton}
            </div>
          )}
        </div>
        {phone && menu ? (
          <div
            ref={menuRef}
            id={menu === "prio" ? "cv-m-prio" : "cv-m-via"}
            className="cv-mmenu"
            role="menu"
            aria-label={menu === "prio" ? "Priority" : "Send via"}
            style={{ left: menuLeft }}
            onKeyDown={onMenuKey}
          >
            <span className="cv-mmenu__head" aria-hidden="true">
              {menu === "prio" ? "Priority" : "Send via"}
            </span>
            {menu === "prio"
              ? URGENCY.map((u) => (
                  <button key={u.value} type="button" role="menuitemradio" aria-checked={u.value === urgency} onClick={() => pickFromMenu(() => setUrgency(u.value))}>
                    <span className="cv-mmenu__tick" aria-hidden="true">
                      {u.value === urgency ? "✓" : ""}
                    </span>
                    <span className="cv-mmenu__label">
                      <i className={`cv-mdot cv-mdot--${u.value}`} aria-hidden="true" />
                      {u.label}
                    </span>
                    <small>{priorityNote(u.value, u.hint)}</small>
                  </button>
                ))
              : DELIVERIES.map((d) => (
                  <button key={d.value} type="button" role="menuitemradio" aria-checked={d.value === delivery} onClick={() => pickFromMenu(() => pickDelivery(d.value))}>
                    <span className="cv-mmenu__tick" aria-hidden="true">
                      {d.value === delivery ? "✓" : ""}
                    </span>
                    <span className="cv-mmenu__label">{d.label}</span>
                    <small>{viaNote(d.value)}</small>
                  </button>
                ))}
          </div>
        ) : null}
      </div>
      {phone && sheet ? (
        <div className="cv-osheet-wrap">
          <button type="button" tabIndex={-1} className="cv-osheet-scrim" aria-label="Close ready messages" onClick={closeSheet} />
          <div
            ref={sheetRef}
            className="cv-osheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cv-ready-h"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                closeSheet();
              }
            }}
          >
            <span className="cv-osheet__grab" aria-hidden="true" />
            <b className="cv-osheet__title" id="cv-ready-h">
              Ready messages
            </b>
            <div className="cv-osheet__list">
              {tags.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`cv-orow${tag?.id === t.id ? " on" : ""}`}
                  aria-pressed={tag?.id === t.id}
                  onClick={() => {
                    if (tag?.id === t.id) {
                      closeSheet();
                      return;
                    }
                    setSheet(false);
                    pickTag(t.id);
                  }}
                >
                  <DashIcon name={t.icon} />
                  <span>
                    {t.label}
                    <small>{draftPreview(t.draft(greet, noCtx))}</small>
                  </span>
                </button>
              ))}
            </div>
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
      ) : phone ? (
        <span className="cv-mhint">{whereLine}</span>
      ) : null}
    </div>
  );
}

function Chev(): ReactElement {
  return (
    <svg className="cv-mtool__chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Send via on a 380 px phone, so the two chips read in full next to each other. */
const VIA_SHORT: Record<MessageChannel, string> = { chat: "Chat", chat_email: "Chat+mail", email: "Email" };
