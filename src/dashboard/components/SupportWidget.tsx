import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import {
  errorMessage,
  getSupportTicket,
  listSupportTickets,
  openSupportTicket,
  replySupportTicket,
  type SupportCategory,
  type SupportTicket,
} from "../../lib/api";
import { cx } from "../../lib/cx";
import { readFabHidden, SUPPORT_OPEN_EVENT, SUPPORT_SHOW_EVENT, writeFabHidden } from "../features/support";
import { useTabBadge } from "../features/useOwnerNotifications";
import { announcePanel, useFloatSlot, useOtherPanel, usePanelEscape } from "../float/slots";
import { useShell } from "../shell/shellContext";
import { formatTime } from "../time";
import { useResource } from "../useResource";
import { Sk, Spinner } from "../ui/States";
import { ZIcon } from "../ui/ZIcon";
import { Linkified } from "./Linkified";
import "../../styles/dash13/float.css";

const CATEGORIES: ReadonlyArray<{ value: SupportCategory; label: string }> = [
  { value: "question", label: "A question" },
  { value: "problem", label: "Something isn't working" },
  { value: "setup", label: "Setting up PCs" },
  { value: "billing", label: "Billing" },
  { value: "idea", label: "An idea or request" },
];

/** Board: meta "Answered · Mon 26 Oct", pill "Answered" (green) / "Open" (amber). */
const STATUS: Record<SupportTicket["status"], { meta: string; pill: string; tone: string }> = {
  open: { meta: "Waiting for us", pill: "Open", tone: "amber" },
  answered: { meta: "Answered", pill: "Answered", tone: "green" },
  closed: { meta: "Closed", pill: "Closed", tone: "grey" },
};

const P_HELP = "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01";
const P_X = "M6 6l12 12M18 6 6 18";

const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });

/** "Mon 26 Oct". */
function dayOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : dayFmt.format(d).replace(",", "");
}

type View = { kind: "list" } | { kind: "new" } | { kind: "thread"; id: number };

/**
 * The dark floating "Support" button and its small help desk (board DashFloat), bottom-right on every dashboard
 * page. Owners message the Zinwe team (who are emailed and answer in the admin app); replies come back here and
 * by email. `?support=<id>` (from the reply email) opens that conversation; `openSupport()` opens the panel.
 *
 * The small × hides the button (remembered per account, features/support.ts); Undo, or Help & support's
 * "Show it again" (`showSupportButton()`), brings it back. While hidden it still shows when the team has replied,
 * and while the panel is open. On a phone it's a 44 px round button just above the tab bar.
 *
 * It also keeps the browser tab's count (useTabBadge), since it's the one floating piece on every page.
 */
