/** Shapes from the portal contract (.cloude/system-design-agent/portal-v1.md §3). */

export type TeamSize = "1-10" | "11-25" | "26-50" | "50+";

export interface User {
  id: number;
  email: string;
  full_name: string;
  phone: string;
  is_staff: boolean;
  date_joined: string;
  email_verified?: boolean;
  /** Which Terms version they accepted; `needs_acceptance` asks once for the current one. */
  terms?: TermsStatus;
  /** The dashboard tour was finished or skipped on any device (POST tour/done/). Absent on older backends. */
  tour_done?: boolean;
  /** FR-38: the last social provider used to sign in ("google" | "linkedin"; "" = email). Absent on older backends. */
  auth_provider?: string;
  /** FR-38: the provider's profile photo (https), for the onboarding "Signed in with …" card. */
  avatar_url?: string;
  /**
   * F-11 (v1.3.3, GET me/): time to ask for feedback (account 3+ days old, a real moment, nothing asked or sent in
   * 30 days). Absent from an older backend: no prompt.
   */
  feedback_prompt_due?: boolean;
}

export interface TermsStatus {
  version: string;
  accepted_at: string | null;
  current_version: string;
  needs_acceptance: boolean;
}

export type OnboardingStep = "company" | "plan" | "payment" | "payment_review" | "complete";

export type SubscriptionStatus = "pending_payment" | "active" | "expired" | "cancelled";

/** The frontend routes on `step`. */
export interface Onboarding {
  step: OnboardingStep;
  has_company: boolean;
  subscription_status: SubscriptionStatus | null;
}

export interface AuthResponse {
  token: string;
  user: User;
  onboarding: Onboarding;
}

export type Industry =
  | "it_services"
  | "manufacturing"
  | "finance"
  | "healthcare"
  | "education"
  | "retail"
  | "professional_services"
  | "other";

export interface Company {
  id: number;
  name: string;
  industry: Industry;
  team_size: TeamSize;
  phone: string;
  city: string;
  state: string;
  country: string;
  gstin: string;
  website: string;
  created_at: string;
}

export type CompanyPayload = Omit<Company, "id" | "created_at">;
export type CompanyField = keyof CompanyPayload;

export type Currency = "INR" | "USD";
export type BillingCycle = "monthly" | "yearly";

/**
 * What a customer pays for one billing cycle (backend z_auth/pricing.py): India = INR monthly + GST
 * (CGST + SGST in the seller's state, IGST elsewhere); outside India = USD yearly, no GST (export under LUT).
 * Amounts are decimal strings.
 */
export interface Quote {
  plan_code: string;
  plan_name: string;
  currency: Currency;
  billing_cycle: BillingCycle;
  months: number;
  list_amount: string;
  discount_amount: string;
  /** Taxable value for the whole cycle. */
  amount: string;
  taxes: Array<{ label: string; rate: string; amount: string }>;
  tax_total: string;
  /** What the customer pays. */
  total: string;
  region: "IN" | "INTL";
  place_of_supply: string;
  export: boolean;
  note: string;
  /** v1.3.5: a coupon code applied to this quote (first month of monthly billing only); null / absent = none.
   * `amount` is already after it; `discount_amount` stays the launch discount only. */
  coupon?: QuoteCoupon | null;
}

/** The coupon block of a quote (F-21). Amounts are decimal strings. */
export interface QuoteCoupon {
  code: string;
  percent_off: number;
  amount_off: string;
  /** The plan's lowest price capped the discount. */
  capped: boolean;
}

/** Why a coupon code was refused (GET subscription/coupon/). */
export type CouponReason =
  | "not_found"
  | "not_started"
  | "ended"
  | "paused"
  | "other_plan"
  | "monthly_only"
  | "used_before"
  | "limit_reached"
  | "lowest_price"
  | "offer";

/** GET subscription/coupon/?code=&plan=&cycle=: a code checked against one plan and cycle. `message` is plain
 * English, shown as it is. */
export type CouponCheck =
  | {
      ok: true;
      code: string;
      percent_off: number;
      capped: boolean;
      amount_off: string;
      message: string;
      quote: Quote;
    }
  | { ok: false; code: string; reason: CouponReason | string; message: string };

