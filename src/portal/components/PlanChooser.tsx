import { useId, useState, type ReactElement } from "react";
import { useIsPhone } from "../../hooks/useIsPhone";
import type { BillingCycle, Plan } from "../../lib/api";
import { cx } from "../../lib/cx";
import { cheapestPerPc, pcCapLine, pcWord, planCardText } from "../../lib/planCards";
import type { SiteCurrency } from "../../lib/sitePrices";
import { bestYearlySaving, planForPcs } from "../plan";
import { CycleToggle } from "./CycleToggle";
import { PlanSwipe, SwipeCard, type SwipeBadge } from "./PlanSwipe";

export interface ChooserCard {
  /** What the card's own button says. */
  label: string;
  /** Can't be chosen here: the button is off and the card is drawn quietly. */
  off: boolean;
  /** "Your plan", "Waiting for payment"…; wins over "Fits your N PCs". */
  flag?: string | null;
  /** Shown only when the card has no other flag ("First 3 months free"). */
  note?: string | null;
}

function Tick(): ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 13l4 4 10-10" />
    </svg>
  );
}

/**
 * The one view for choosing a plan, registering and upgrading (Plans prototype, 1 Nov 2026): the PC stepper and
 * Monthly / Yearly, then four cards, each with its own button. The card text is the public /plans page's
 * (lib/planCards.ts). The page decides what each card's button does (`stateOf`, `onChoose`).
 * On a phone (6 Nov 2026, board PhonePlanApp) the same cards sit in a swipe rail under a plan switch (PlanSwipe), with
 * the same buttons, flags and states.
 */
