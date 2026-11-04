/** Owner feedback: a 1–10 rating plus an optional note, read by the Zinwe team. */
import { authedRequest } from "./http";

export interface Feedback {
  id: number;
  rating: number;
  message: string;
  page: string;
  created_at: string;
}

export interface FeedbackPayload {
  rating: number;
  message?: string;
  /** The dashboard page it was sent from. */
  page?: string;
}

/** GET feedback/ — the owner's own last 10, newest first. */
export function getMyFeedback(signal?: AbortSignal): Promise<Feedback[]> {
  return authedRequest<Feedback[]>("/api/auth/feedback/", { signal });
}

/** POST feedback/prompt/ (F-11) — the feedback prompt card was shown, or the owner said "Not now". */
export function sendFeedbackPrompt(action: "shown" | "dismissed"): Promise<unknown> {
  return authedRequest("/api/auth/feedback/prompt/", { method: "POST", body: { action } });
}

/** POST feedback/ — 400 `validation` if the rating isn't 1–10; 429 after 20 an hour. */
export function sendFeedback(payload: FeedbackPayload): Promise<Feedback> {
  return authedRequest<Feedback>("/api/auth/feedback/", { method: "POST", body: payload });
}
