/**
 * v1.5 file sharing in chat, owner side (D:\Programming\zinwe-wt\_v15\BRIEF.md §2c–§2f):
 *
 * - POST /api/chat/files/            multipart `file` → 201 FileJSON (not attached yet; the line's POST attaches it
 *                                    with `file_id`, see sendGroupMessage and sendMessage)
 * - GET  /api/chat/files/<uuid>/     the file (attachment); `?inline=1` for an image's real type (thumbnails)
 *
 * Both need the token, so an image can't be an <img src>: thumbnails and downloads are fetched as blobs.
 * The upload uses XMLHttpRequest for its progress (fetch has no upload progress), with a plain fetch fallback.
 */
import { clearToken, getToken } from "../session";
import { FILE_COPY, filePath, normaliseFile, type ChatFile } from "../chatFileModel";
import { API_BASE, ApiError, authedRequest, ERROR_COPY, toMessages, type ApiErrorKind } from "./http";

export * from "../chatFileModel";

const UPLOAD_PATH = "/api/chat/files/";

function kindOf(status: number): ApiErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404 || status === 410) return "not_found";
  if (status === 400 || status === 413) return "validation";
  if (status === 429) return "rate_limited";
  return "server";
}

function detailOf(body: unknown): string | undefined {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const d = (body as Record<string, unknown>).detail;
    if (typeof d === "string" && d) return d;
  }
  return undefined;
}

/** The ApiError for a failed file call, in the words the brief gives (§2c, §2f). */
function fileError(status: number, body: unknown, token: string | null): ApiError {
  const kind = kindOf(status);
  if (kind === "unauthorized") {
    if (token && getToken() === token) clearToken();
    return new ApiError(kind, status, ERROR_COPY.unauthorized);
  }
  // nginx refuses an over-size body before Django sees it.
  if (status === 413) return new ApiError(kind, status, FILE_COPY.tooBig, { file: [FILE_COPY.tooBig] });
  if (status === 410) return new ApiError(kind, status, detailOf(body) ?? FILE_COPY.expired);
  if (kind === "validation") {
    const fieldErrors: Record<string, string[]> = {};
    if (body && typeof body === "object" && !Array.isArray(body)) {
      for (const [key, value] of Object.entries(body)) {
        const messages = toMessages(value);
        if (messages.length) fieldErrors[key] = messages;
      }
    }
    return new ApiError(kind, status, Object.values(fieldErrors)[0]?.[0] ?? ERROR_COPY.validation, fieldErrors);
  }
  if (kind === "forbidden") return new ApiError(kind, status, detailOf(body) ?? FILE_COPY.off);
  if (kind === "rate_limited") return new ApiError(kind, status, detailOf(body) ?? ERROR_COPY.rate_limited);
  return new ApiError(kind, status, ERROR_COPY[kind]);
}

function parse(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/**
 * Upload one file (POST /api/chat/files/). `onProgress` gets 0…1 while it goes up. Rejects with ApiError (the
 * server's words for 400/403, FILE_COPY.tooBig for nginx's 413), or the caller's AbortError.
 */
export function uploadChatFile(file: File, { onProgress, signal }: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {}): Promise<ChatFile> {
  const token = getToken();
  if (!token) return Promise.reject(new ApiError("unauthorized", 401, ERROR_COPY.unauthorized));
  const form = new FormData();
  form.append("file", file, file.name);

  if (typeof XMLHttpRequest === "undefined") {
    // No progress events: the bar waits at the start, then the chip moves on.
    return authedRequest<unknown>(UPLOAD_PATH, { method: "POST", form, signal }).then((raw) => {
      const made = normaliseFile(raw);
      if (!made) throw new ApiError("server", 500, ERROR_COPY.server);
      onProgress?.(1);
      return made;
    });
  }

  return new Promise<ChatFile>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const done = () => signal?.removeEventListener("abort", onAbort);
    xhr.open("POST", `${API_BASE}${UPLOAD_PATH}`);
    xhr.setRequestHeader("Authorization", `Token ${token}`);
    xhr.setRequestHeader("Accept", "application/json");
    // Token auth only, never cookies (as authedRequest).
    xhr.withCredentials = false;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      done();
      const body = parse(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        const made = normaliseFile(body);
        if (made) {
          onProgress?.(1);
          resolve(made);
        } else reject(new ApiError("server", xhr.status, ERROR_COPY.server));
        return;
      }
      reject(fileError(xhr.status, body, token));
    };
    xhr.onerror = () => {
      done();
      reject(new ApiError("network", 0, ERROR_COPY.network));
    };
    xhr.onabort = () => {
      done();
      reject(new DOMException("The upload was cancelled.", "AbortError"));
    };
    if (signal) {
      if (signal.aborted) {
        reject(new DOMException("The upload was cancelled.", "AbortError"));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    xhr.send(form);
  });
}

/**
 * The file as a blob, with the owner's token (GET /api/chat/files/<uuid>/). `inline` asks for an image's real type
 * (thumbnails, the lightbox). 410 → ApiError(status 410, the expired text).
 */
export async function fetchChatFile(file: Pick<ChatFile, "id" | "url">, { inline = false, signal }: { inline?: boolean; signal?: AbortSignal } = {}): Promise<Blob> {
  const path = filePath(file, inline);
  if (path === null) throw new ApiError("not_found", 410, FILE_COPY.expired);
  const token = getToken();
  if (!token) throw new ApiError("unauthorized", 401, ERROR_COPY.unauthorized);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Token ${token}` }, credentials: "omit", signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError("network", 0, ERROR_COPY.network);
  }
  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    throw fileError(response.status, body, token);
  }
  return response.blob();
}

/** Hand a blob to the browser as a download named `name`. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Fetch a file and save it under its own name. */
export async function downloadChatFile(file: ChatFile): Promise<void> {
  saveBlob(await fetchChatFile(file), file.name);
}
