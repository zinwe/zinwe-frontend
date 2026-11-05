import { useState, type ReactElement } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../auth/authContext";
import { hasSettledPlan } from "../auth/steps";
import { ClientWall } from "../components/site/home2/ClientWall";
import { PhoneFold } from "../components/site/PhoneFold";
import { SiteFaq } from "../components/site/SiteFaq";
import { ICONS } from "../components/site/icons";
import { PathIcon, Tick } from "../components/site/SiteIcon";
import { COMPARE_ROWS, PLANS_CLOSE, PLANS_FAQ, PLANS_HERO, PROMISES, WHY, fill, historyLabel } from "../content/site/plans";
import { seoFor } from "../content/seo";
import { useHashTarget } from "../hooks/useHashTarget";
import { useIsPhone } from "../hooks/useIsPhone";
import { usePageMeta } from "../hooks/usePageMeta";
import { errorMessage, type BillingCycle, type Plan } from "../lib/api";
import type { PlanModule } from "../lib/api/types";
import { cx } from "../lib/cx";
import { cheapestPerPc, pcCap, pcCapLine, pcWord, perPc, planCardText } from "../lib/planCards";
import { money, paidPlans, type SiteCurrency } from "../lib/sitePrices";
import { PlanSwipe, SwipeCard, type SwipeBadge } from "../portal/components/PlanSwipe";
import { bestYearlySaving, pcsForTeamSize, planForPcs } from "../portal/plan";
import { usePlans } from "../portal/usePlans";
import "../styles/site-plans.css";
import "../styles/site-home2.css";

const CURRENCY_KEY = "zinwe.plans-currency";
const CYCLE_KEY = "zinwe.plans-cycle";

