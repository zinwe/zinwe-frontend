import { fitWithin, kindOf, THUMB_MAX_BYTES, THUMB_MAX_PX } from "../../lib/chatFileModel";

/**
 * v1.5 round 2 (BRIEF2 §4): the send tray's previews, made in the browser when files are picked. A photo is drawn
 * onto a canvas; a video gives a frame from a <video> element plus its length. The same small picture (≤ 320 px,
 * ≤ 40 KB, WebP or JPEG) goes to the server with the registration as the file's preview.
 */

export interface LocalPreview {
  /** An object URL for the tray tile (revoke it when the tile goes). */
  url: string | null;
  /** The preview picture as base64 (no data: prefix), for `thumb_b64`. */
  b64?: string;
  width?: number;
  height?: number;
  duration_s?: number;
}

/** Bigger photos are not decoded for a preview (memory on phones). */
const IMAGE_DECODE_MAX = 60 * 1024 * 1024;

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** The smallest good picture under 40 KB: WebP, else JPEG, lowering the quality (and then the size) until it fits. */
async function encode(source: CanvasImageSource, w: number, h: number): Promise<Blob | null> {
  let { w: tw, h: th } = fitWithin(w, h, THUMB_MAX_PX);
  for (let round = 0; round < 3 && tw > 0; round += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, tw, th);
    ctx.drawImage(source, 0, 0, tw, th);
    for (const q of [0.82, 0.66, 0.5, 0.36]) {
      let blob = await toBlob(canvas, "image/webp", q);
      // Safari gives a PNG for an unknown type: use JPEG there.
      if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", q);
      if (blob && blob.size <= THUMB_MAX_BYTES) return blob;
    }
    tw = Math.round(tw * 0.7);
    th = Math.round(th * 0.7);
  }
  return null;
}

async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function done(blob: Blob | null, extra: Omit<LocalPreview, "url" | "b64">): Promise<LocalPreview> {
  if (!blob) return { url: null, ...extra };
  return { url: URL.createObjectURL(blob), b64: await base64(blob), ...extra };
}

async function imagePreview(file: File): Promise<LocalPreview> {
  if (file.size > IMAGE_DECODE_MAX || typeof createImageBitmap !== "function") return { url: null };
  const bitmap = await createImageBitmap(file);
  try {
    return await done(await encode(bitmap, bitmap.width, bitmap.height), { width: bitmap.width, height: bitmap.height });
  } finally {
    bitmap.close();
  }
}

function once(el: HTMLElement, ok: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    el.addEventListener(ok, () => (clearTimeout(timer), resolve()), { once: true });
    el.addEventListener("error", () => (clearTimeout(timer), reject(new Error("error"))), { once: true });
  });
}

async function videoPreview(file: File): Promise<LocalPreview> {
  const src = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.src = src;
  try {
    await once(video, "loadedmetadata", 10_000);
    if (video.duration === Infinity) {
      // Recorded WebM (screen or camera recorders) has no length in its header: seeking far makes the browser
      // find it.
      try {
        video.currentTime = 1e9;
        await once(video, "seeked", 10_000);
      } catch {
        // Unknown length: no badge.
      }
    }
    const duration = Number.isFinite(video.duration) ? Math.round(video.duration) : undefined;
    const extra = { width: video.videoWidth || undefined, height: video.videoHeight || undefined, duration_s: duration };
    try {
      // A frame a little way in (the very first is often black).
      video.currentTime = Math.min(1, (video.duration || 0) * 0.1);
      await once(video, "seeked", 10_000);
      return await done(video.videoWidth ? await encode(video, video.videoWidth, video.videoHeight) : null, extra);
    } catch {
      return { url: null, ...extra };
    }
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(src);
  }
}

/** A picked file's preview (never throws: no preview = the tile shows the type icon). */
export async function makePreview(file: File): Promise<LocalPreview> {
  const kind = kindOf(file.name, file.type);
  try {
    if (kind === "image") return await imagePreview(file);
    if (kind === "video") return await videoPreview(file);
  } catch {
    // Not decodable here (HEIC on Chrome, an odd codec): the icon will do.
  }
  return { url: null };
}
