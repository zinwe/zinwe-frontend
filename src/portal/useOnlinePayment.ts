import { useState } from "react";
import { ApiError, errorMessage, type BillingCycle, type Payment } from "../lib/api";
import { createOnlineOrder, verifyOnlinePayment, type OnlineResult } from "../lib/api/payments";
import { trackEvent } from "../lib/analytics";
import { openCheckout } from "./razorpay";

export type OnlineStage = "idle" | "starting" | "open" | "confirming";

/**
 * Paying online with Razorpay, in one click: create the order (priced on the server, for the chosen cycle), open
 * Razorpay's window, then confirm the payment. If Razorpay is off, down, refusing the order or its window is
 * blocked, `onUnavailable` says why (the checkout then shows the manual ways); a declined payment sets `error`.
 * The money is never asked for twice: when we can't hear back, `onPending` says we're confirming it.
 */
export function useOnlinePayment({
  upgradePlan,
  offer,
  cycle,
  coupon,
  onPaid,
  onPending,
  onUnavailable,
}: {
  upgradePlan?: string;
  offer?: number;
  cycle?: BillingCycle;
  /** v1.3.5: an applied coupon code (monthly only), sent with the order; the server checks it again. */
  coupon?: string;
  onPaid: (payment: Payment | null) => void | Promise<void>;
  onPending: (result: OnlineResult) => void | Promise<void>;
  onUnavailable?: (reason: string) => void;
}): { stage: OnlineStage; error: string | null; pay: () => Promise<void>; clearError: () => void } {
  const [stage, setStage] = useState<OnlineStage>("idle");
  const [error, setError] = useState<string | null>(null);

  const unavailable = (reason: string) => {
    if (onUnavailable) onUnavailable(reason);
    else setError(`${reason} Please try again in a few minutes.`);
  };

  const pay = async () => {
    if (stage !== "idle") return;
    setError(null);
    setStage("starting");
    let order;
    try {
      order = await createOnlineOrder(upgradePlan, offer, cycle, coupon);
    } catch (err) {
      setStage("idle");
      // 503 (off / Razorpay down) or a network failure: the manual ways.
      if (!(err instanceof ApiError) || err.status === 503 || err.status === 0) {
        unavailable("Online payment isn't available right now.");
      } else {
        setError(errorMessage(err));
      }
      return;
    }
    trackEvent("add_payment_info", { payment_type: "razorpay" });
    setStage("open");
    let outcome;
    try {
      outcome = await openCheckout(order);
    } catch {
      setStage("idle");
      unavailable("The secure payment window couldn't load (a blocker or a slow connection can stop it).");
      return;
    }
    if (outcome.kind === "dismissed") {
      setStage("idle");
      return;
    }
    if (outcome.kind === "failed") {
      setStage("idle");
      setError(`${outcome.reason} Nothing was charged. Try again, or pay manually.`);
      return;
    }
    setStage("confirming");
    try {
      const result = await verifyOnlinePayment(outcome.response);
      if (result.status === "paid") {
        trackEvent("purchase", { payment_type: "razorpay" });
        await onPaid(result.payment ?? null);
      } else {
        await onPending(result);
      }
    } catch (err) {
      // We couldn't hear back: the money may be taken. Never ask them to pay again; the server finishes it.
      await onPending({
        status: "confirming",
        detail: `We're confirming your payment (${errorMessage(err)}). If Razorpay took it, your plan updates within the hour and we'll email you. Please don't pay again.`,
      });
    }
    setStage("idle");
  };

  return { stage, error, pay, clearError: () => setError(null) };
}