export interface Plan {
  code: string;
  name: string;
  tagline: string;
  /** What the owner pays each month (after any discount). Decimal string, e.g. "971.00". */
  price_inr_monthly: string;
  /** The price before the discount, shown struck through; "0.00" = no discount. Absent on older backends. */
  list_price_inr_monthly?: string;
  /** Off the list price, e.g. 28 (0 = none). */
  discount_percent?: number;
  /** Outside India: per month, billed yearly ("0.00" = not sold in USD). */
  price_usd_monthly?: string;
  list_price_usd_monthly?: string;
  /** Every price by currency and cycle (monthly / yearly), for the plan cards' switches. */
  prices?: { INR: CurrencyPrices; USD: CurrencyPrices };
  /** What the signed-in owner would pay (their country's currency, cycle and tax); null for visitors. */
  quote?: Quote | null;
  trial_days: number;
  max_devices: number;
  features: string[];
  /** What the plan switches on (enforced by the backend); see `PlanModule`. */
  modules?: PlanModule[];
  is_recommended: boolean;
  requires_payment: boolean;
  sort_order: number;
  /** v1.1: `trial_days > 0` and the caller hasn't used a trial (always true signed out). */
  trial_available: boolean;
  /** Days of history the plan keeps (0 = no limit). Absent on older backends. */
  history_days?: number;
  /** GST is added to this price for this caller (seller GSTIN set, caller in India or signed out). Absent on
   * older backends: then nothing promises GST. */
  gst_charged?: boolean;
}

/** "razorpay": paid online and approved automatically (no receipt). */
export type PaymentMethod = "upi" | "bank_transfer" | "paypal" | "skydo" | "cheque" | "cash" | "razorpay";
export type PaymentStatus = "submitted" | "verified" | "rejected";

export interface Payment {
  id: number;
  method: PaymentMethod;
  /** Legacy name: the amount paid, in `currency`. */
  amount_inr: string;
  currency?: Currency;
  /** What was due when it was reported (empty object on older payments). */
  due?: Partial<Quote>;
  /** Set once confirmed: e.g. "ZW/2026-27/0001". */
  invoice_number?: string | null;
  reference: string;
  paid_on: string;
  payer_name: string;
  status: PaymentStatus;
  rejection_reason: string;
  has_proof: boolean;
  submitted_at: string;
  reviewed_at: string | null;
  /** Paid while the plan was active, to extend it by a month. */
  is_renewal: boolean;
  /** The period an approved payment paid for. */
  covers_from: string | null;
  covers_until: string | null;
  plan_name: string;
  /** Set when this payment is an upgrade to another plan. */
  upgrade_plan_name?: string | null;
}

export interface Subscription {
  id: number;
  plan: Plan;
  status: SubscriptionStatus;
  /** Legacy name: the plan price for one billing cycle, before tax, in `currency`. */
  amount_inr: string;
  currency?: Currency;
  billing_cycle: BillingCycle | string;
  /** A payment link made for this customer (Skydo: card or US bank). */
  payment_link?: string;
  /** The next payment (plan + tax), while one can be made; null otherwise. */
  amount_due?: Quote | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  latest_payment: Payment | null;
  /** v1.1: a built-in free trial (amount 0, ends at `ends_at`). */
  is_trial: boolean;
  /** Whole days until an active plan ends (0 = today); null when open-ended. */
  days_left: number | null;
  /** An active paid plan with no payment under review: next month can be paid now. */
  can_renew: boolean;
  /** The month a renewal paid now would add (starts at the current end date). */
  renewal_period: { from: string; until: string } | null;
}

