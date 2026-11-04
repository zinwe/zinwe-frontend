/** Accounts: sign up, codes, log in/out, password reset, the current user. */
import { API_BASE, authedRequest, postPublic, type SubmitResult } from "./http";
import type { Announcement, AuthResponse, Me, User } from "./types";

export type OtpPurpose = "signup" | "login" | "password_reset";

/** Every "a code is on its way" answer carries the resend cooldown. */
export interface CodeSent {
  detail?: string;
  /** Seconds before another code can be requested. */
  resend_in: number;
}

export interface SignupPayload {
  full_name: string;
  email: string;
  password: string;
  /** The Terms + Privacy + Acceptable Use checkbox; the server refuses sign-up without it. */
  accept_terms: boolean;
  /** Where the visitor came from when the site knows (lib/attribution.ts), e.g. "tlf:ep07:email". */
  source?: string;
}
export type SignupField = Exclude<keyof SignupPayload, "source">;
export interface SignupResponse extends CodeSent {
  email: string;
  otp_sent: boolean;
}

/** POST signup/ — create (or refresh) an unverified account and email a code. */
export function signup(payload: SignupPayload): Promise<SubmitResult<SignupResponse, SignupField>> {
  return postPublic("/api/auth/signup/", payload, ["full_name", "email", "password", "accept_terms"]);
}

export type CodeField = "email" | "code";

/** POST signup/verify/ — activate the account; signs the owner in. */
export function signupVerify(email: string, code: string): Promise<SubmitResult<AuthResponse, CodeField>> {
  return postPublic("/api/auth/signup/verify/", { email, code }, ["email", "code"]);
}

/** POST otp/resend/ — always 200 (no enumeration); 429 while cooling down. */
export function resendOtp(email: string, purpose: OtpPurpose): Promise<SubmitResult<CodeSent, "email">> {
  return postPublic("/api/auth/otp/resend/", { email, purpose }, ["email"]);
}

export type LoginField = "email" | "password";

/** POST login/ — 403 `unverified` when the account still needs its signup code. */
export function login(email: string, password: string): Promise<SubmitResult<AuthResponse, LoginField>> {
  return postPublic("/api/auth/login/", { email, password }, ["email", "password"]);
}

// --- Social sign-in (FR-38) ---------------------------------------------------------------------------------

export type SocialProvider = "google" | "linkedin";

export interface SocialConfig {
  google: { enabled: boolean; client_id: string };
  linkedin: { enabled: boolean; client_id: string; scope: string };
}

const SOCIAL_OFF: SocialConfig = {
  google: { enabled: false, client_id: "" },
  linkedin: { enabled: false, client_id: "", scope: "" },
};

let socialConfigPromise: Promise<SocialConfig> | null = null;

/** GET social/ — which providers this site offers (public client ids only). Cached; never throws. */
export function getSocialConfig(): Promise<SocialConfig> {
  socialConfigPromise ??= fetch(`${API_BASE}/api/auth/social/`, { headers: { Accept: "application/json" } })
    .then((response) => (response.ok ? (response.json() as Promise<SocialConfig>) : SOCIAL_OFF))
    .catch(() => {
      socialConfigPromise = null; // try again next time the page opens
      return SOCIAL_OFF;
    });
  return socialConfigPromise;
}

/** AuthResponse plus whether the account was just created (sign-up) or already existed (log-in). */
export interface SocialAuthResponse extends AuthResponse {
  created: boolean;
}

/** POST social/<provider>/ — Google: the pop-up's `code`; LinkedIn: `code` + the exact `redirect_uri`. */
export function socialSignIn(
  provider: SocialProvider,
  code: string,
  redirectUri?: string,
): Promise<SubmitResult<SocialAuthResponse, "code">> {
  return postPublic(`/api/auth/social/${provider}/`, { code, redirect_uri: redirectUri ?? "" }, ["code"]);
}

/** POST login/otp/request/ — always 200 with the same body. */
export function loginOtpRequest(email: string): Promise<SubmitResult<CodeSent, "email">> {
  return postPublic("/api/auth/login/otp/request/", { email }, ["email"]);
}

/** POST login/otp/verify/ */
export function loginOtpVerify(email: string, code: string): Promise<SubmitResult<AuthResponse, CodeField>> {
  return postPublic("/api/auth/login/otp/verify/", { email, code }, ["email", "code"]);
}