export function PlanChooser({
  plans,
  currency,
  cycle,
  onCycle,
  pcs,
  cap,
  onPcs,
  showTools,
  busy,
  stateOf,
  onChoose,
  foot,
}: {
  plans: readonly Plan[];
  currency: SiteCurrency;
  cycle: BillingCycle;
  onCycle: (cycle: BillingCycle) => void;
  pcs: number;
  /** The most PCs a plan covers: the stepper stops here. */
  cap: number;
  onPcs: (pcs: number) => void;
  /** Off while a payment is being checked, and on the biggest plan: nothing to choose. */
  showTools: boolean;
  /** The plan being started, while it starts: every button waits. */
  busy: string | null;
  stateOf: (plan: Plan) => ChooserCard;
  onChoose: (plan: Plan) => void;
  /** The line under the cards. */
  foot: string;
}): ReactElement {
  const id = useId();
  const phone = useIsPhone();
  const [typed, setTyped] = useState<string | null>(null);
  const list = [...plans].sort((a, b) => a.sort_order - b.sort_order);
  const fit = showTools ? planForPcs(list, pcs) : null;
  const lowest = cheapestPerPc(list, currency, cycle);
  const saving = bestYearlySaving(list, currency);

  const setPcs = (n: number) => {
    onPcs(Math.max(1, Math.min(cap, Math.round(n) || 1)));
    setTyped(null);
  };

  const card = (plan: Plan): ReactElement => {
    const { label, off, flag, note } = stateOf(plan);
    const fits = !off && fit?.code === plan.code;
    const text = planCardText(plan, currency, cycle, cycle);
    const badge = flag ?? (fits ? `Fits your ${pcWord(pcs)}` : (note ?? (!off && lowest?.code === plan.code ? "Lowest price per PC" : null)));
    const limit = plan.max_devices > 0 ? `Up to ${pcWord(plan.max_devices)}` : "Any number of PCs";
    return (
      <article key={plan.code} className={cx("zpf-plan", fits && "is-fit", off && "is-dim")} aria-label={plan.name}>
        {badge ? <span className={cx("zpf-flag", fits && "is-fit")}>{badge}</span> : null}
        <h2>{plan.name}</h2>
        <p className="zpf-plan__tag">{text.tag}</p>
        <div className="zpf-price">
          {text.was ? (
            <s>
              <span className="z-sr">Was </span>
              {text.was}
            </s>
          ) : null}
          <b className="z-num">{text.price}</b>
        </div>
        <span className="zpf-per">{text.per}</span>
        <span className="zpf-perpc z-num">{text.perPcLine}</span>
        {text.sub ? <span className="zpf-per z-num">{text.sub}</span> : null}
        <span className="zpf-pill zpf-limit">
          {limit} · {text.history} history
        </span>
        <button
          type="button"
          className={cx("zau-btn zpf-plan__btn", !off && (fits ? "pri" : "dark"))}
          disabled={off || busy !== null}
          onClick={() => onChoose(plan)}
        >
          {busy === plan.code ? <span className="zau-spin" aria-hidden="true" /> : null}
          {busy === plan.code ? "Please wait…" : label}
        </button>
        <ul className="zpf-feat">
          {text.points.map((point, i) => (
            <li key={point.text} className={i === 0 && plan.requires_payment ? "is-lead" : undefined}>
              <Tick />
              <span>{point.text}</span>
            </li>
          ))}
        </ul>
      </article>
    );
  };

  if (phone) {
    const states = new Map(list.map((p) => [p.code, stateOf(p)]));
    const fitCode = fit && !states.get(fit.code)?.off ? fit.code : null;
    const flagged = list.find((p) => states.get(p.code)?.flag)?.code ?? null;
    const swipeCard = (plan: Plan): ReactElement => {
      const { label, off, flag, note } = states.get(plan.code) ?? stateOf(plan);
      const fits = plan.code === fitCode;
      const isLowest = !off && lowest?.code === plan.code;
      // Flags on a card that can't be chosen ("Your plan") are quiet; "Waiting for payment" is not.
      const badge: SwipeBadge | null = flag
        ? { text: flag, tone: off ? "quiet" : "ink" }
        : fits
          ? { text: `Fits your ${pcWord(pcs)}`, tone: "fit" }
          : note
            ? { text: note, tone: "ink" }
            : isLowest
              ? { text: "Lowest price per PC", tone: "ink" }
              : null;
      const waiting = busy !== null && busy !== plan.code;
      return (
        <SwipeCard
          plan={plan}
          text={planCardText(plan, currency, cycle, cycle)}
          badge={badge}
          fits={fits}
          off={off}
          action={
            <button
              type="button"
              className={cx("zsw-btn", !off && fits && "is-pri", waiting && "is-wait", busy === plan.code && "is-busy")}
              disabled={off || busy !== null}
              onClick={() => onChoose(plan)}
            >
              {busy === plan.code ? <span className="zau-spin" aria-hidden="true" /> : null}
              {busy === plan.code ? "Please wait…" : label}
            </button>
          }
        />
      );
    };
    return (
      <PlanSwipe
        plans={list}
        fitCode={fitCode}
        startCode={fitCode ?? flagged ?? list.find((p) => !states.get(p.code)?.off)?.code ?? null}
        tools={showTools ? { cycle, onCycle, saving: plans.length > 1 ? saving : 0, pcs, cap, onPcs } : null}
        fitLine={
          <>
            {fit ? (
              <>
                <b>{fit.name}</b> fits {pcWord(pcs)}.
              </>
            ) : null}
            {pcs >= cap ? ` ${pcCapLine(cap)}` : ""}
          </>
        }
        renderCard={swipeCard}
        foot={<p className="zpf-foot">{foot}</p>}
      />
    );
  }

  return (
    <>
      {showTools ? (
        <>
          <div className="zpf-tools" role="group" aria-label="Price options">
            <div className="zpf-tool">
              <label className="zpf-tool__label" htmlFor={`${id}-pcs`}>
                PCs in your office
              </label>
              <button type="button" className="zpf-step" aria-label="One PC fewer" disabled={pcs <= 1} onClick={() => setPcs(pcs - 1)}>
                −
              </button>
              <input
                id={`${id}-pcs`}
                className="zpf-num z-num"
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
              <button type="button" className="zpf-step" aria-label="One PC more" disabled={pcs >= cap} onClick={() => setPcs(pcs + 1)}>
                +
              </button>
            </div>
            {plans.length > 1 ? (
              <div className="zpf-tool">
                <CycleToggle value={cycle} onChange={onCycle} saving={saving} upTo />
              </div>
            ) : null}
          </div>
          <p className="zpf-fits" aria-live="polite">
            {fit ? `${fit.name} fits ${pcWord(pcs)}.` : ""}
            {pcs >= cap ? ` ${pcCapLine(cap)}` : ""}
          </p>
        </>
      ) : null}
      <div className="zpf-plans">{list.map(card)}</div>
      <p className="zpf-foot">{foot}</p>
    </>
  );
}

/** Four shimmer cards while GET plans/ loads. */
export function PlanChooserLoading(): ReactElement {
  return (
    <div className="zpf-plans" role="status" aria-live="polite">
      <span className="z-sr">Loading plans…</span>
      {[0, 1, 2, 3].map((i) => (
        <div className="zpf-plan" key={i} aria-hidden="true">
          <span className="zau-sk" style={{ width: "50%", height: 22 }} />
          <span className="zau-sk" style={{ width: "85%", height: 14, marginTop: 10 }} />
          <span className="zau-sk" style={{ width: "70%", height: 36, marginTop: 14 }} />
          <span className="zau-sk" style={{ width: "60%", height: 14, marginTop: 10 }} />
          <span className="zau-sk" style={{ width: "100%", height: 44, marginTop: 18 }} />
        </div>
      ))}
    </div>
  );
}