export interface PaymentInstructions {
  upi_id: string;
  payee_name: string;
  bank_name: string;
  /** e.g. "Current" (v1.1). */
  account_type: string;
  account_number: string;
  ifsc: string;
  /** PayPal (outside India, only until Skydo is set up); "" hides the option. */
  paypal_url: string;
  note: string;
  /** "IN" = UPI + bank; "INTL" = Skydo link / Skydo US account. */
  region?: "IN" | "INTL";
  currency?: Currency;
  /** The Skydo US account for ACH / wire (null when not set up). */
  skydo?: SkydoAccount | null;
  /** This customer's own payment link (card or US bank), set by the Zinwe team. */
  payment_link?: string;
  /** The `upi://pay?...` link with the exact amount (a "Pay in a UPI app" button on phones); "" = none. */
  upi_uri?: string;
  /** Online payment (Razorpay), rupees or US dollars; null / missing = only the manual ways. */
  online?: { provider: "razorpay"; key_id: string } | null;
}

/** GET subscription/upgrade/<plan_code>/: what an upgrade from the active plan costs and covers. */
export interface UpgradeQuote {
  quote: Quote;
  /** ISO dates (YYYY-MM-DD). */
  covers_from: string;
  covers_until: string;
  /** Paid days left on the current plan, added to the new one. */
  carried_days: number;
  upi_uri: string;
  /** How much a year saves on this plan in the owner's currency, in whole percent (0 = none). */
  yearly_saving_percent?: number;
  /** Asked with `?coupon=` and the code was refused: no coupon applied, and why. */
  coupon_error?: { reason: CouponReason | string; message: string } | null;
}

/** One cycle's price for a whole cycle, before tax: the struck-through list price and what's paid. */
export interface CyclePrice {
  list: string;
  price: string;
}

/** A plan's prices in one currency: monthly, yearly (the whole year) and how much a year saves. */
export interface CurrencyPrices {
  monthly: CyclePrice;
  yearly: CyclePrice;
  yearly_saving_percent: number;
}

/**
 * GET subscription/upi-qr/ (or quotes/<token>/upi-qr/): a UPI QR made on request (FR-06), from the server's own
 * UPI ID with the exact amount. The page never carries a QR until the payer asks for one.
 */
export interface UpiQr {
  /** The QR as an SVG document (shown as an image, never as markup). */
  svg: string;
  upi_id: string;
  payee_name: string;
  /** "971.00" (INR). */
  amount: string;
  note: string;
  upi_uri: string;
}

export interface SkydoAccount {
  account_name?: string;
  bank_name?: string;
  account_number?: string;
  routing_number?: string;
  account_type?: string;
  swift?: string;
}

export interface SubscriptionInfo {
  subscription: Subscription | null;
  instructions: PaymentInstructions;
}

/**
 * A shared quote (backend z_auth/quotes.py): what's due next and every way to pay. The owner's own
 * (GET subscription/quote/) and the public page /quote/<token> (GET quotes/<token>/) have the same shape.
 */
export interface SharedQuote {
  /**
   * Public link (2026-10-17): the quote as issued. "open" = pay this; "paid" = a payment came in after it was issued;
   * "replaced" = what's due changed, the plan ended or it expired. Only "open" may show ways to pay. Absent = open.
   */
  status?: "open" | "paid" | "replaced";
  /** e.g. "ZWQ/2026-27/00007" */
  number: string;
  issued_on: string;
  valid_until: string;
  kind: "subscription" | "renewal";
  seller: { name: string; address: string; email: string; gstin: string };
  customer: { name: string; contact: string; address: string; gstin: string };
  plan: { code: string; name: string; max_devices: number };
  description: string;
  quote: Quote;
  total_in_words: string;
  instructions: PaymentInstructions;
  /** The website page anyone with the link can open. */
  public_url: string;
}

/** A part of Zinwe a plan switches on (backend z_auth/entitlements.py). */
export type PlanModule =
  | "usb_alerts"
  | "usb_control"
  | "data_transfer"
  | "remote_access"
  | "software_installs"
  | "web"
  | "work_time"
  | "app_usage"
  | "team_chat"
  | "alert_to_employee"
  | "reports_pro";