function stored<T extends string>(key: string, allowed: readonly T[]): T | null {
  try {
    const value = window.localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : null;
  } catch {
    return null;
  }
}
function remember(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the choice lasts until the page closes.
  }
}
function guessCurrency(): SiteCurrency {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone === "Asia/Kolkata" || zone === "Asia/Calcutta" ? "INR" : "USD";
  } catch {
    return "INR";
  }
}
/** #region=in|us&billing=month|year (board links), read once. */
function fromHash(hash: string): { currency?: SiteCurrency; cycle?: BillingCycle } {
  const h = new URLSearchParams(hash.replace(/^#/, ""));
  const r = h.get("region");
  const b = h.get("billing");
  return {
    currency: r === "in" ? "INR" : r === "us" ? "USD" : undefined,
    cycle: b === "month" ? "monthly" : b === "year" ? "yearly" : undefined,
  };
}

/** Does this plan include `module`? No module = on every plan; a catalogue without `modules` falls back to `cells`. */
function planHas(plan: Plan | undefined, module: PlanModule | undefined, fallback: string): string {
  if (!module || !plan?.modules) return fallback;
  return plan.modules.includes(module) ? "y" : "n";
}

/** A round number just above the highest per-PC price: ₹97 → ₹100, $1.20 → $1.25. */
function perPcCap(plans: readonly Plan[], currency: SiteCurrency): string | null {
  const most = Math.max(0, ...paidPlans(plans).map((p) => perPc(p, currency)));
  if (!most) return null;
  const step = currency === "INR" ? 10 : 0.25;
  return money(Math.floor(most / step) * step + step, currency);
}

/**
 * Public /plans, v3.1 (board SitePlans): PCs stepper (picks the plan that fits), currency dropdown, monthly / yearly,
 * the four plan cards, promises, why owners move up, members strip, compare table, billing questions, close.
 * Every price, PC limit and history length comes from GET /api/auth/plans/; the copy around them from
 * content/site/plans.ts. Signed out, a card's button goes to /signup?plan=<code>; signed in, to the plan step or Billing.
 * Currency starts on: the #region in the link, the visitor's last choice, the owner's billing currency, a time-zone guess.
 */
export default function PlansPage(): ReactElement {
  usePageMeta(seoFor("/plans"));
  useHashTarget();
  const { hash } = useLocation();
  const { token, onboarding, account } = useAuth();
  const plans = usePlans();
  const phone = useIsPhone();
  const [hashPick] = useState(() => fromHash(hash));
  const billed = (plans.data?.find((p) => p.quote)?.quote?.currency ?? null) as SiteCurrency | null;
  const [chosen, setChosen] = useState<SiteCurrency | null>(() => hashPick.currency ?? stored(CURRENCY_KEY, ["INR", "USD"]));
  const currency: SiteCurrency = chosen ?? billed ?? guessCurrency();
  const [cycle, setCycle] = useState<BillingCycle>(() => hashPick.cycle ?? stored(CYCLE_KEY, ["monthly", "yearly"]) ?? "monthly");
  const [pcsChosen, setPcsState] = useState<number>(() => pcsForTeamSize(account?.company?.team_size) ?? 8);
  const [typed, setTyped] = useState<string | null>(null);
  // Phone: the compare table shows one plan beside the features; this picks which (null = the plan that fits).
  const [cmpPick, setCmpPick] = useState<string | null>(null);

  const cap = pcCap(plans.data ?? []);
  const pcs = Math.min(pcsChosen, cap);
  const setPcs = (n: number) => {
    setPcsState(Math.max(1, Math.min(cap, Math.round(Number(n)) || 1)));
    setTyped(null);
  };
  const chooseCurrency = (c: SiteCurrency) => {
    setChosen(c);
    remember(CURRENCY_KEY, c);
  };
  const chooseCycle = (c: BillingCycle) => {
    setCycle(c);
    remember(CYCLE_KEY, c);
  };

  const list = plans.data ? [...plans.data].sort((a, b) => a.sort_order - b.sort_order) : [];
  const top = list.length ? list.reduce((a, b) => (b.max_devices > a.max_devices ? b : a)) : null;
  const firstPaid = paidPlans(list)[0];
  const fit = list.length ? planForPcs(list, pcs) : null;
  const lowest = cheapestPerPc(list, currency);
  const yearly = cycle === "yearly";
  const priceCap = list.length ? perPcCap(list, currency) : null;

  // Where a card's button goes and what it says. Signed out: sign up with the plan; signed in: the plan step or Billing.
  const ctaOf = (plan: Plan): { to: string; label: string } => {
    const label = plan.requires_payment ? `Choose ${plan.name}` : "Start free";
    if (token) {
      const inApp = onboarding ? hasSettledPlan(onboarding.step) : false;
      return inApp
        ? { to: "/app/settings/billing", label: "See your plan" }
        : { to: `/onboarding/plan?plan=${plan.code}&cycle=${cycle}`, label };
    }
    return { to: `/signup?plan=${encodeURIComponent(plan.code)}`, label };
  };
  const cta = (plan: Plan, fits: boolean): ReactElement => {
    const { to, label } = ctaOf(plan);
    return (
      <Link className={cx("zs-btn zs-btn--block", fits && "zs-btn--pri")} to={to}>
        {label}
      </Link>
    );
  };

  const card = (plan: Plan): ReactElement => {
    const fits = !!fit && fit.code === plan.code;
    const { tag, history, price, was, per, perPcLine, sub, points } = planCardText(plan, currency, cycle);
    // One badge per card at most: the plan that fits the PC count wins; the lowest per-PC price otherwise.
    const badge = fits ? `Fits your ${pcWord(pcs)}` : lowest?.code === plan.code ? "Lowest price per PC" : "";
    const included = (
      <>
        <div className="zp2-chips">
          <span className="zs-pill zs-num tone-grey">Up to {plan.max_devices} PCs</span>
          <span className="zs-pill tone-grey">{history} of history</span>
        </div>
        <ul className="zp2-points">
          {points.map((pt) => (
            <li key={pt.text}>
              <Tick size={16} className={pt.strong ? "zs-tick" : "zp2-tick-dim"} />
              <span className={pt.strong ? undefined : "zp2-dim"}>
                {pt.text}
                {pt.isNew ? <span className="zp2-new">New</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </>
    );
    return (
      <article key={plan.code} className={cx("zp2-plan", fits && "is-fit")} aria-label={plan.name}>
        {badge ? <span className={cx("zp2-badge", fits && "is-fit")}>{badge}</span> : null}
        <div className="zp2-plan__head">
          <h2>{plan.name}</h2>
          <span>{tag}</span>
        </div>
        <div className="zp2-price">
          <div className="zp2-price__row">
            {was ? (
              <s className="zp2-was">
                <span className="zs-sr">was </span>
                {was}
              </s>
            ) : null}
            <b className="zs-num">{price}</b>
            <span>{per}</span>
          </div>
          <span className="zp2-perpc zs-num">{perPcLine}</span>
          <span className="zp2-sub zs-num">{sub}</span>
        </div>
        {cta(plan, fits)}
        {fits ? included : <PhoneFold label="What's included">{included}</PhoneFold>}
      </article>
    );
  };

  const heroTitle = priceCap
    ? fill(PLANS_HERO.title, { cap: priceCap })
    : "Protect every PC and run your team, at a small price per PC a month.";
  const fitLine = fit ? (
    <>
      <b>{fit.name}</b>{" "}
      {`fits ${pcWord(pcs)}.${fit.requires_payment ? "" : " Free forever."}${pcs >= cap ? ` ${pcCapLine(cap)}` : ""}`}
    </>
  ) : null;
  const currencyPick = (id: string, className?: string): ReactElement => (
    <span className={cx("zp2-cur", className)}>
      <select id={id} value={currency} onChange={(e) => chooseCurrency(e.target.value === "USD" ? "USD" : "INR")}>
        <option value="INR">₹  INR · India</option>
        <option value="USD">$  USD · Other countries</option>
      </select>
      <PathIcon d={ICONS.chevron} size={14} stroke={2.4} />
    </span>
  );

  // Phone (board PhonePlanSite, 6 Nov 2026): the swipe plan screen in place of the hero, the controls and the stacked
  // cards. Each card is the plan card above with the same button.
  const swipeCard = (plan: Plan): ReactElement => {
    const fits = !!fit && fit.code === plan.code;
    const badge: SwipeBadge | null = fits
      ? { text: `Fits your ${pcWord(pcs)}`, tone: "fit" }
      : lowest?.code === plan.code
        ? { text: "Lowest price per PC", tone: "ink" }
        : null;
    const { to, label } = ctaOf(plan);
    return (
      <SwipeCard
        plan={plan}
        text={planCardText(plan, currency, cycle)}
        badge={badge}
        fits={fits}
        action={
          <Link className={cx("zsw-btn", fits && "is-pri")} to={to}>
            {label}
          </Link>
        }
      />
    );
  };
  const loadState = plans.error ? (
    <div className="zs-state zp2-state">
      <b>We couldn't load the plans</b>
      <span>{errorMessage(plans.error)}</span>
      <button type="button" className="zs-btn zs-btn--sm" onClick={plans.reload} disabled={plans.pending}>
        {plans.pending ? "Trying…" : "Try again"}
      </button>
    </div>
  ) : null;

  const faqs = PLANS_FAQ.map((f) => {
    const v = { first: firstPaid?.max_devices ?? 10, top: top?.max_devices ?? 50, topName: top?.name ?? "Businesses" };
    return { q: fill(f.q, v), a: fill(f.a, v) };
  });
  const tablePlans = list.slice(0, 4);
  const cmpNames = tablePlans.length ? tablePlans.map((p) => ({ code: p.code, name: p.name })) : [];
  const cmpCode = cmpPick ?? (fit && tablePlans.some((p) => p.code === fit.code) ? fit.code : (tablePlans[1]?.code ?? tablePlans[0]?.code));
  const cmpCol = Math.max(0, tablePlans.findIndex((p) => p.code === cmpCode)) + 2;

  return (
    <div className="zp2">
      {phone ? (
        <>
          <h1 className="zs-sr">{heroTitle}</h1>
          <div className="zp2-swipe" aria-busy={!plans.data && !plans.error}>
            {plans.data ? (
              <PlanSwipe
                site
                plans={list}
                fitCode={fit?.code ?? null}
                startCode={fit?.code ?? null}
                tools={{
                  cycle,
                  onCycle: chooseCycle,
                  saving: bestYearlySaving(list, currency),
                  pcs,
                  cap,
                  onPcs: (n) => setPcsState(Math.max(1, Math.min(cap, n))),
                }}
                fitLine={fitLine}
                renderCard={swipeCard}
                foot={
                  <label className="zp2-swipe__cur" htmlFor="zp2-cur-phone">
                    <span>Prices in</span>
                    {currencyPick("zp2-cur-phone")}
                  </label>
                }
              />
            ) : (
              <div className="zs-wrap zp2-swipe__wait">{loadState ?? <div className="zs-skel zp2-skel" />}</div>
            )}
          </div>
        </>
      ) : (
        <>
          <section className="zs-wrap zp2-hero">
            <span className="zs-eyebrow">{PLANS_HERO.eyebrow}</span>
            <h1 className="zs-h1 zp2-hero__h">
              {heroTitle}
            </h1>
            <p className="zp2-hero__lead">{PLANS_HERO.lead}</p>
          </section>

          {/* Controls: how many PCs (picks the plan that fits), currency, how often. */}
          <section className="zs-wrap zp2-ctls" aria-label="Price options">
            <div className="zp2-ctl">
              <label htmlFor="zp2-pcs" className="zp2-ctl__l">
                PCs in your office
              </label>
              <div className="zp2-step">
                <button type="button" className="zp2-step__b" aria-label="One fewer PC" onClick={() => setPcs(pcs - 1)}>
                  −
                </button>
                <input
                  id="zp2-pcs"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={cap}
                  value={typed ?? String(pcs)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setTyped(n > cap ? String(cap) : e.target.value);
                    if (e.target.value !== "" && n >= 1) setPcsState(Math.min(cap, Math.round(n)));
                  }}
                  onBlur={() => setTyped(null)}
                />
                <button type="button" className="zp2-step__b" aria-label="One more PC" disabled={pcs >= cap} onClick={() => setPcs(pcs + 1)}>
                  +
                </button>
              </div>
            </div>
            <div className="zp2-ctl">
              <label htmlFor="zp2-cur" className="zp2-ctl__l">
                Currency
              </label>
              {currencyPick("zp2-cur")}
            </div>
            <div className="zp2-ctl zp2-ctl--seg">
              <div className="zp2-seg" role="group" aria-label="How often you pay">
                <button type="button" className={cx("zp2-seg__b", !yearly && "is-on")} aria-pressed={!yearly} onClick={() => chooseCycle("monthly")}>
                  Monthly
                </button>
                <button type="button" className={cx("zp2-seg__b", yearly && "is-on")} aria-pressed={yearly} onClick={() => chooseCycle("yearly")}>
                  Yearly
                </button>
              </div>
            </div>
          </section>
          <p className="zp2-fit" aria-live="polite">
            {fitLine}
          </p>

          {/* The four plans. */}
          <section className="zs-wrap zs-wrap--wide zp2-cards" aria-busy={!plans.data && !plans.error}>
            {plans.data ? (
              list.map(card)
            ) : plans.error ? (
              loadState
            ) : (
              Array.from({ length: 4 }, (_, i) => <div key={`sk-${i}`} className="zs-skel zp2-skel" />)
            )}
          </section>

          <p className="zs-wrap zp2-seeall">
            <a href="#compare">
              Compare every feature <span aria-hidden="true">↓</span>
            </a>
          </p>
        </>
      )}

      {/* Risk taken away: the things owners worry about before paying. */}
      <section className="zs-wrap zs-wrap--wide zp2-promises-wrap">
        <div className="zp2-promises">
          {PROMISES.map((pr) => (
            <span key={pr.t} className="zp2-promise">
              <span className="zp2-promise__i" aria-hidden="true">
                <PathIcon d={pr.icon} size={15} stroke={2.2} />
              </span>
              <span className="zp2-promise__t">
                <b>{pr.t}</b>
                <span>{pr.b}</span>
              </span>
            </span>
          ))}
        </div>
      </section>

      {/* Why owners move up. */}
      <section className="zs-wrap zs-wrap--wide zp2-why">
        <div className="zp2-why__head">
          <span className="zs-eyebrow">Why owners move up</span>
          <h2>Each plan takes one more job off your plate.</h2>
        </div>
        <PhoneFold label="See what each plan adds">
          <div className="zp2-why__grid">
          {WHY.map((w) => {
            const p = list.find((x) => x.code === w.code);
            const how = p ? fill(w.how, { pcs: p.max_devices, history: historyLabel(p.history_days) }) : (w.fallback ?? w.how);
            return (
              <div key={w.plan} className="zp2-why__card">
                <span className={cx("zs-pill", w.tone)}>{w.plan}</span>
                <span className="zp2-why__pain">“{w.pain}”</span>
                <b>{w.fix}</b>
                <span className="zp2-why__how">{how}</span>
              </div>
            );
          })}
        </div>
        </PhoneFold>
      </section>

      {/* The same client wall as Home, not a scrolling strip. */}
      <div className="zh2">
        <ClientWall />
      </div>

      <section id="compare" className="zs-wrap zs-wrap--wide zp2-compare">
        <h2>Compare plans</h2>
        <PhoneFold label="Compare every feature">
        {cmpNames.length ? (
          <div className="zp2-cmp-pick" role="group" aria-label="Plan to compare">
            {cmpNames.map((p) => (
              <button key={p.code} type="button" className={cx("zp2-cmp-pick__b", p.code === cmpCode && "is-on")} aria-pressed={p.code === cmpCode} onClick={() => setCmpPick(p.code)}>
                {p.name}
              </button>
            ))}
          </div>
        ) : null}
        <div className="zp2-table-wrap">
          <table className="zp2-table" data-col={cmpNames.length ? cmpCol : undefined}>
            <thead>
              <tr>
                <th scope="col" className="zp2-table__f">
                  Feature
                </th>
                {tablePlans.length
                  ? tablePlans.map((p) => (
                      <th key={p.code} scope="col">
                        {p.name}
                      </th>
                    ))
                  : ["Free forever", "Startups", "Teams", "Businesses"].map((n) => (
                      <th key={n} scope="col">
                        {n}
                      </th>
                    ))}
              </tr>
            </thead>
            <tbody>
              <tr className="zp2-grp">
                <th scope="row" colSpan={5}>
                  BASICS
                </th>
              </tr>
              <tr>
                <th scope="row">PCs</th>
                {tablePlans.map((p) => (
                  <td key={p.code} className="zs-num">
                    {p.max_devices}
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">Alert and activity history</th>
                {tablePlans.map((p) => (
                  <td key={p.code} className="zs-num">
                    {historyLabel(p.history_days)}
                  </td>
                ))}
              </tr>
              {COMPARE_ROWS.map((r) =>
                "group" in r ? (
                  <tr key={r.group} className={cx("zp2-grp", r.group === "PROTECTION" && "zpl2-grp-prot")}>
                    <th scope="row" colSpan={5}>
                      {r.group}
                    </th>
                  </tr>
                ) : (
                  <tr key={r.f}>
                    <th scope="row">
                      {r.f}
                      {r.isNew ? <span className="zp2-new">New</span> : null}
                    </th>
                    {r.cells.map((fallback, i) => planHas(tablePlans[i], r.module, fallback)).map((c, i) => (
                      <td key={`${r.f}-${i}`}>
                        {c === "y" ? (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Included" className="zs-tick">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        ) : c === "n" ? (
                          <span className="zp2-no" aria-label="Not included">
                            —
                          </span>
                        ) : (
                          <span className="zp2-txt zs-num">{c}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
        </PhoneFold>
      </section>

      <section className="zs-wrap zs-wrap--wide zs-qa zp2-faq">
        <div className="zs-qa__intro">
          <span className="zs-eyebrow">Plan and billing questions</span>
          <h2 className="zp2-faq__h">Clear money, no surprises.</h2>
          <p>
            Still unsure which plan?{" "}
            <Link className="zs-link" to="/contact">
              Book a free setup call
            </Link>
            .
          </p>
        </div>
        <SiteFaq items={faqs} compact />
      </section>

      <section className="zs-wrap zs-wrap--wide zp2-closewrap">
        <div className="zs-close zp2-close">
          <img className="zs-close__z" src="/brand/zinwe-mark-256.png" width={256} height={256} alt="" aria-hidden="true" />
          <div className="zs-close__copy">
            <h2>{PLANS_CLOSE.title}</h2>
            <p>{PLANS_CLOSE.body}</p>
          </div>
          <div className="zs-close__acts">
            <Link className="zs-btn zs-btn--dark" to="/signup?plan=free">
              Start free
            </Link>
            <Link className="zs-btn zs-btn--white" to="/contact">
              Book a setup call
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
