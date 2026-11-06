import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Link, useLocation } from "react-router-dom";
import type { Announcement, AnnouncementKind } from "../../lib/api";
import { isInternalHref as isInternal, readDismissed, writeDismissed } from "../../lib/announcementDismissals";
import { readSnoozed, snooze, unsnooze } from "../float/barSnooze";
import { ICON } from "../ui/icons";
import { ZIcon } from "../ui/ZIcon";
import "../../styles/dash13/float.css";

type Tone = "orange" | "amber" | "dark";

/** Board CompOfferBar tones: plan nudges and offers orange, maintenance amber, releases and news dark. */
const TONE: Record<AnnouncementKind, Tone> = {
  upgrade: "orange",
  offer: "orange",
  discount: "orange",
  maintenance: "amber",
  version: "dark",
  news: "dark",
  wish: "dark",
  // v1.3.5: dialog kinds; a bar of these is never sent, but the tables stay complete.
  feedback_ask: "dark",
  upgrade_ask: "orange",
};

const P_PEOPLE = "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6z";

const ICONS: Record<AnnouncementKind, string> = {
  upgrade: P_PEOPLE,
  offer: ICON.news,
  discount: ICON.news,
  maintenance: ICON.clock,
  version: ICON.refresh,
  news: ICON.news,
  wish: ICON.news,
  feedback_ask: ICON.news,
  upgrade_ask: P_PEOPLE,
};

/** "Which bar wins": only one at a time, highest first. The PC-limit bar is a real trigger, so it leads. */
function rank(item: Announcement): number {
  if (item.kind === "upgrade" && item.id.startsWith("upgrade-limit")) return 0;
  return ({ maintenance: 1, upgrade: 2, upgrade_ask: 2, discount: 3, offer: 4, version: 5, news: 6, wish: 7, feedback_ask: 8 } as const)[
    item.kind
  ];
}

/** A plan nudge hides for 7 days; an announcement hides for good on this browser. */
const isNudge = (item: Announcement) => item.kind === "upgrade";

/**
 * The offer bar (board CompOfferBar): one thin bar above the page title for a single timely message the Zinwe team
 * pushes from the admin panel (offers, discounts, news, releases, maintenance) or the upgrade bar (what the next plan
 * adds, or that every PC slot is taken). Only one shows at a time, highest first, and only on Overview. It pushes the
 * page down, never covers it. The × says what it does; an Undo note stays for a few seconds. AppLayout decides which
 * bars apply (nothing sells while a payment is being checked).
 */
export function NotificationBar({ items }: { items: Announcement[] }): ReactElement | null {
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState<Set<string>>(readDismissed);
  const [snoozed, setSnoozed] = useState<Set<string>>(() => readSnoozed(Date.now()));
  const [justHidden, setJustHidden] = useState<Announcement | null>(null);

  useEffect(() => {
    if (!justHidden) return;
    const id = window.setTimeout(() => setJustHidden(null), 6000);
    return () => window.clearTimeout(id);
  }, [justHidden]);

  const hide = useCallback((item: Announcement) => {
    if (isNudge(item)) {
      snooze(item.id, Date.now());
      setSnoozed((prev) => new Set(prev).add(item.id));
    } else {
      setDismissed((prev) => {
        const next = new Set(prev).add(item.id);
        writeDismissed(next);
        return next;
      });
    }
    setJustHidden(item);
  }, []);

  const undo = (item: Announcement) => {
    if (isNudge(item)) {
      unsnooze(item.id);
      setSnoozed((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    } else {
      setDismissed((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        writeDismissed(next);
        return next;
      });
    }
    setJustHidden(null);
  };

  const onOverview = pathname.replace(/\/+$/, "") === "/app";
  if (!onOverview) return null;

  const bar = items
    .filter((item) => !(item.dismissible && (dismissed.has(item.id) || snoozed.has(item.id))))
    .sort((a, b) => rank(a) - rank(b))[0];

  if (justHidden) {
    return (
      <div className="zf-barnote" role="status">
        <span>
          {isNudge(justHidden)
            ? "Hidden for 7 days. It comes back sooner only if something changes."
            : "Hidden. It stays hidden on this browser."}
        </span>
        <button type="button" onClick={() => undo(justHidden)}>
          Undo
        </button>
      </div>
    );
  }
  if (!bar) return null;

  const tone = TONE[bar.kind];
  const cta = bar.cta_label && bar.cta_href ? { label: bar.cta_label, href: bar.cta_href } : null;
  const ctaClass = tone === "dark" ? "zf-bar__link" : `zf-bar__cta ${tone}`;
  return (
    <div className={`zf-bar ${tone}`} role="status">
      <span className="zf-bar__ico" aria-hidden="true">
        <ZIcon d={ICONS[bar.kind]} size={16} stroke={2.4} />
      </span>
      <span className="zf-bar__txt">
        <b>{bar.title}</b>
        {bar.body ? <span> {bar.body}</span> : null}
      </span>
      {cta ? (
        isInternal(cta.href) ? (
          <Link className={ctaClass} to={cta.href}>
            {cta.label}
            {tone === "dark" ? <span aria-hidden="true"> →</span> : null}
          </Link>
        ) : (
          <a className={ctaClass} href={cta.href} target="_blank" rel="noopener noreferrer">
            {cta.label}
            {tone === "dark" ? <span aria-hidden="true"> →</span> : null}
          </a>
        )
      ) : null}
      {bar.dismissible ? (
        <button
          type="button"
          className="zf-bar__x"
          onClick={() => hide(bar)}
          aria-label={isNudge(bar) ? "Hide for 7 days" : "Hide this announcement"}
          title={isNudge(bar) ? "Hide for 7 days" : "Hide this announcement"}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
