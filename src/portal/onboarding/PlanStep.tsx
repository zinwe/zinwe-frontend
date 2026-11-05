import { useEffect, useRef, useState, type ReactElement } from "react";
import { DashIcon } from "../../dashboard/components/DashIcon";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/authContext";
import { onboardingFor } from "../../auth/steps";
import { ErrorState } from "../../dashboard/components/States";
import { higherPlans } from "../../dashboard/features/upgrade";
import { usePageMeta } from "../../hooks/usePageMeta";
import {
  ApiError,
  createSubscription,
  errorMessage,
  type BillingCycle,
  type Plan,
} from "../../lib/api";
import { useIsPhone } from "../../hooks/useIsPhone";
import { formatDate, formatMoney, isZero } from "../../lib/format";
import { pcCap } from "../../lib/planCards";
import { clearPlanIntent, planCodeParam, readPlanIntent } from "../../lib/planIntent";
import { FormAlert } from "../components/FormAlert";
import { PlanChooser, PlanChooserLoading, type ChooserCard } from "../components/PlanChooser";
import { PlanDone } from "../components/PlanDone";
import { RejectedBanner } from "../components/RejectedBanner";
import { apiFailureMessage } from "../failure";
import { hasTrial, pcsForTeamSize, planChargesGst, planCtaLabel, planForPcs, trialBadge } from "../plan";
import { useOffer } from "../useOffer";
import { usePlans } from "../usePlans";
import { useSubscriptionInfo } from "../useSubscriptionInfo";
import { usePlanFlow, type PlanBar } from "./flow";
import type { PlanPageState } from "./PayStep";

/** The PC stepper's start when nothing says better. */
const USUAL_PCS = 8;

/**
 * /onboarding/plan — the one place to choose a plan, outside the dashboard, drawn like the public /plans page:
 * - first time (step `plan`) or waiting for payment (`payment`): every plan; free plans and trials start at
 *   once, a paid plan goes on to the payment page, /onboarding/pay (`?checkout=1` goes straight there for the plan
 *   waiting for payment);
 * - on a plan (`complete`): an upgrade. Every plan is shown in full; the current one is flagged, it and the
 *   lower ones have their button disabled. Paying is the same payment page, priced by GET subscription/checkout/?plan=
 *   (carried-over days, its own UPI QR);
 * - payment being checked (`payment_review`, or an active plan whose upgrade / renewal payment is being
 *   checked, 2026-10-17): the plans, read only, so nobody pays twice.
 * `?plan=<code>` puts the PC stepper on that plan's limit, so its card is the one flagged (links from the dashboard,
 * the website and emails); otherwise the company's team size does.
 * Monthly or yearly (2026-10-23): the switch (`?cycle=` from the plans page) sets the prices shown and the cycle the
 * payment page opens on; it can still change there.
 * `?offer=<id>` (with `?plan=`): an offer the Zinwe team sent from the admin panel (a dashboard notification bar).
 * Its own price (GET payments/offer/<id>/), paid online only; the payment page opens with it on arrival.
 */
