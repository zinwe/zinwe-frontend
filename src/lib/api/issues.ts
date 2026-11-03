/** Report an issue: a problem the owner hit, with an optional screenshot and the browser details, read by the team. */
import { authedRequest } from "./http";

export type IssueStatus = "new" | "looking" | "fixed" | "closed";

export interface Issue {
  id: number;
  description: string;
  page: string;
  contact_ok: boolean;
  has_screenshot: boolean;
  status: IssueStatus;
  /** The team's last reply, as emailed. */
  reply: string;
  replied_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface IssuePayload {
  description: string;
  /** Where it happened (a dashboard path). */
  page?: string;
  /** Email me updates about this report. */
  contact_ok: boolean;
  /** Browser details: page, window and screen size, browser, language, time zone. */
  context?: Record<string, string>;
  /** PNG, JPG or WebP, up to 5 MB. */
  screenshot?: File | null;
}

/** GET issues/ — the owner's own reports, newest first, with status and the team's reply. */
export function getMyIssues(signal?: AbortSignal): Promise<Issue[]> {
  return authedRequest<Issue[]>("/api/auth/issues/", { signal });
}

/** POST issues/ — multipart when there's a screenshot, JSON otherwise. 429 after 10 an hour. */
export function sendIssue(payload: IssuePayload): Promise<Issue> {
  const { screenshot, context, ...rest } = payload;
  if (!screenshot) return authedRequest<Issue>("/api/auth/issues/", { method: "POST", body: { ...rest, context } });
  const form = new FormData();
  form.append("description", rest.description);
  if (rest.page) form.append("page", rest.page);
  form.append("contact_ok", rest.contact_ok ? "true" : "false");
  if (context) form.append("context", JSON.stringify(context));
  form.append("screenshot", screenshot, screenshot.name);
  return authedRequest<Issue>("/api/auth/issues/", { method: "POST", form });
}

/** The browser details sent with a report, so the team can reproduce it. Nothing personal. */
export function browserContext(): Record<string, string> {
  const ua = navigator.userAgent;
  // Order matters: Edge says Chrome too, Chrome says Safari too.
  const known: [string, RegExp][] = [["Edge", /Edg\/(\d+)/], ["Chrome", /Chrome\/(\d+)/], ["Firefox", /Firefox\/(\d+)/], ["Safari", /Version\/(\d+).*Safari/]];
  const hit = known.map(([name, re]) => [name, re.exec(ua)?.[1]] as const).find(([, version]) => version);
  const browser = hit ? `${hit[0]} ${hit[1]}` : "Other";
  const platform = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Other";
  return {
    url: window.location.pathname,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    screen: `${window.screen.width}x${window.screen.height}`,
    pixel_ratio: String(window.devicePixelRatio || 1),
    browser,
    platform,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    online: navigator.onLine ? "yes" : "no",
  };
}

const SHOT_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const SHOT_MAX_BYTES = 5 * 1024 * 1024;
const SHOT_MAX_SIDE = 1920;

/**
 * Checks a screenshot and makes it light to upload: a big image (over 1920 px or 1.5 MB) is redrawn at most 1920 px
 * wide as a JPEG. Returns an error message instead of a file when it can't be used.
 */
export async function prepareScreenshot(file: File): Promise<File | string> {
  if (!SHOT_TYPES.includes(file.type)) return "Attach a PNG, JPG or WebP image.";
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return "That image couldn't be opened. Try another one.";
  }
  const big = bitmap.width > SHOT_MAX_SIDE || bitmap.height > SHOT_MAX_SIDE || file.size > 1.5 * 1024 * 1024;
  if (!big) {
    bitmap.close();
    return file;
  }
  const scale = Math.min(1, SHOT_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.85));
  if (!blob) return file.size <= SHOT_MAX_BYTES ? file : "The image is too large. The limit is 5 MB.";
  if (blob.size > SHOT_MAX_BYTES) return "The image is too large. The limit is 5 MB.";
  return new File([blob], "screenshot.jpg", { type: "image/jpeg" });
}