export function SupportWidget({ userId }: { userId?: number }): ReactElement | null {
  const fabSlot = useFloatSlot("support");
  const panelSlot = useFloatSlot("panel");
  const toastSlot = useFloatSlot("toast");
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const [openState, setOpenState] = useState(false);
  const [viewState, setViewState] = useState<View>({ kind: "list" });
  const [fabHidden, setFabHidden] = useState(() => readFabHidden(userId));
  const [toast, setToast] = useState<{ text: string; undo: boolean } | null>(null);
  const fab = useRef<HTMLButtonElement>(null);

  const shell = useShell();
  useTabBadge(shell.unread + shell.tasksWaiting + shell.alerts);

  const load = useCallback((signal: AbortSignal) => listSupportTickets(signal), []);
  const tickets = useResource(load, { pollMs: 60_000 });
  const unread = (tickets.data ?? []).reduce((sum, t) => sum + t.unread, 0);

  // openSupport(): open the panel on the conversation list.
  useEffect(() => {
    const onOpen = () => {
      setViewState({ kind: "list" });
      setOpenState(true);
      announcePanel("support");
    };
    window.addEventListener(SUPPORT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(SUPPORT_OPEN_EVENT, onOpen);
  }, []);

  const showFabAgain = useCallback(() => {
    setFabHidden(false);
    writeFabHidden(userId, false);
    setToast(null);
  }, [userId]);

  // Help & support → "Show it again".
  useEffect(() => {
    window.addEventListener(SUPPORT_SHOW_EVENT, showFabAgain);
    return () => window.removeEventListener(SUPPORT_SHOW_EVENT, showFabAgain);
  }, [showFabAgain]);

  // The toast goes after 6 seconds (board `flash`).
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(id);
  }, [toast]);

  // Deep link from the "we answered" email: ?support=<id> opens that conversation until the owner moves on.
  const linkedRaw = Number(params.get("support"));
  const linked = Number.isInteger(linkedRaw) && linkedRaw > 0 ? linkedRaw : null;
  const open = openState || linked !== null;
  const view: View = linked !== null ? { kind: "thread", id: linked } : viewState;
  const dropLink = () => {
    if (linked === null) return;
    const next = new URLSearchParams(params);
    next.delete("support");
    setParams(next, { replace: true });
  };
  const setView = (next: View) => {
    dropLink();
    setOpenState(true);
    setViewState(next);
  };
  const setOpen = (next: boolean) => {
    dropLink();
    if (next) announcePanel("support");
    setOpenState(next);
    if (next) setViewState({ kind: "list" });
  };
  const closeFromOther = useCallback(() => setOpenState(false), []);
  useOtherPanel("support", closeFromOther);
  const escape = useCallback(() => {
    if (linked !== null) {
      const next = new URLSearchParams(params);
      next.delete("support");
      setParams(next, { replace: true });
    }
    setOpenState(false);
    fab.current?.focus();
  }, [linked, params, setParams]);
  usePanelEscape(open, escape);
  const close = () => {
    setOpen(false);
    fab.current?.focus();
  };
  const showFab = !fabHidden || open || unread > 0;
  const hideFab = () => {
    setFabHidden(true);
    writeFabHidden(userId, true);
    setToast({ text: "Support button hidden. Bring it back from Help & support.", undo: true });
  };

  if (!fabSlot || !panelSlot || !toastSlot) return null;

  const title = view.kind === "new" ? "New message" : view.kind === "thread" ? "Conversation" : "Help & support";
  const panel = open ? (
    <section className="zfl-panel zf-panel--sup" role="dialog" aria-label="Help and support">
      <header className="zf-shead">
        {view.kind !== "list" ? (
          <button type="button" className="zf-sicon" aria-label="Back" onClick={() => setView({ kind: "list" })}>
            <span aria-hidden="true">←</span>
          </button>
        ) : null}
        <span className="zf-stitle">
          <b>{title}</b>
          <small>The Zinwe team usually replies within a working day, here and by email.</small>
        </span>
        <button type="button" className="zf-sicon" aria-label="Close support" onClick={close}>
          <ZIcon d={P_X} size={16} stroke={2.2} />
        </button>
      </header>

      {view.kind === "list" ? (
        <TicketList
          tickets={tickets.data}
          error={tickets.error ? errorMessage(tickets.error) : null}
          onRetry={tickets.reload}
          onNew={() => setView({ kind: "new" })}
          onOpen={(id) => setView({ kind: "thread", id })}
        />
      ) : view.kind === "new" ? (
        <NewTicket
          page={pathname}
          onCreated={() => {
            tickets.reload();
            setView({ kind: "list" });
            setToast({ text: "Sent to the Zinwe team. We reply here and by email.", undo: false });
          }}
        />
      ) : (
        <Thread id={view.id} onChanged={tickets.reload} />
      )}
    </section>
  ) : null;

  return (
    <>
      {panel ? createPortal(panel, panelSlot) : null}
      {toast
        ? createPortal(
            <div className="zf-dtoast" role="status">
              <span>{toast.text}</span>
              {toast.undo ? (
                <button type="button" onClick={showFabAgain}>
                  Undo
                </button>
              ) : null}
            </div>,
            toastSlot,
          )
        : null}
      {showFab
        ? createPortal(
            <span className="zf-supwrap">
              <button
                ref={fab}
                type="button"
                className="zf-fab zf-sup"
                data-tour="support"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                aria-label={open ? "Close support" : `Help and support${unread > 0 ? `, ${unread} new ${unread === 1 ? "reply" : "replies"}` : ""}`}
              >
                <ZIcon d={open ? P_X : P_HELP} size={20} stroke={2} />
                <span className="zf-label">{open ? "Close" : "Support"}</span>
                {unread > 0 && !open ? (
                  <span className="zf-badge" aria-hidden="true">
                    {unread}
                  </span>
                ) : null}
              </button>
              {/* Put the button away (not while the panel is open or a reply is waiting). */}
              {!open && unread === 0 ? (
                <button type="button" className="zf-hide" aria-label="Hide the Support button" title="Hide the Support button" onClick={hideFab}>
                  <ZIcon d={P_X} size={10} stroke={3} />
                </button>
              ) : null}
            </span>,
            fabSlot,
          )
        : null}
    </>
  );
}