export default function PlanStep(): ReactElement {
  const { account, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const plans = usePlans();
  const info = useSubscriptionInfo();

  const step = account?.onboarding.step;
  const subscription = account?.subscription ?? null;
  const latest = subscription?.latest_payment ?? null;
  const onPlan = step === "complete" && subscription?.status === "active";
  // An upgrade or renewal paid on an active plan, not confirmed yet: no second payment.
  const checking = onPlan && latest?.status === "submitted";
  const upgrading = onPlan && !checking;
  const reviewing = step === "payment_review" || checking;
  const pending = step === "payment" ? (subscription?.plan.code ?? null) : null;
  const current = onPlan ? (subscription?.plan.code ?? null) : null;
  const eligible = upgrading && plans.data ? higherPlans(plans.data, current, subscription ?? {}).map((p) => p.code) : [];
  // The plan the payment being checked is for (an upgrade names it; otherwise the owner's plan).
  const checkingCode =
    reviewing && plans.data
      ? (plans.data.find((p) => latest?.upgrade_plan_name && p.name === latest.upgrade_plan_name)?.code ??
        subscription?.plan.code ??
        null)
      : null;
  // Rejected: say why where the owner pays again (waiting for payment, or a refused upgrade).
  const rejected =
    latest?.status === "rejected" && (pending !== null || (upgrading && Boolean(latest.upgrade_plan_name)))
      ? latest
      : null;

  // Back here because the free trial ran out, or a paid plan ended without a renewal (step `plan`).
  const trialEnded = !onPlan && subscription?.is_trial === true && subscription.status === "expired";
  const paidEnded =
    !onPlan && subscription?.is_trial === false && subscription.status === "expired" && Number(subscription.amount_inr) > 0;

  usePageMeta({
    title: upgrading ? "Upgrade your plan — Zinwe" : "Choose a plan — Zinwe",
    description: "Pick the Zinwe plan that fits your team.",
  });

  const asked = planCodeParam(params.get("plan"));

  // The PC stepper starts on what the link asked for, else the team size on the company form; when upgrading, always
  // somewhere that fits a bigger plan.
  const teamPcs = pcsForTeamSize(account?.company?.team_size);
  const cap = pcCap(plans.data ?? []);
  const [chosenPcs, setChosenPcs] = useState<number | null>(null);
  const limitOf = (code: string | null | undefined): number => plans.data?.find((p) => p.code === code)?.max_devices ?? 0;
  const startPcs = (): number => {
    if (upgrading) {
      if (asked && eligible.includes(asked)) return limitOf(asked) || USUAL_PCS;
      const fitsTeam = teamPcs && plans.data ? planForPcs(plans.data, teamPcs) : null;
      if (teamPcs && fitsTeam && eligible.includes(fitsTeam.code)) return teamPcs;
      return limitOf(eligible[0]) || limitOf(current) || USUAL_PCS;
    }
    return limitOf(pending ?? asked ?? readPlanIntent()) || teamPcs || USUAL_PCS;
  };
  const pcs = Math.min(cap, chosenPcs ?? startPcs());

  // Monthly or yearly: `?cycle=` (the plans page's switch), else the subscription's own, else by currency.
  const currency = plans.data?.find((p) => p.quote)?.quote?.currency === "USD" ? "USD" : "INR";
  const askedCycle = params.get("cycle");
  const [chosenCycle, setChosenCycle] = useState<BillingCycle | null>(
    askedCycle === "monthly" || askedCycle === "yearly" ? askedCycle : null,
  );
  const cycle: BillingCycle =
    chosenCycle ??
    (subscription?.billing_cycle === "yearly" || subscription?.billing_cycle === "monthly"
      ? subscription.billing_cycle
      : currency === "USD"
        ? "yearly"
        : "monthly");

  // "Prices in ₹, billed monthly, plus 18% GST" (the rate from the owner's own quote).
  const taxRate = plans.data
    ?.map((p) => p.quote)
    .find((q) => q && q.taxes.length > 0)
    ?.taxes.reduce((sum, t) => sum + Number(t.rate), 0);
  const gst = plans.data?.some(planChargesGst) ?? false;
  const foot = `Prices in ${currency === "USD" ? "$" : "₹"}, billed ${cycle}${
    currency === "INR" && gst ? `, plus ${taxRate ? `${taxRate}% ` : ""}GST` : ""
  }. You pay in the currency of the country on your company profile.`;

  // An offer from a dashboard bar: only for the plan it names, while upgrading. The order checks it all again.
  const offerId = Number(params.get("offer")) || 0;
  const offerCode = upgrading && offerId > 0 && asked && eligible.includes(asked) ? asked : null;
  const offerRes = useOffer(offerId, offerCode);
  // Usable here: online payment is on (the offer is paid online only).
  const offer = offerRes.data && offerRes.data.online_enabled && info.data?.instructions.online ? offerRes.data : null;
  const offerGone = offerCode !== null && offerRes.error instanceof ApiError && offerRes.error.kind === "not_found";

  // Paying is its own page, so Back works. An offer's page opens on arrival, once (coming back leaves this page as it is).
  const payUrl = (query: Record<string, string>): string => `/onboarding/pay?${new URLSearchParams(query).toString()}`;
  const offerUrl = offer ? payUrl({ plan: offer.plan_code, offer: String(offer.id) }) : null;
  const stay = (location.state as PlanPageState | null)?.stay === true;
  const offerOpened = useRef(false);
  useEffect(() => {
    if (!offerUrl || stay || offerOpened.current) return;
    offerOpened.current = true;
    navigate(offerUrl, { replace: true });
  }, [offerUrl, stay, navigate]);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A free plan or a trial just started: the Done screen, whatever the account's step has become.
  const [started, setStarted] = useState<Plan | null>(null);

  // A phone: this page's own top bar in place of the header (board PhonePlanApp): "Choose a plan · Step 2 of 4 ·
  // <company>" with Skip while registering, "Upgrade your plan · You are on <plan>" on a plan.
  const phone = useIsPhone();
  const registering = !onPlan && !reviewing;
  const bar: PlanBar | null =
    phone && !started
      ? {
          title: upgrading ? "Upgrade your plan" : reviewing ? "Your plan" : "Choose a plan",
          sub: registering
            ? [`Step 2 of 4`, account?.company?.name].filter(Boolean).join(" · ")
            : reviewing
              ? "Payment being checked"
              : `You are on ${subscription?.plan.name ?? "your plan"}`,
          // The company step is done once (it can be changed in Settings), so Back from step 2 goes there.
          backTo: registering ? "/app/settings/company" : "/app",
          backLabel: registering ? "Back to your company details" : "Back to dashboard",
          skipTo: registering ? "/app" : null,
        }
      : null;
  usePlanFlow(started ? false : onPlan, started || reviewing ? "done" : "choose", bar);

  const choose = async (plan: Plan) => {
    setError(null);
    if (upgrading) {
      const useOffer = offer?.plan_code === plan.code;
      navigate(useOffer && offerUrl ? offerUrl : payUrl({ plan: plan.code, cycle }));
      return;
    }
    if (plan.code === pending) {
      navigate(payUrl({ cycle }));
      return;
    }
    setBusy(plan.code);
    try {
      const created = await createSubscription(plan.code);
      clearPlanIntent();
      if (created.status === "active") setStarted(plan);
      await refresh({ onboarding: onboardingFor(created), subscription: created });
      // Waiting for payment: the payment page loads what's due and how to pay for the new choice.
      if (created.status !== "active") navigate(payUrl({ cycle }));
    } catch (err) {
      setStarted(null);
      setError(apiFailureMessage(err));
      // 409: already active or under review elsewhere (another tab) — let the page catch up.
      if (err instanceof ApiError && err.kind === "conflict") void refresh();
      // A trial this account already used: reload so the card shows the paid price.
      if (err instanceof ApiError && err.kind === "validation" && hasTrial(plan)) plans.reload();
    } finally {
      setBusy(null);
    }
  };

  const stateOf = (plan: Plan): ChooserCard => {
    if (reviewing) {
      return {
        off: true,
        label: plan.code === checkingCode ? "Payment being checked" : plan.code === current ? "Your plan" : "Available after the check",
        flag: plan.code === checkingCode ? "Payment being checked" : plan.code === current ? "Your plan" : null,
      };
    }
    if (upgrading && !eligible.includes(plan.code)) {
      const mine = plan.code === current;
      return { off: true, label: mine ? "Your plan" : "Included in your plan", flag: mine ? "Your plan" : null };
    }
    const label = upgrading
      ? `Upgrade to ${plan.name}`
      : plan.code === pending
        ? "Continue to payment"
        : hasTrial(plan)
          ? planCtaLabel(plan)
          : isZero(plan.price_inr_monthly)
            ? "Start free"
            : `Choose ${plan.name}`;
    return { off: false, label, flag: plan.code === pending ? "Waiting for payment" : null, note: hasTrial(plan) ? trialBadge(plan) : null };
  };

  const checkingWhat = latest?.upgrade_plan_name
    ? `the upgrade to ${latest.upgrade_plan_name}`
    : latest?.is_renewal
      ? `your ${subscription?.plan.name} renewal`
      : `${subscription?.plan.name}`;
  const lede = upgrading
    ? eligible.length
      ? `You're on ${subscription?.plan.name}. Pick a bigger plan: it starts today and any paid days left carry over.`
      : `You're on ${subscription?.plan.name}, our biggest plan.`
    : checking && latest
      ? `We're checking your payment of ${formatMoney(latest.amount_inr, latest.currency)} for ${checkingWhat}, sent ${formatDate(
          latest.submitted_at,
        )}. You can change plans again once it's confirmed, usually within one working day. Paid twice by mistake? Email hello@zinwe.io and we'll refund it.`
      : reviewing
        ? "We're checking your payment. You can change plans once it's confirmed, usually within one working day."
        : trialEnded
          ? `Your free trial of ${subscription?.plan.name} has ended. Choose a plan to keep protecting your PCs.`
          : paidEnded
            ? `Your ${subscription?.plan.name} plan ended. Choose it again to renew, or pick another plan. Your devices and settings are saved.`
            : teamPcs
              ? "We picked the plan that fits your team. Start free if you want to try first. No card, no auto-charge."
              : "Start free if you want to try first. No card, no auto-charge.";


  // On a phone the top bar names the page; only a lede that says something about the account stays.
  const ledeMatters = reviewing || trialEnded || paidEnded || (upgrading && eligible.length === 0);

  if (started) {
    return (
      <PlanDone title={`${started.name} is on`} onDone={() => navigate("/app")}>
        Connect your first PC from the dashboard. You can upgrade any time.
      </PlanDone>
    );
  }

  // `?checkout=1`: the plan waiting for payment, straight on the payment page (older emails and links).
  if (params.get("checkout") === "1" && pending) return <Navigate to="/onboarding/pay" replace />;

  return (
    <section className="zpf-page" aria-labelledby="onb-plan-title">
      {/* "Back to dashboard" lives in the header (OnboardingLayout), once. */}
      <div className={phone ? "zpf-head zsw-head" : "zpf-head"}>
        <h1 className={phone ? "zau-h1 zpf-title z-sr" : "zau-h1 zpf-title"} id="onb-plan-title">
          {upgrading ? "Upgrade your plan" : reviewing ? "Your plan" : "Pick your plan"}
        </h1>
        {!phone || ledeMatters ? <p className="zau-lede">{lede}</p> : null}
      </div>

      {rejected ? (
        <RejectedBanner
          payment={rejected}
          next={pending ? "Choose Continue to payment to pay again and send the new receipt." : "You can pay for the upgrade again below."}
        />
      ) : null}
      {offer ? (
        <div className="zau-offer" role="status">
          <DashIcon name="card" />
          <span>
            <b>{offer.title}</b> Zinwe {offer.plan_name} for {formatMoney(offer.due.total, offer.due.currency)}
            {offer.due.taxes.length ? " including GST" : ""}, paid online
            {offer.ends_at ? `, until ${formatDate(offer.ends_at)}` : ""}. Renewals are at the normal price.
          </span>
          <button type="button" className="zau-btn pri" onClick={() => offerUrl && navigate(offerUrl)}>
            Use the offer
          </button>
        </div>
      ) : offerGone ? (
        <FormAlert message={errorMessage(offerRes.error)} />
      ) : null}
      <FormAlert message={error} />

      {plans.data ? (
        <PlanChooser
          plans={plans.data}
          currency={currency}
          cycle={cycle}
          onCycle={setChosenCycle}
          pcs={pcs}
          cap={cap}
          onPcs={setChosenPcs}
          showTools={!reviewing && !(upgrading && eligible.length === 0) && plans.data.length > 1}
          busy={busy}
          stateOf={stateOf}
          onChoose={(plan) => void choose(plan)}
          foot={foot}
        />
      ) : plans.error ? (
        <ErrorState
          title="We couldn't load the plans"
          message={errorMessage(plans.error)}
          onRetry={plans.reload}
          retrying={plans.pending}
        />
      ) : (
        <PlanChooserLoading />
      )}
    </section>
  );
}
