/** Company, plans, subscription and manual payment. */
import { ApiError, authedDownload, authedRequest } from "./http";
import type {
  BillingCycle,
  Company,
  CouponCheck,
  CompanyPayload,
  Payment,
  PaymentPayload,
  Plan,
  SharedQuote,
  Subscription,
  SubscriptionInfo,
  UpgradeQuote,
  UpiQr,
} from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

/** GET company/ — throws ApiError `not_found` before the company is registered. */
export function getCompany(signal?: AbortSignal): Promise<Company> {
  return authedRequest<Company>("/api/auth/company/", { signal });
}

/** POST company/ — 409 `conflict` if one is already registered. */
export function createCompany(payload: CompanyPayload): Promise<Company> {
  return authedRequest<Company>("/api/auth/company/", { method: "POST", body: payload });
}

/** PATCH company/ */
export function updateCompany(payload: Partial<CompanyPayload>): Promise<Company> {
  return authedRequest<Company>("/api/auth/company/", { method: "PATCH", body: payload });
}

/**
 * GET plans/ — public, ordered by sort_order. Signed-in callers send their token
 * so `trial_available` reflects their own account (one free trial, ever).
 * A stale token (401) is cleared by the transport; the list is then fetched anonymously.
 */
export async function getPlans(signal?: AbortSignal): Promise<Plan[]> {
  try {
    return await authedRequest<Plan[]>("/api/auth/plans/", { signal, optionalAuth: true });
  } catch (error) {
    if (error instanceof ApiError && error.kind === "unauthorized") {
      return authedRequest<Plan[]>("/api/auth/plans/", { signal, anonymous: true });
    }
    throw error;
  }
}

/** GET subscription/ — the latest subscription (or null) and how to pay. */
export function getSubscription(signal?: AbortSignal): Promise<SubscriptionInfo> {
  return authedRequest<SubscriptionInfo>("/api/auth/subscription/", { signal });
}

/** POST subscription/ — free/trial plans come back `active`, paid ones `pending_payment`. */
export function createSubscription(plan: string): Promise<Subscription> {
  return authedRequest<Subscription>("/api/auth/subscription/", { method: "POST", body: { plan } });
}

/** A frozen tax invoice (backend z_auth/invoices.py). Amounts are in `currency`. */
export interface Invoice {
  number: string;
  title?: string;
  issued_on: string;
  paid_on: string;
  status: "paid";
  currency?: "INR" | "USD";
  seller: { name: string; address: string; email: string; gstin: string; state?: string };
  customer: { name: string; contact: string; email: string; address: string; gstin: string; state?: string; country?: string };
  place_of_supply?: string;
  export?: boolean;
  lines: Array<{
    description: string;
    sac?: string;
    period_from: string | null;
    period_until: string | null;
    list_amount?: string;
    discount_amount?: string;
    amount?: string;
    amount_inr: string;
  }>;
  taxable_amount?: string;
  taxes?: Array<{ label: string; rate: string; amount: string }>;
  tax_total?: string;
  total?: string;
  total_inr: string;
  total_in_words?: string;
  payment: { method: string; reference: string; payer: string; amount_paid?: string };
  notes?: string[];
  note: string;
}

/** Download the invoice PDF of a confirmed payment. */
export function downloadInvoicePdf(paymentId: number, number?: string | null): Promise<void> {
  const name = `Zinwe-invoice-${(number ?? String(paymentId)).replace(/\//g, "-")}.pdf`;
  return authedDownload(`/api/auth/subscription/payments/${paymentId}/invoice/pdf/`, name);
}

/** GET subscription/payments/<id>/invoice/ — only for confirmed payments (409 before). */
export function getInvoice(paymentId: number, signal?: AbortSignal): Promise<Invoice> {
  return authedRequest<Invoice>(`/api/auth/subscription/payments/${paymentId}/invoice/`, { signal });
}

/** GET subscription/payments/ — every payment the owner reported, newest first. */
export function getPaymentHistory(signal?: AbortSignal): Promise<Payment[]> {
  return authedRequest<Payment[]>("/api/auth/subscription/payments/", { signal });
}

/** POST subscription/payment/ — multipart, so the proof file can ride along. A payment made
 * while a paid plan is active is a renewal: it adds a month once confirmed. */
export function submitPayment(payload: PaymentPayload): Promise<Payment> {
  const form = new FormData();
  for (const key of ["method", "amount_inr", "reference", "paid_on", "payer_name"] as const) {
    const value = payload[key];
    if (value) form.append(key, value);
  }
  if (payload.proof) form.append("proof", payload.proof, payload.proof.name);
  if (payload.upgrade_plan) form.append("upgrade_plan", payload.upgrade_plan);
  if (payload.billing_cycle) form.append("billing_cycle", payload.billing_cycle);
  if (payload.coupon) form.append("coupon", payload.coupon);
  form.append("accept_terms", payload.accept_terms ? "true" : "false");
  return authedRequest<Payment>("/api/auth/subscription/payment/", { method: "POST", form });
}

/** GET subscription/upi-qr/[?upgrade=<plan>][&cycle=][&coupon=] — the UPI QR for what's due (or that upgrade), for
 * one billing cycle (and a coupon code), made on request (404 when there's no UPI payment). */