function TicketList({
  tickets,
  error,
  onRetry,
  onNew,
  onOpen,
}: {
  tickets: SupportTicket[] | undefined;
  error: string | null;
  onRetry: () => void;
  onNew: () => void;
  onOpen: (id: number) => void;
}): ReactElement {
  return (
    <div className="zf-sbody">
      <p className="zf-sintro">Stuck on something? Send us a message. We answer here and by email.</p>
      <button type="button" className="zf-sbtn" onClick={onNew}>
        New message
      </button>
      {error && tickets === undefined ? (
        <p className="zf-serr" role="alert">
          {error}{" "}
          <button type="button" className="zf-slink" onClick={onRetry}>
            Try again
          </button>
        </p>
      ) : tickets === undefined ? (
        <div role="status" aria-busy="true" className="zf-slist">
          <span className="z-sr">Loading your conversations</span>
          {[0, 1].map((i) => (
            <div key={i} className="zf-tk zf-tk--sk" aria-hidden="true">
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                <Sk w={`${70 - i * 15}%`} h={12} />
                <Sk w="40%" h={10} />
              </span>
              <Sk w={64} h={20} style={{ borderRadius: 999 }} />
            </div>
          ))}
        </div>
      ) : tickets.length > 0 ? (
        <>
          <span className="zf-slbl">YOUR CONVERSATIONS</span>
          <ul className="zf-slist">
            {tickets.map((t) => {
              const st = STATUS[t.status];
              return (
                <li key={t.id}>
                  <button type="button" className={cx("zf-tk", t.unread > 0 && "is-unread")} onClick={() => onOpen(t.id)}>
                    <span className="zf-tk__txt">
                      <b>{t.subject}</b>
                      <small>
                        {st.meta} · {dayOf(t.updated_at)}
                      </small>
                    </span>
                    {t.unread > 0 ? (
                      <span className="zf-count" aria-label={`${t.unread} new`}>
                        {t.unread}
                      </span>
                    ) : null}
                    <span className={`zf-spill ${st.tone}`}>{st.pill}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      <ReportIssueLink />
      <Link className="zf-slink" to="/app/help">
        Guides and answers in Help &amp; support →
      </Link>
    </div>
  );
}

/** Something broken: the Report an issue form, where a screenshot can go along. */
function ReportIssueLink(): ReactElement {
  const { openFeedback } = useShell();
  return (
    <button type="button" className="zf-slink" onClick={() => openFeedback("issue")}>
      Something broken? Report it with a screenshot →
    </button>
  );
}

function NewTicket({ page, onCreated }: { page: string; onCreated: () => void }): ReactElement {
  const [category, setCategory] = useState<SupportCategory>("question");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tip, setTip] = useState(false);
  const off = !message.trim();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (off) {
      setTip(true);
      return;
    }
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      // No subject box: the backend titles the conversation from the message's first line.
      await openSupportTicket({ category, message: message.trim(), page });
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <form className="zf-sbody" onSubmit={onSubmit} noValidate>
      <label className="zf-sfield">
        What is it about?
        <select value={category} onChange={(e) => setCategory(e.target.value as SupportCategory)}>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="zf-sfield">
        Your message
        <textarea
          rows={5}
          maxLength={4000}
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            setTip(false);
          }}
          placeholder="What happened, on which PC, and what you expected."
        />
      </label>
      {error ? (
        <p className="zf-serr" role="alert">
          {error}
        </p>
      ) : null}
      <div className="zf-ssend" onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)}>
        <button
          type="submit"
          className={cx("zf-sbtn", off && "is-off")}
          aria-disabled={off}
          aria-describedby={off && tip ? "zf-send-tip" : undefined}
          onFocus={() => setTip(true)}
          onBlur={() => setTip(false)}
          disabled={pending}
        >
          {pending ? <Spinner size={16} tone="on-orange" /> : null}
          {pending ? "Sending…" : "Send to Zinwe"}
        </button>
        {off && tip ? (
          <span id="zf-send-tip" role="tooltip" className="zf-tip">
            Write a message first.
          </span>
        ) : null}
      </div>
    </form>
  );
}

