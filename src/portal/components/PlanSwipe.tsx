import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import type { PlanBar } from "../onboarding/flow";
import { prefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import type { BillingCycle, Plan } from "../../lib/api";
import { cx } from "../../lib/cx";
import { pcWord, type PlanCardText } from "../../lib/planCards";
import { CycleToggle } from "./CycleToggle";
import "../../styles/plan-swipe.css";

/**
 * The phone plan screen (Prototype board PhonePlanApp, 6 Nov 2026), one for sign-up step 2, Upgrade and the website's
 * /plans: Monthly / Yearly and the PC counter, the line saying which plan fits, a plan switch on top (a tablist with a
 * sliding marker and an orange dot on the plan that fits), then the cards in a swipe rail, the one in the middle full
 * size and its neighbours a little smaller. Each card is the website's plan card with its own button (SwipeCard).
 * The page decides what the cards say and what their buttons do; this only lays them out and keeps the switch, the
 * rail and the keyboard in step. Desktop never draws it.
 */

export interface SwipeTools {
  cycle: BillingCycle;
  onCycle: (cycle: BillingCycle) => void;
  /** Whole percent a year saves at most; 0 hides the badge. */
  saving: number;
  pcs: number;
  /** The most PCs a plan covers: the counter stops here. */
  cap: number;
  onPcs: (pcs: number) => void;
}

/** "Free forever" reads "Free" on the switch, where four names share one row. */
function shortName(plan: Plan): string {
  return plan.name.replace(/\s+forever$/i, "");
}

function PcIcon(): ReactElement {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

function Tick(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 13l4 4 10-10" />
    </svg>
  );
}

/** Monthly / Yearly and the PC counter, on one row. */
function Tools({ tools }: { tools: SwipeTools }): ReactElement {
  const id = useId();
  const { pcs, cap, onPcs } = tools;
  const [typed, setTyped] = useState<string | null>(null);
  const step = (n: number) => {
    onPcs(Math.max(1, Math.min(cap, Math.round(n) || 1)));
    setTyped(null);
  };
  return (
    <div className="zsw-ctl" role="group" aria-label="Price options">
      <CycleToggle className="zsw-cyc" value={tools.cycle} onChange={tools.onCycle} saving={tools.saving} upTo short />
      <div className="zsw-pcs">
        <label className="zsw-sr" htmlFor={`${id}-pcs`}>
          PCs in your office
        </label>
        <button type="button" aria-label="One PC fewer" disabled={pcs <= 1} onClick={() => step(pcs - 1)}>
          −
        </button>
        <span className="zsw-pcs__n">
          <PcIcon />
          <input
            id={`${id}-pcs`}
            type="number"
            inputMode="numeric"
            min={1}
            max={cap}
            value={typed ?? String(pcs)}
            onChange={(e) => {
              const n = Number(e.target.value);
              setTyped(n > cap ? String(cap) : e.target.value);
              if (e.target.value !== "" && n >= 1) onPcs(Math.min(cap, Math.round(n)));
            }}
            onBlur={() => setTyped(null)}
          />
        </span>
        <button type="button" aria-label="One PC more" disabled={pcs >= cap} onClick={() => step(pcs + 1)}>
          +
        </button>
      </div>
    </div>
  );
}

export interface SwipeBadge {
  text: string;
  /** fit = orange ("Fits your 8 PCs"), ink = black ("Lowest price per PC", offers), quiet = grey ("Your plan"). */
  tone: "fit" | "ink" | "quiet";
}

/**
 * One plan card as on the website's /plans (badge on the top edge, name, tag line, struck list price and the big
 * price, unit, per-PC line, its own button, the PC and history chips, a line, the feature list with "Everything in…"
 * lighter). `action` is the page's own button or link, with the class `zsw-btn` (+ `is-pri` when it fits).
 */
export function SwipeCard({
  plan,
  text,
  badge,
  fits,
  off = false,
  action,
}: {
  plan: Plan;
  text: PlanCardText;
  badge: SwipeBadge | null;
  fits: boolean;
  off?: boolean;
  action: ReactNode;
}): ReactElement {
  const limit = plan.max_devices > 0 ? `Up to ${pcWord(plan.max_devices)}` : "Any number of PCs";
  return (
    <>
      {badge ? <span className={cx("zsw-badge", `is-${badge.tone}`)}>{badge.text}</span> : null}
      <div className={cx("zsw-in", off && "is-off", fits && "is-fit")}>
        <h2 className="zsw-name">{plan.name}</h2>
        <p className="zsw-tag">{text.tag}</p>
        <div className="zsw-price">
          {text.was ? (
            <s>
              <span className="zsw-sr">was </span>
              {text.was}
            </s>
          ) : null}
          <b>{text.price}</b>
        </div>
        <div className="zsw-unit">{text.per}</div>
        <div className="zsw-per">{text.perPcLine}</div>
        {text.sub ? <div className="zsw-note">{text.sub}</div> : null}
        {action}
        <div className="zsw-chips">
          <span>{limit}</span>
          <span>{text.history} of history</span>
        </div>
        <ul className="zsw-feats">
          {text.points.map((pt) => (
            <li key={pt.text} className={pt.strong ? undefined : "is-lead"}>
              <Tick />
              <span>
                {pt.text}
                {pt.isNew ? <em className="zsw-new">New</em> : null}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/** Index of the card nearest the middle of the rail. */
function nearest(rail: HTMLElement): number {
  const mid = rail.scrollLeft + rail.clientWidth / 2;
  let best = 0;
  let gap = Number.POSITIVE_INFINITY;
  Array.from(rail.children).forEach((child, i) => {
    const c = child as HTMLElement;
    const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
    if (d < gap) {
      gap = d;
      best = i;
    }
  });
  return best;
}

export function PlanSwipe({
  plans,
  fitCode,
  startCode,
  tools,
  fitLine,
  renderCard,
  foot,
  label = "Plans",
  site = false,
}: {
  /** In the order to show them. */
  plans: readonly Plan[];
  /** The plan that fits the PC count (and can be chosen): orange dot, orange ring, the card the counter scrolls to. */
  fitCode: string | null;
  /** The card in the middle at first (the fit, or the flagged plan when there are no tools). */
  startCode: string | null;
  /** Monthly / Yearly and the PC counter; null hides the row (a payment being checked, the biggest plan). */
  tools: SwipeTools | null;
  /** "Teams fits 10 PCs." under the tools. */
  fitLine: ReactNode;
  renderCard: (plan: Plan) => ReactElement;
  /** Under the rail. */
  foot?: ReactNode;
  label?: string;
  /** The website's section (part of a longer page) rather than an app screen. */
  site?: boolean;
}): ReactElement {
  const id = useId();
  const railRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const startIdx = Math.max(0, plans.findIndex((p) => p.code === startCode));
  const [idx, setIdx] = useState(startIdx);
  // While the rail glides to a card the page asked for, scroll events don't move the switch.
  const jumping = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const on = Math.min(idx, plans.length - 1);

  const scrollTo = useCallback((i: number, smooth: boolean) => {
    const rail = railRef.current;
    const card = rail?.children[i] as HTMLElement | undefined;
    if (!rail || !card) return;
    const glide = smooth && !prefersReducedMotion();
    if (jumping.current !== null) window.clearTimeout(jumping.current);
    jumping.current = window.setTimeout(() => {
      jumping.current = null;
    }, glide ? 600 : 60);
    rail.scrollTo({ left: card.offsetLeft - (rail.clientWidth - card.offsetWidth) / 2, behavior: glide ? "smooth" : "auto" });
  }, []);

  const go = useCallback(
    (i: number, focus?: "tab" | "card") => {
      const next = Math.max(0, Math.min(plans.length - 1, i));
      setIdx(next);
      scrollTo(next, true);
      if (focus === "tab") tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      if (focus === "card") (railRef.current?.children[next] as HTMLElement | undefined)?.focus({ preventScroll: true });
    },
    [plans.length, scrollTo],
  );

  // First paint: the start card in the middle, no glide.
  useLayoutEffect(() => {
    scrollTo(startIdx, false);
    // Only on mount: later moves come from the counter, the switch or a swipe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The rail changed size (phone turned, window resized): keep the card that was in the middle there.
  const onRef = useRef(on);
  useEffect(() => {
    onRef.current = on;
  });
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || typeof ResizeObserver === "undefined") return;
    let width = rail.clientWidth;
    const watch = new ResizeObserver(() => {
      if (rail.clientWidth === width) return;
      width = rail.clientWidth;
      scrollTo(onRef.current, false);
    });
    watch.observe(rail);
    return () => watch.disconnect();
  }, [scrollTo]);

  // The PC counter moved: glide to the plan that fits, as the prototype does.
  const pcs = tools?.pcs;
  const firstPcs = useRef(true);
  useEffect(() => {
    if (firstPcs.current) {
      firstPcs.current = false;
      return;
    }
    const i = plans.findIndex((p) => p.code === fitCode);
    if (i >= 0) go(i);
    // Follow the count, not every new plans array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pcs]);

  // The glide ended (where the browser says so): the switch takes the card that is really in the middle.
  useEffect(() => {
    const rail = railRef.current;
    const ended = () => {
      if (jumping.current === null || !rail) return;
      window.clearTimeout(jumping.current);
      jumping.current = null;
      const i = nearest(rail);
      setIdx((cur) => (cur === i ? cur : i));
    };
    rail?.addEventListener("scrollend", ended);
    return () => {
      rail?.removeEventListener("scrollend", ended);
      if (jumping.current !== null) window.clearTimeout(jumping.current);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    };
  }, []);

  // A swipe: the switch follows the card that ends up in the middle.
  const onScroll = () => {
    if (jumping.current !== null || frame.current !== null) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = null;
      const rail = railRef.current;
      if (!rail || jumping.current !== null) return;
      const i = nearest(rail);
      setIdx((cur) => (cur === i ? cur : i));
    });
  };

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = { ArrowLeft: on - 1, ArrowRight: on + 1, Home: 0, End: plans.length - 1 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    go(moves[e.key], "tab");
  };

  // Arrow keys anywhere on the rail move one card (not while typing in a field).
  const onRailKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest("input, select, textarea")) return;
    const moves: Record<string, number> = { ArrowLeft: on - 1, ArrowRight: on + 1 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    go(moves[e.key], "card");
  };

  // Tabbing into a card at the side brings it to the middle.
  const onFocusCard = (i: number) => {
    if (i !== on) go(i);
  };

  // A tap on a card at the side brings it to the middle first, so a half-seen button is never pressed by mistake.
  const onCardClick = (i: number) => (e: MouseEvent<HTMLElement>) => {
    if (i === on) return;
    e.preventDefault();
    e.stopPropagation();
    go(i);
  };

  return (
    <section className={cx("zsw", site ? "zsw--site" : "zsw--app")} aria-roledescription="carousel" aria-label={label}>
      {tools ? <Tools tools={tools} /> : null}
      {tools ? (
        <p className="zsw-fit" aria-live="polite">
          {fitLine}
        </p>
      ) : null}
      <div
        ref={tabsRef}
        className="zsw-pill"
        role="tablist"
        aria-label="Choose a plan"
        style={{ ["--n" as string]: plans.length, ["--i" as string]: on }}
        onKeyDown={onTabKey}
      >
        <span className="zsw-thumb" aria-hidden="true" />
        {plans.map((plan, i) => (
          <button
            key={plan.code}
            id={`${id}-tab-${plan.code}`}
            type="button"
            role="tab"
            aria-selected={i === on}
            aria-controls={`${id}-card-${plan.code}`}
            tabIndex={i === on ? 0 : -1}
            className={cx(plan.code === fitCode && "is-fit")}
            onClick={() => go(i)}
          >
            {shortName(plan)}
            {plan.code === fitCode ? <span className="zsw-sr">, fits your PCs</span> : null}
          </button>
        ))}
      </div>
      <div ref={railRef} className="zsw-rail" onScroll={onScroll} onKeyDown={onRailKey}>
        {plans.map((plan, i) => (
          <article
            key={plan.code}
            id={`${id}-card-${plan.code}`}
            className={cx("zsw-card", i === on && "is-on", plan.code === fitCode && "is-fit")}
            role="tabpanel"
            aria-roledescription="slide"
            aria-labelledby={`${id}-tab-${plan.code}`}
            tabIndex={-1}
            onFocus={() => onFocusCard(i)}
            onClickCapture={onCardClick(i)}
          >
            {renderCard(plan)}
          </article>
        ))}
      </div>
      {foot ? <div className="zsw-foot">{foot}</div> : null}
    </section>
  );
}

/**
 * The phone top bar on the plan page (sign-up step 2 and Upgrade), in place of the onboarding header: Back, the
 * title with a small line under it, and Skip while registering.
 */
export function PlanTopBar({ bar }: { bar: PlanBar }): ReactElement {
  return (
    <div className="zsw-top">
      <Link className="zsw-top__ic" to={bar.backTo} aria-label={bar.backLabel} title={bar.backLabel}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </Link>
      <div className="zsw-top__title">
        {bar.title}
        <small>{bar.sub}</small>
      </div>
      {bar.skipTo ? (
        <Link className="zsw-top__skip" to={bar.skipTo} aria-label="Skip to dashboard">
          Skip
        </Link>
      ) : null}
    </div>
  );
}
