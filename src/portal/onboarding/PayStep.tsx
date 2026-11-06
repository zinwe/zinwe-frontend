import { useState, type ReactElement } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/authContext";
import { ErrorState } from "../../dashboard/components/States";
import { higherPlans } from "../../dashboard/features/upgrade";
import { usePageMeta } from "../../hooks/usePageMeta";
import { errorMessage, type BillingCycle, type Payment, type PaymentInstructions, type Quote } from "../../lib/api";
import { planCodeParam } from "../../lib/planIntent";
import { Checkout } from "../components/Checkout";
import { cleanCoupon } from "../coupon";
import { planDevices } from "../plan";
import { useOffer } from "../useOffer";
import { usePlans } from "../usePlans";
import { useSubscriptionInfo } from "../useSubscriptionInfo";
import { usePlanFlow } from "./flow";

/** What is being paid for. Fixed when the page opens: paying moves the account on, and Done must still show. */
interface Order {
  kind: "due" | "upgrade" | "renew";
  /** The plan's code and name, and its PC limit ("Up to 25 PCs"). */
  code: string;
  name: string;
  devices: string;
  /** Shown until the server's price arrives. */
  quote?: Quote;
  /** The plan's PC limit (10). */
  pcs: number;
  rejected: Payment | null;
  offer?: { id: number; quote: Quote };
  instructions: PaymentInstructions;
}

/** Back on the plan page, without its offer opening this page again. */
export interface PlanPageState {
  stay?: boolean;
}

/** The plan page, keeping the plan, offer and coupon code this link was for. */
function planPageUrl(plan: string | null, offer: number, coupon = ""): string {
  const query = new URLSearchParams();
  if (plan) query.set("plan", plan);
  if (offer > 0) query.set("offer", String(offer));
  if (coupon) query.set("coupon", coupon);
  return `/onboarding/plan${query.size ? `?${query.toString()}` : ""}`;
}

/**
 * /onboarding/pay: the payment page, one for registering, upgrading and renewing.
 * - step `payment`: the plan waiting for payment (`/onboarding/subscribe` and `/onboarding/plan?checkout=1` land here);
 * - on a plan, `?plan=<code>`: an upgrade to a bigger plan; add `&offer=<id>` for an offer from the Zinwe team;
 * - on a plan, `?renew=1`: pay for the next period (Billing's Renew and Pay next month now).
 * `?cycle=` opens on monthly or yearly; `?coupon=<CODE>` (v1.3.5) fills in a coupon code and checks it. Anything else (nothing to pay, a payment already being checked) goes to the
 * plan page, which says why.
 */