function Thread({ id, onChanged }: { id: number; onChanged: () => void }): ReactElement {
  // Opening the thread reads the team's replies server-side, so refresh the unread badge after each load.
  const changed = useRef(onChanged);
  useEffect(() => {
    changed.current = onChanged;
  }, [onChanged]);
  const load = useCallback(
    async (signal: AbortSignal) => {
      const detail = await getSupportTicket(id, signal);
      changed.current();
      return detail;
    },
    [id],
  );
  const ticket = useResource(load, { pollMs: 30_000 });
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const count = ticket.data?.messages.length ?? 0;

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [count]);

  const send = async () => {
    if (!text.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      await replySupportTicket(id, text.trim());
      setText("");
      ticket.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  if (ticket.data === undefined) {
    return (
      <div className="zf-sbody">
        {ticket.error ? (
          <p className="zf-serr" role="alert">
            {errorMessage(ticket.error)}{" "}
            <button type="button" className="zf-slink" onClick={ticket.reload}>
              Try again
            </button>
          </p>
        ) : (
          <div role="status" aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span className="z-sr">Loading the conversation</span>
            <Sk w="60%" h={14} />
            <Sk w="78%" h={52} style={{ alignSelf: "flex-end", borderRadius: 12 }} />
            <Sk w="70%" h={52} style={{ borderRadius: 12 }} />
          </div>
        )}
      </div>
    );
  }
  const t = ticket.data;
  const st = STATUS[t.status];
  return (
    <>
      <div className="zf-sbody zf-sthread" ref={log} role="log" aria-label="Conversation">
        <span className="zf-ssubj">
          <b>{t.subject}</b>
          <span className={`zf-spill ${st.tone}`}>{st.pill}</span>
        </span>
        {t.messages.map((m) => (
          <div key={m.id} className={cx("zf-smsg", m.sender === "owner" ? "is-me" : "is-them")}>
            <span>
              <Linkified text={m.body} />
            </span>
            <small>
              {m.sender === "owner" ? "You" : m.author_name || "Zinwe team"} · {dayOf(m.created_at)}, {formatTime(m.created_at)}
            </small>
          </div>
        ))}
      </div>
      <form
        className="zf-sreply"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {error ? (
          <p className="zf-serr" role="alert">
            {error}
          </p>
        ) : null}
        <div className="zf-cbox">
          <label htmlFor={`zf-sup-reply-${id}`} className="z-sr">
            Reply to the Zinwe team
          </label>
          <textarea
            id={`zf-sup-reply-${id}`}
            className="zf-msg"
            rows={1}
            maxLength={4000}
            placeholder={t.status === "closed" ? "Write to reopen this conversation…" : "Write a reply…"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button type="submit" className="zf-send" aria-label="Send to the Zinwe team" disabled={pending || !text.trim()}>
            {pending ? <Spinner size={16} /> : <ZIcon name="send" size={17} stroke={2.2} />}
          </button>
        </div>
      </form>
    </>
  );
}

export default SupportWidget;
