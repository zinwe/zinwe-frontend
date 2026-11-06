/** Online payment (Razorpay Standard Checkout), z_payments. The manual ways to pay stay in billing.ts. */
import { authedRequest } from "./http";
import type { BillingCycle, Payment, Quote } from "./types";

/** POST payments/razorpay/order/: what Razorpay's checkout needs. `key_id` is public; secrets stay on the server. */
export interface OnlineOrder {
  key_id: string;
  order_id: string;
  /** In paise. */
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill: { name: string; email: string; contact: string };
}

/**
 * POST payments/razorpay/verify/:
 * - "paid": the plan is updated and the invoice issued (`payment` is the approved payment);
 * - "confirming": Razorpay couldn't be asked just now. The money is safe, and the plan updates within the hour;
 * - "review": paid, but the plan changed meanwhile, so the team applies it by hand.
 */
export interface OnlineResult {
  status: "paid" | "confirming" | "review";
  payment?: Payment | null;
  detail?: string;
}

/** 503 with `fallback: true` = online payment is off or Razorpay is down: use UPI / bank transfer. A refused coupon
 * (or one with an offer) is a 400 `{detail, reason}`. */
export function createOnlineOrder(
  upgradePlan?: string,
  offer?: number,
  cycle?: BillingCycle,
  coupon?: string,
): Promise<OnlineOrder> {
  return authedRequest<OnlineOrder>("/api/payments/razorpay/order/", {
    method: "POST",
    body: {
      accept_terms: true,
      ...(upgradePlan ? { upgrade_plan: upgradePlan } : {}),
      ...(offer ? { offer } : {}),
      ...(cycle && !offer ? { billing_cycle: cycle } : {}),
      ...(coupon && !offer ? { coupon } : {}),
    },
  });
}

/**
 * GET payments/offer/<id>/?plan=: an offer the Zinwe team sent this owner (a dashboard notification bar), with its
 * price. 404 when it has ended, isn't theirs, or was used. Paid online only; the order checks it all again.
 */
export interface Offer {
  id: number;
  title: string;
  plan_code: string;
  plan_name: string;
  ends_at: string | null;
  online_only: true;
  /** False when online payment is off right now (the offer can't be used until it's back). */
  online_enabled: boolean;
  due: Quote;
}

export function getOffer(id: number, planCode: string, signal?: AbortSignal): Promise<Offer> {
  return authedRequest<Offer>(`/api/payments/offer/${id}/?plan=${encodeURIComponent(planCode)}`, { signal });
}

export function verifyOnlinePayment(body: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}): Promise<OnlineResult> {
  return authedRequest<OnlineResult>("/api/payments/razorpay/verify/", { method: "POST", body });
}