/** POST password/forgot/ — always 200 with the same body. */
export function forgotPassword(email: string): Promise<SubmitResult<CodeSent, "email">> {
  return postPublic("/api/auth/password/forgot/", { email }, ["email"]);
}

export type ResetField = "email" | "code" | "new_password";

/** POST password/reset/ — sets the password, revokes old tokens, signs in. */
export function resetPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<SubmitResult<AuthResponse, ResetField>> {
  return postPublic("/api/auth/password/reset/", { email, code, new_password: newPassword }, [
    "email",
    "code",
    "new_password",
  ]);
}

export type ChangePasswordField = "current_password" | "new_password";

/**
 * POST password/change/ — signed in. Rotates the token (other devices are signed
 * out) and returns a fresh AuthResponse; 400 carries `current_password` / `new_password` errors.
 */
export function changePassword(currentPassword: string, newPassword: string): Promise<AuthResponse> {
  return authedRequest<AuthResponse>("/api/auth/password/change/", {
    method: "POST",
    body: { current_password: currentPassword, new_password: newPassword },
  });
}

/** POST terms/accept/ — the owner accepts the current Terms (the updated-terms prompt). */
export function acceptTerms(): Promise<User> {
  return authedRequest<User>("/api/auth/terms/accept/", { method: "POST", body: { accept_terms: true } });
}

/** POST tour/done/ — the dashboard tour was finished or skipped; it won't start again on any device (204). */
export function markTourDoneOnServer(): Promise<null> {
  return authedRequest<null>("/api/auth/tour/done/", { method: "POST" });
}

/** POST logout/ — deletes the token server-side (204). */
export function logout(signal?: AbortSignal): Promise<null> {
  return authedRequest<null>("/api/auth/logout/", { method: "POST", signal });
}

/** GET me/ — the owner, their onboarding step, company and subscription. */
export function getMe(signal?: AbortSignal): Promise<Me> {
  return authedRequest<Me>("/api/auth/me/", { signal });
}

/** GET announcements/ — the dashboard's bars: pushed messages for this owner, then the upgrade bar. */
export async function getAnnouncements(signal?: AbortSignal): Promise<Announcement[]> {
  const data = await authedRequest<{ announcements: Announcement[] }>("/api/auth/announcements/", { signal });
  return data.announcements ?? [];
}

/** The dashboard feed (F-11, v1.3.3): the bars, plus at most one pop-up the server decided is due today. */
export interface AnnouncementFeed {
  announcements: Announcement[];
  /** Older backends leave it out. */
  popups: Announcement[];
}

export async function getAnnouncementFeed(signal?: AbortSignal): Promise<AnnouncementFeed> {
  const data = await authedRequest<{ announcements?: Announcement[]; popups?: Announcement[] }>("/api/auth/announcements/", { signal });
  return { announcements: data.announcements ?? [], popups: Array.isArray(data.popups) ? data.popups : [] };
}

/**
 * The record id inside an item id: pushed messages are "a<pk>-<updated>" (z_auth/announcements.py), the seen
 * endpoint takes the pk. Any other id is sent as it is.
 */
export function announcementPk(id: string): string {
  return /^a(\d+)(?:-|$)/.exec(id)?.[1] ?? id;
}

/**
 * POST announcements/<id>/seen/ — a pop-up was shown (counts a view), closed for good with `{closed: true}`, or its
 * button pressed with `{clicked: true}` (counted for the Pop-ups numbers in the admin app; doesn't use up a view).
 */
export function markAnnouncementSeen(id: string, closed = false, clicked = false): Promise<unknown> {
  const body: Record<string, boolean> = {};
  if (closed) body.closed = true;
  if (clicked) body.clicked = true;
  return authedRequest(`/api/auth/announcements/${encodeURIComponent(announcementPk(id))}/seen/`, {
    method: "POST",
    body,
  });
}

/** GET announcements/public/ — the bars for the public website, sign-up and onboarding (no sign-in). */
export async function getWebsiteAnnouncements(signal?: AbortSignal): Promise<Announcement[]> {
  const data = await authedRequest<{ announcements: Announcement[] }>("/api/auth/announcements/public/", {
    signal,
    anonymous: true,
  });
  return data.announcements ?? [];
}