export function getUpiQr(upgradePlan?: string, cycle?: BillingCycle, coupon?: string, signal?: AbortSignal): Promise<UpiQr> {
  const params = new URLSearchParams();
  if (upgradePlan) params.set("upgrade", upgradePlan);
  if (cycle) params.set("cycle", cycle);
  if (coupon) params.set("coupon", coupon);
  const query = params.toString();
  return authedRequest<UpiQr>(`/api/auth/subscription/upi-qr/${query ? `?${query}` : ""}`, { signal });
}

/**
 * GET subscription/checkout/[?plan=][&cycle=] — what the checkout shows for one billing cycle: the quote, the
 * period it buys, the UPI link and how much a year saves. `plan` = an upgrade (or another plan than the one
 * waiting for payment); none = what's due. 409 when there's nothing to pay or the upgrade isn't possible.
 */
export function getCheckoutPreview(
  options: { plan?: string; cycle?: BillingCycle; coupon?: string },
  signal?: AbortSignal,
): Promise<UpgradeQuote> {
  const params = new URLSearchParams();
  if (options.plan) params.set("plan", options.plan);
  if (options.cycle) params.set("cycle", options.cycle);
  // v1.3.5: priced with the code when it's valid (refused: no coupon + `coupon_error`).
  if (options.coupon) params.set("coupon", options.coupon);
  const query = params.toString();
  return authedRequest<UpgradeQuote>(`/api/auth/subscription/checkout/${query ? `?${query}` : ""}`, { signal });
}

/**
 * GET subscription/coupon/?code=&plan=&cycle= (F-21): check a coupon code for one plan and cycle. Always 200: `ok`
 * true with the quote after the code (and `capped` when the plan's lowest price limits it), or false with a reason
 * and a plain sentence to show. The server upper-cases and trims the code, and checks it again at payment.
 */
export function checkCoupon(
  options: { code: string; plan: string; cycle: BillingCycle },
  signal?: AbortSignal,
): Promise<CouponCheck> {
  const params = new URLSearchParams({ code: options.code, plan: options.plan, cycle: options.cycle });
  return authedRequest<CouponCheck>(`/api/auth/subscription/coupon/?${params.toString()}`, { signal });
}

/** GET quotes/<token>/upi-qr/ — a shared quote's UPI QR, on request, while the quote is open. */
export function getPublicUpiQr(token: string, signal?: AbortSignal): Promise<UpiQr> {
  return authedRequest<UpiQr>(`/api/auth/quotes/${encodeURIComponent(token)}/upi-qr/`, { anonymous: true, signal });
}

/** Download the receipt the owner uploaded with a payment. */
export function downloadPaymentProof(paymentId: number): Promise<void> {
  return authedDownload(`/api/auth/subscription/payment/${paymentId}/proof/`, `Zinwe-receipt-${paymentId}`);
}

/** GET subscription/quote/ — the owner's quote and its public link (409 when nothing is due). */
export function getMyQuote(signal?: AbortSignal): Promise<SharedQuote> {
  return authedRequest<SharedQuote>("/api/auth/subscription/quote/", { signal });
}

/** POST subscription/quote/email/ — email the quote PDF (attached) to the owner, or to `email`. */
export function emailQuote(email = ""): Promise<{ sent_to: string; public_url: string }> {
  return authedRequest("/api/auth/subscription/quote/email/", { method: "POST", body: email ? { email } : {} });
}

/** Download the owner's quote as a PDF. */
export function downloadQuotePdf(): Promise<void> {
  return authedDownload("/api/auth/subscription/quote/pdf/", "Zinwe-quote.pdf");
}

/** GET quotes/<token>/ — a shared quote, for anyone with the link (404 once nothing is due). */
export function getPublicQuote(token: string, signal?: AbortSignal): Promise<SharedQuote> {
  return authedRequest<SharedQuote>(`/api/auth/quotes/${encodeURIComponent(token)}/`, { anonymous: true, signal });
}

/** The shared quote's PDF, as a plain link (no sign-in needed). */
export function publicQuotePdfUrl(token: string): string {
  return `${API_BASE}/api/auth/quotes/${encodeURIComponent(token)}/pdf/`;
}

/** A published release note (FR-21). `body` is plain text: "## " heading, "- " bullet. */
export interface ReleaseNote {
  id: number;
  version: string;
  title: string;
  summary: string;
  body: string;
  published_at: string;
}

export interface Testimonial {
  id: number;
  kind: "owner" | "member";
  quote: string;
  rating: number;
  name: string;
  role: string;
  company: string;
}

/** GET testimonials/ — what Home shows, newest first (no sign-in needed). */
export function getTestimonials(signal?: AbortSignal): Promise<Testimonial[]> {
  return authedRequest<Testimonial[]>("/api/auth/testimonials/", { signal, anonymous: true });
}

/** GET whats-new/ — published release notes, newest first (no sign-in needed). */
export function getReleaseNotes(signal?: AbortSignal): Promise<ReleaseNote[]> {
  return authedRequest<ReleaseNote[]>("/api/auth/whats-new/", { signal, anonymous: true });
}
