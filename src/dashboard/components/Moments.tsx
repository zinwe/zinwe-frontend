import { useEffect, useRef, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import {
  answerAnnouncement,
  errorMessage,
  markAnnouncementSeen,
  sendFeedbackPrompt,
  type Announcement,
  type AnnouncementCoupon,
} from "../../lib/api";
import { ZIcon } from "../ui/ZIcon";
import { FeedbackForm } from "./FeedbackForm";

/**
 * F-11 (v1.3.3), two quiet ways the dashboard speaks up:
 *  - MomentPopup: one pop-up from the announcements feed (news, a new version, a wish; offers on free plans). The
 *    server decides when it is due (first login after it goes live, then every 2nd day, then weekly, at most 3 views,
 *    one a day), so this only shows it, says "seen" when it shows and "closed" when the owner closes it.
 *    v1.3.5 (F-22): the User interactions kinds (feedback ask, upgrade ask, wish, offer with a coupon) come the same
 *    way, and one can be due as the owner signs out (AppLayout asks before signing out).
 *  - FeedbackPrompt: a small card, never a blocking dialog, when the account says it's time to ask (me.feedback_prompt_due).
 */

const KIND_LABEL: Partial<Record<Announcement["kind"], string>> = {
  version: "New in Zinwe",
  news: "News",
  wish: "From the Zinwe team",
  offer: "Offer",
  discount: "Offer",
  upgrade_ask: "Your plan",
};

/** The picture when staff didn't upload one: calm art per kind, white, black and orange only. */
function MomentArt({ kind }: { kind: Announcement["kind"] }): ReactElement {
  const offer = kind === "offer" || kind === "discount" || kind === "upgrade" || kind === "upgrade_ask";
  const wish = kind === "wish";
  return (
    <svg className="zn-moment__art" viewBox="0 0 440 220" role="presentation" aria-hidden="true">
      <rect width="440" height="220" fill="#FFF6EE" />
      <circle cx="372" cy="40" r="90" fill="#FDEBDC" />
      <circle cx="58" cy="196" r="70" fill="#FDEBDC" />
      {offer ? (
        <g transform="translate(160 46)">
          <rect x="0" y="34" width="120" height="96" rx="14" fill="#141210" />
          <rect x="-8" y="16" width="136" height="30" rx="10" fill="#F26A0A" />
          <rect x="52" y="16" width="16" height="114" fill="#FFF6EE" opacity=".9" />
          <path d="M60 16c-14-22-40-20-38-4 2 12 24 8 38 4zm0 0c14-22 40-20 38-4-2 12-24 8-38 4z" fill="none" stroke="#F26A0A" strokeWidth="7" strokeLinejoin="round" />
          <text x="60" y="104" textAnchor="middle" fontFamily="Geist, Segoe UI, sans-serif" fontSize="34" fontWeight="700" fill="#FFFFFF">%</text>
        </g>
      ) : wish ? (
        <g transform="translate(170 60)">
          <path d="M50 8c10 16 18 26 18 40a18 18 0 0 1-36 0c0-14 8-24 18-40z" fill="#F26A0A" />
          <path d="M50 30c5 9 8 13 8 20a8 8 0 0 1-16 0c0-7 3-11 8-20z" fill="#FFD27A" />
          <path d="M0 92c14 34 86 34 100 0z" fill="#141210" />
          <rect x="-6" y="86" width="112" height="10" rx="5" fill="#141210" />
        </g>
      ) : (
        <g transform="translate(150 50)">
          <rect x="0" y="0" width="140" height="104" rx="14" fill="#FFFFFF" stroke="#141210" strokeWidth="5" />
          <rect x="18" y="22" width="60" height="10" rx="5" fill="#141210" />
          <rect x="18" y="44" width="104" height="8" rx="4" fill="#D4D4D4" />
          <rect x="18" y="60" width="84" height="8" rx="4" fill="#D4D4D4" />
          <circle cx="126" cy="4" r="20" fill="#F26A0A" />
          <path d="M126 -6v20M116 4h20" stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round" />
        </g>
      )}
    </svg>
  );
}

/** Waits for a call at most `ms`, and never throws: sign-out must not hang on the network. */
function bounded(call: Promise<unknown>, ms: number): Promise<void> {
  return Promise.race([call.then(() => undefined), new Promise<void>((done) => setTimeout(done, ms))]).catch(() => undefined);
}

/** "{first name}" the server didn't fill in: the token and the comma or space before it go ("Happy New Year"). */
function withoutNameToken(text: string): string {
  return text.replace(/[,\s]*\{first name\}/gi, "");
}

/** The coupon code an offer carries (an object, or a bare code on some backends). */
function couponOf(item: Announcement): AnnouncementCoupon | null {
  const c = item.coupon;
  if (!c) return null;
  if (typeof c === "string") return c.trim() ? { code: c.trim().toUpperCase() } : null;
  return c.code ? c : null;
}

/** /onboarding/plan?coupon=<CODE>[&plan=<code>]: the plan page, which carries the code to the payment page. */
function couponHref(coupon: AnnouncementCoupon): string {
  const query = new URLSearchParams({ coupon: coupon.code });
  if (coupon.plan_code) query.set("plan", coupon.plan_code);
  return `/onboarding/plan?${query.toString()}`;
}

const SCALE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/** A feedback ask's 1-10 score: one row of ten, a radio group (arrow keys move), with its two end labels. */
function ScoreScale({ value, onChange, disabled }: { value: number; onChange: (n: number) => void; disabled: boolean }): ReactElement {
  return (
    <div className="zn-moment__score">
      <div className="zn-moment__scale" role="radiogroup" aria-label="Your score, 1 to 10">
        {SCALE.map((n) => (
          <label key={n} className={value === n ? "is-on" : undefined}>
            <input
              className="z-sr"
              type="radio"
              name="zn-moment-score"
              value={n}
              checked={value === n}
              disabled={disabled}
              onChange={() => onChange(n)}
            />
            <span aria-hidden="true">{n}</span>
            <span className="z-sr">{n === 1 ? "1, not likely" : n === 10 ? "10, very likely" : String(n)}</span>
          </label>
        ))}
      </div>
      <span className="zn-moment__ends" aria-hidden="true">
        <span>Not likely</span>
        <span>Very likely</span>
      </span>
    </div>
  );
}

/**
 * ChatGPT-style pop-up: a picture on top, a short title and line, one clear action and Not now.
 * v1.3.5 (F-22, board LabV135AdminInteractions "What owners see"): the User interactions kinds use the same pop-up,
 * plain (no picture unless staff set one, the close button beside the title):
 *  - feedback_ask: a 1-10 score and an optional line, sent with POST announcements/<id>/answer/;
 *  - offer with a coupon: the code, and "Use the code" opens the plan page with it filled in;
 *  - upgrade_ask and wish: a title, a line and their button.
 * `moment="signout"`: shown as the owner signs out. "Just sign out" (and Esc, ×, a click outside) signs out at once;
 * a feedback ask's button reads "Send and sign out". Nothing here ever stops the sign-out.
 */
export function MomentPopup({
  item,
  onClosed,
  moment = "signin",
  onSignOut,
}: {
  item: Announcement;
  onClosed: () => void;
  moment?: "signin" | "signout";
  /** Sign-out moment: sign out now (called once). */
  onSignOut?: () => void;
}): ReactElement {
  const signout = moment === "signout";
  // One view per showing, even if React mounts the effect twice in development.
  const counted = useRef<string | null>(null);
  useEffect(() => {
    if (counted.current === item.id) return;
    counted.current = item.id;
    void markAnnouncementSeen(item.id).catch(() => undefined);
  }, [item.id]);

  const left = useRef(false);
  const leave = () => {
    if (left.current) return;
    left.current = true;
    onSignOut?.();
  };

  const close = () => {
    if (signout) {
      // Sent before the token goes (bounded, so signing out never waits long).
      void bounded(markAnnouncementSeen(item.id, true), 400).then(leave);
      return;
    }
    void markAnnouncementSeen(item.id, true).catch(() => undefined);
    onClosed();
  };
  // The button: counts a press for the admin's numbers and closes the pop-up in the same call.
  const go = () => {
    void markAnnouncementSeen(item.id, true, true).catch(() => undefined);
    onClosed();
  };

  const feedback = item.kind === "feedback_ask";
  const coupon = item.kind === "offer" || item.kind === "discount" ? couponOf(item) : null;
  const plain = (feedback || item.kind === "upgrade_ask" || coupon !== null || signout) && !item.image_url;
  const title = withoutNameToken(item.title);
  const body = withoutNameToken(item.body);

  const [score, setScore] = useState(0);
  const [line, setLine] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const send = async () => {
    if (!score || sending) return;
    setSending(true);
    setSendError(null);
    if (signout) {
      // The answer goes before the sign-in does; on any failure (or a slow network) the owner is signed out anyway.
      await bounded(answerAnnouncement(item.id, { rating: score, message: line.trim() }), 3000);
      leave();
      return;
    }
    try {
      await answerAnnouncement(item.id, { rating: score, message: line.trim() });
      setSent(true);
    } catch (err) {
      setSendError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const href = coupon ? couponHref(coupon) : item.cta_href.trim();
  const ctaLabel = coupon ? item.cta_label.trim() || "Use the code" : item.cta_label;
  const internal = href.startsWith("/");
  const ref = useRef<HTMLDialogElement>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const closeButton = (
    <button type="button" className="zn-moment__x" onClick={close} aria-label={signout ? "Close and sign out" : "Close"}>
      <ZIcon name="close" size={16} stroke={2.2} />
    </button>
  );

  const action = (() => {
    if (feedback && sent) {
      return (
        <button type="button" className="zn-moment__go" onClick={onClosed}>
          Close
        </button>
      );
    }
    if (feedback) {
      return (
        <button type="button" className="zn-moment__go" onClick={() => void send()} disabled={!score || sending}>
          {sending ? "Sending…" : signout ? "Send and sign out" : "Send"}
        </button>
      );
    }
    if (ctaLabel && href) {
      return internal ? (
        <Link className="zn-moment__go" to={href} onClick={go}>
          {ctaLabel}
        </Link>
      ) : (
        <a className="zn-moment__go" href={href} target="_blank" rel="noopener noreferrer" onClick={go}>
          {ctaLabel}
        </a>
      );
    }
    // A wish with no button: "Thanks" (counted as a press) and Close, as the board shows.
    if (item.kind === "wish" && !signout) {
      return (
        <button type="button" className="zn-moment__go" onClick={go}>
          Thanks
        </button>
      );
    }
    return null;
  })();
  const laterLabel = signout
    ? "Just sign out"
    : feedback
      ? sent
        ? null
        : "Not now"
      : item.kind === "wish" && !(ctaLabel && href)
        ? "Close"
        : ctaLabel && href
          ? "Not now"
          : "Got it";

  return (
    <dialog
      ref={ref}
      className={plain ? "zn-moment zn-moment--plain" : "zn-moment"}
      aria-labelledby="zn-moment-h"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="zn-moment__card">
        {plain ? null : (
          <div className="zn-moment__pic">
            {item.image_url && !broken ? (
              <img src={item.image_url} alt="" width={440} height={220} onError={() => setBroken(true)} />
            ) : (
              <MomentArt kind={item.kind} />
            )}
            {closeButton}
          </div>
        )}
        <div className="zn-moment__body">
          {!plain && KIND_LABEL[item.kind] ? <span className="zn-moment__kind">{KIND_LABEL[item.kind]}</span> : null}
          {plain ? (
            <div className="zn-moment__head">
              <h2 id="zn-moment-h">{feedback && sent ? "Thank you" : title}</h2>
              {closeButton}
            </div>
          ) : (
            <h2 id="zn-moment-h">{title}</h2>
          )}
          {feedback && sent ? (
            <p role="status">Your answer is in. The founder reads every one.</p>
          ) : body ? (
            <p>{body}</p>
          ) : null}
          {coupon ? (
            <div className="zn-moment__code">
              <span className="zn-moment__code-text">{coupon.code}</span>
              {coupon.note || coupon.ends_on ? (
                <span className="zn-moment__code-note">
                  {[coupon.note, coupon.ends_on ? `Ends ${formatDayMonth(coupon.ends_on)}.` : ""].filter(Boolean).join(" ")}
                </span>
              ) : null}
            </div>
          ) : null}
          {feedback && !sent ? (
            <>
              <ScoreScale value={score} onChange={setScore} disabled={sending} />
              <textarea
                className="zn-moment__line"
                rows={2}
                maxLength={2000}
                aria-label="Tell us more (optional)"
                placeholder="Tell us more (optional)"
                value={line}
                disabled={sending}
                onChange={(e) => setLine(e.target.value)}
              />
              {sendError ? (
                <span className="zn-moment__err" role="alert">
                  {sendError}
                </span>
              ) : null}
            </>
          ) : null}
          <div className="zn-moment__acts">
            {action}
            {laterLabel ? (
              <button type="button" className="zn-moment__later" onClick={close} disabled={sending && !signout}>
                {laterLabel}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </dialog>
  );
}

/** "2027-01-05" -> "5 Jan". */
function formatDayMonth(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function FeedbackPrompt({ page, onDone }: { page: string; onDone: () => void }): ReactElement {
  const [open, setOpen] = useState(false);
  const told = useRef(false);
  useEffect(() => {
    if (told.current) return;
    told.current = true;
    void sendFeedbackPrompt("shown").catch(() => undefined);
  }, []);
  const notNow = () => {
    void sendFeedbackPrompt("dismissed").catch(() => undefined);
    onDone();
  };

  return (
    <section className="zn-fbp" aria-labelledby="zn-fbp-h">
      <div className="zn-fbp__row">
        <span className="zn-fbp__ico" aria-hidden="true">
          <ZIcon name="feedback" size={17} />
        </span>
        <span className="zn-fbp__text">
          <b id="zn-fbp-h">How is Zinwe working for you?</b>
          <span>One score and a line, if you like. The founder reads every answer.</span>
        </span>
        {open ? null : (
          <button type="button" className="z-btn sm dark" onClick={() => setOpen(true)}>
            Rate Zinwe
          </button>
        )}
        <button type="button" className="z-btn sm" onClick={notNow}>
          Not now
        </button>
      </div>
      {open ? <FeedbackForm page={`prompt:${page}`.slice(0, 120)} onDone={onDone} /> : null}
    </section>
  );
}