/** GET me/ `entitlements`: what the owner's plan switches on right now, and the PC limit. */
export interface Entitlements {
  plan_code: string | null;
  plan_name: string | null;
  /** False when no plan is active (none yet, waiting for payment, expired): Free forever applies. */
  on_active_plan: boolean;
  modules: PlanModule[];
  /** 0 = no limit. */
  max_devices: number;
  /** Days of alerts / activity / work-log history the plan keeps (0 = no limit). Absent on older backends. */
  history_days?: number;
  /** v1.4: days of team chat the plan keeps (Free 30 · Startups 90 · Teams 180 · Businesses 365). Absent on older backends. */
  chat_history_days?: number;
  /** v1.5 round 2: the largest file one can share in chat, in MB (Free 1024 · Startups 2048 · Teams 3072 · Businesses 5120). */
  file_max_mb?: number;
  devices_used: number;
  /** For each locked module, the cheapest plan that has it. */
  upgrade_for: Partial<Record<PlanModule, { code: string; name: string }>>;
}

/** 403 body when a call needs a module the plan doesn't include. */
export interface PlanFeatureError {
  detail: string;
  code: "plan_feature";
  module: PlanModule;
  upgrade_plan: string;
  upgrade_plan_name: string;
}

/** GET me/ — the user plus everything the portal routes and greets with. */
export interface Me extends User {
  onboarding: Onboarding;
  company: Company | null;
  subscription: Subscription | null;
  /** Unchanged legacy field; the portal reads `subscription` instead. */
  active_plan?: unknown;
  /** Absent from an older backend: the dashboard then locks nothing. */
  entitlements?: Entitlements;
}

/**
 * A notification-bar item: a message pushed from the admin panel (offer, discount, news, new version,
 * maintenance) or, on the dashboard only, the upgrade bar derived from the owner's plan.
 */
/** v1.3.5 (F-22) adds the User interactions kinds `feedback_ask` (a 1-10 score and a line) and `upgrade_ask`. */
export type AnnouncementKind =
  | "version"
  | "offer"
  | "discount"
  | "news"
  | "maintenance"
  | "upgrade"
  | "wish"
  | "feedback_ask"
  | "upgrade_ask";

/** The coupon an offer interaction carries (v1.3.5): "Use the code" opens /onboarding/plan?coupon=<code>. */
export interface AnnouncementCoupon {
  code: string;
  percent_off?: number;
  /** The plan it is for, when it is for one ("startups"). */
  plan_code?: string | null;
  /** Last day (IST), "2027-01-05". */
  ends_on?: string | null;
  /** A ready line from the server ("Startups ₹679.70 + GST for the first month, about ₹68 per PC."). */
  note?: string;
}

export interface Announcement {
  /** Stable id used to remember a dismissal; changes when the message changes. */
  id: string;
  kind: AnnouncementKind;
  title: string;
  body: string;
  /** Call-to-action; `cta_label` is empty when there's no action. */
  cta_label: string;
  cta_href: string;
  dismissible: boolean;
  /** Picture on top of a pop-up, relative to the API origin (v1.3.3); null shows the kind's own illustration. */
  image_url?: string | null;
  /** v1.3.5: the moment it was picked for ("signin" | "signout" | ...). */
  trigger?: string;
  /** v1.3.5: an offer's coupon code (a bare code string on some backends). */
  coupon?: AnnouncementCoupon | string | null;
}

/**
 * POST subscription/payment/. The payment page sends only the receipt, the way the owner paid and the
 * terms tick (2026-10-16); the server fills in the amount due, today and the owner's name. Without a
 * receipt, `reference` is required instead.
 */
export interface PaymentPayload {
  method?: PaymentMethod;
  amount_inr?: string;
  reference?: string;
  /** yyyy-mm-dd */
  paid_on?: string;
  payer_name?: string;
  proof: File | null;
  /** Dashboard upgrade: the plan code this payment moves the owner up to. */
  upgrade_plan?: string;
  /** Monthly or yearly, as chosen at checkout (default: the subscription's own). */
  billing_cycle?: BillingCycle;
  /** v1.3.5: a coupon code applied at checkout (monthly only); the server checks it again. */
  coupon?: string;
  /** The payment-terms checkbox (billing terms + refund policy); required by the server. */
  accept_terms: boolean;
}

export type PaymentField = keyof PaymentPayload;
