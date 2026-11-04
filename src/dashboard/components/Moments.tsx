import { useEffect, useRef, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { markAnnouncementSeen, sendFeedbackPrompt, type Announcement } from "../../lib/api";
import { ZIcon } from "../ui/ZIcon";
import { FeedbackForm } from "./FeedbackForm";

/**
 * F-11 (v1.3.3), two quiet ways the dashboard speaks up:
 *  - MomentPopup: one pop-up from the announcements feed (news, a new version, a wish; offers on free plans). The
 *    server decides when it is due (first login after it goes live, then every 2nd day, then weekly, at most 3 views,
 *    one a day), so this only shows it, says "seen" when it shows and "closed" when the owner closes it.
 *  - FeedbackPrompt: a small card, never a blocking dialog, when the account says it's time to ask (me.feedback_prompt_due).
 */

const KIND_LABEL: Partial<Record<Announcement["kind"], string>> = {
  version: "New in Zinwe",
  news: "News",
  wish: "From the Zinwe team",
  offer: "Offer",
  discount: "Offer",
};

/** The picture when staff didn't upload one: calm art per kind, white, black and orange only. */
function MomentArt({ kind }: { kind: Announcement["kind"] }): ReactElement {
  const offer = kind === "offer" || kind === "discount" || kind === "upgrade";
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

/** ChatGPT-style pop-up: a picture on top, a short title and line, one clear action and Not now. */
export function MomentPopup({ item, onClosed }: { item: Announcement; onClosed: () => void }): ReactElement {
  // One view per showing, even if React mounts the effect twice in development.
  const counted = useRef<string | null>(null);
  useEffect(() => {
    if (counted.current === item.id) return;
    counted.current = item.id;
    void markAnnouncementSeen(item.id).catch(() => undefined);
  }, [item.id]);

  const close = () => {
    void markAnnouncementSeen(item.id, true).catch(() => undefined);
    onClosed();
  };
  // The button: counts a press for the admin's numbers and closes the pop-up in the same call.
  const go = () => {
    void markAnnouncementSeen(item.id, true, true).catch(() => undefined);
    onClosed();
  };
  const href = item.cta_href.trim();
  const internal = href.startsWith("/");
  const ref = useRef<HTMLDialogElement>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="zn-moment"
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
        <div className="zn-moment__pic">
          {item.image_url && !broken ? (
            <img src={item.image_url} alt="" width={440} height={220} onError={() => setBroken(true)} />
          ) : (
            <MomentArt kind={item.kind} />
          )}
          <button type="button" className="zn-moment__x" onClick={close} aria-label="Close">
            <ZIcon name="close" size={16} stroke={2.2} />
          </button>
        </div>
        <div className="zn-moment__body">
          {KIND_LABEL[item.kind] ? <span className="zn-moment__kind">{KIND_LABEL[item.kind]}</span> : null}
          <h2 id="zn-moment-h">{item.title}</h2>
          {item.body ? <p>{item.body}</p> : null}
          <div className="zn-moment__acts">
            {item.cta_label && href ? (
              internal ? (
                <Link className="zn-moment__go" to={href} onClick={go}>
                  {item.cta_label}
                </Link>
              ) : (
                <a className="zn-moment__go" href={href} target="_blank" rel="noopener noreferrer" onClick={go}>
                  {item.cta_label}
                </a>
              )
            ) : null}
            <button type="button" className="zn-moment__later" onClick={close}>
              {item.cta_label && href ? "Not now" : "Got it"}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
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