export default function PayStep(): ReactElement {
  const { account, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const plans = usePlans();
  const info = useSubscriptionInfo();
  usePageMeta({ title: "Pay for your plan — Zinwe", description: "Pay for your Zinwe plan." });

  const step = account?.onboarding.step;
  const subscription = account?.subscription ?? null;
  const latest = subscription?.latest_payment ?? null;
  const onPlan = step === "complete" && subscription?.status === "active";
  const checking = latest?.status === "submitted";
  const asked = planCodeParam(params.get("plan"));
  const askedCycle = params.get("cycle");
  const wantsRenewal = params.get("renew") === "1";
  const couponParam = cleanCoupon(params.get("coupon") ?? "");
  const eligible = onPlan && !checking && plans.data ? higherPlans(plans.data, subscription?.plan.code, subscription ?? {}).map((p) => p.code) : [];

  const offerId = Number(params.get("offer")) || 0;
  const offerCode = offerId > 0 && asked && eligible.includes(asked) ? asked : null;
  const offerRes = useOffer(offerId, offerCode);

  const [order, setOrder] = useState<Order | null>(null);
  const [stage, setStage] = useState<"pay" | "done">("pay");

  // What this page is paying for: an order, "leave" when there's nothing to pay here, null while it loads.
  const decide = (): Order | "leave" | null => {
    if (!info.data) return null;
    const { subscription: sub, instructions } = info.data;
    if (wantsRenewal) {
      if (!onPlan || checking || !sub?.can_renew) return "leave";
      return {
        kind: "renew",
        code: sub.plan.code,
        name: sub.plan.name,
        devices: planDevices(sub.plan),
        pcs: sub.plan.max_devices,
        quote: sub.amount_due ?? undefined,
        rejected: latest?.status === "rejected" && latest.is_renewal ? latest : null,
        instructions,
      };
    }
    if (step === "payment" && subscription) {
      // The subscription just chosen on the plan page; a moment after, this page's own copy catches up.
      if (sub?.plan.code !== subscription.plan.code) return info.pending ? null : "leave";
      return {
        kind: "due",
        code: sub.plan.code,
        name: sub.plan.name,
        devices: planDevices(sub.plan),
        pcs: sub.plan.max_devices,
        quote: sub.amount_due ?? undefined,
        rejected: latest?.status === "rejected" ? latest : null,
        instructions,
      };
    }
    if (!onPlan || checking || !asked) return "leave";
    if (!plans.data) return null;
    if (!eligible.includes(asked)) return "leave";
    const plan = plans.data.find((p) => p.code === asked);
    if (!plan) return "leave";
    // Still loading: for a plan, the answer is an offer or an error.
    if (offerId > 0 && !offerRes.data && !offerRes.error) return null;
    // An offer that's gone, or online payment off (it's paid online only): the plan page says so.
    const offer = offerRes.data && offerRes.data.online_enabled && instructions.online ? offerRes.data : null;
    if (offerId > 0 && !offer) return "leave";
    return {
      kind: "upgrade",
      code: plan.code,
      name: plan.name,
      devices: planDevices(plan),
      pcs: plan.max_devices,
      quote: plan.quote ?? undefined,
      rejected: latest?.status === "rejected" && latest.upgrade_plan_name ? latest : null,
      offer: offer ? { id: offer.id, quote: offer.due } : undefined,
      instructions,
    };
  };

  const decided = order ?? decide();
  const current = decided === "leave" ? null : decided;
  if (!order && current) setOrder(current);

  // Registering stays registering through to Done, even once the plan is on.
  usePlanFlow((current?.kind ?? (onPlan ? "upgrade" : "due")) !== "due", stage);

  const planPage = planPageUrl(asked, offerId, offerId > 0 ? "" : couponParam);

  if (decided === "leave") {
    if (wantsRenewal) return <Navigate to="/app/settings/billing" replace />;
    return <Navigate to={planPage} replace state={{ stay: true } satisfies PlanPageState} />;
  }

  const failure = info.error ?? plans.error;
  if (!current) {
    return failure ? (
      <ErrorState
        title="We couldn't load the payment details"
        message={errorMessage(failure)}
        onRetry={() => {
          info.reload();
          plans.reload();
        }}
        retrying={info.pending || plans.pending}
      />
    ) : (
      <div className="zau-boot" role="status" aria-live="polite">
        <span className="zau-spin" aria-hidden="true" />
        Loading…
      </div>
    );
  }

  const upgrade = current.kind === "upgrade";
  const initialCycle: BillingCycle | undefined = askedCycle === "monthly" || askedCycle === "yearly" ? askedCycle : undefined;

  return (
    <Checkout
      key={`${current.kind}:${current.code}`}
      planName={current.name}
      initialQuote={current.quote}
      initialCycle={initialCycle}
      instructions={current.instructions}
      devices={current.devices}
      pcs={current.pcs}
      initialCoupon={current.kind !== "renew" && !current.offer && couponParam ? couponParam : undefined}
      reference={account?.company?.name || undefined}
      upgradePlan={upgrade ? current.code : undefined}
      renewal={current.kind === "renew"}
      offer={current.offer}
      rejected={current.rejected}
      shareQuote={current.kind === "due"}
      ownerEmail={account?.user.email ?? "you"}
      back={
        current.kind === "renew"
          ? { to: "/app/settings/billing", label: "Back to Plan & billing" }
          : { to: planPage, label: "Change plan", state: { stay: true } satisfies PlanPageState }
      }
      onStage={setStage}
      onSubmitted={async (payment) => {
        const sub = info.data?.subscription;
        if (!upgrade && sub) await info.submitted(sub, payment);
        else await refresh();
      }}
      onDone={() => navigate("/app")}
    />
  );
}
