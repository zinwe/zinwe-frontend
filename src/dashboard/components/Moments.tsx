import { useEffect, useRef, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { markAnnouncementSeen, sendFeedbackPrompt, type Announcement } from "../../lib/api";
import { ZIcon } from "../ui/ZIcon";
import { FeedbackForm } from "./FeedbackForm";
import { Modal } from "./Modal";

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
  const href = item.cta_href.trim();
  const internal = href.startsWith("/");

  return (
    <Modal open onClose={close} size="sm" title={item.title} sub={KIND_LABEL[item.kind]}>
      {item.body ? (
        <p className="dash-modal__text" style={{ whiteSpace: "pre-line" }}>
          {item.body}
        </p>
      ) : null}
      <div className="dash-confirm__actions">
        {item.cta_label && href ? (
          internal ? (
            <Link className="z-btn sm pri" to={href} onClick={close}>
              {item.cta_label}
            </Link>
          ) : (
            <a className="z-btn sm pri" href={href} target="_blank" rel="noopener noreferrer" onClick={close}>
              {item.cta_label}
            </a>
          )
        ) : null}
        <button type="button" className="z-btn sm" onClick={close}>
          Close
        </button>
      </div>
    </Modal>
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
