import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ApiError, bubbleOf, downloadChatFile, errorMessage, FILE_COPY, fetchChatFile, fileTypeOf, sizeLine, type ChatFile, type FileType } from "../../lib/api";
import { cx } from "../../lib/cx";
import { Linkified } from "../components/Linkified";
import type { Attach } from "./useAttach";
import "../../styles/dash13/chatfiles.css";

/**
 * v1.5 file sharing in chat (brief §3a), the owner dashboard's pieces, shared by every chat composer and thread
 * (Chat page desktop + phone, the floating chat windows, Team › Chat): the attach button, the file chip above the
 * message box, and the file bubble (image thumbnail + lightbox, file card, caption, "Kept until", expired, risky).
 * Files need the owner's token, so thumbnails and downloads are fetched as blobs (lib/api/chatFiles.ts).
 */

// ---- Icons (24 × 24, the chat's stroke style) ----

const PAGE = "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5";
const GLYPH: Record<FileType, string> = {
  pdf: `${PAGE}M8.5 13h7M8.5 16.5h4.5`,
  doc: `${PAGE}M8.5 12h7M8.5 15h7M8.5 18h4`,
  sheet: `${PAGE}M8 12h8v6H8zM8 15h8M12 12v6`,
  slide: `${PAGE}M8 12h8v5H8zM12 17v2`,
  zip: "M5 4h14v16H5zM12 4v2M12 8v2M12 12v2M10.5 15h3v3h-3z",
  image: "M4 5h16v14H4zM8.5 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M20 15l-5-5L5 19",
  video: "M4 6h12v12H4zM16 10l4-2.5v9L16 14",
  audio: "M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0M19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  other: PAGE,
};
const CLIP = "M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9";
const DOWN = "M12 4v11M7 10.5l5 5 5-5M5 20h14";
const WARN = "M12 3 2 20h20zM12 10v4.5M12 17.5v.5";

function Svg({ d, size = 18, stroke = 2 }: { d: string; size?: number; stroke?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function PaperclipIcon({ size = 18 }: { size?: number }): ReactElement {
  return <Svg d={CLIP} size={size} stroke={2} />;
}

function TypeIcon({ type, size = 36 }: { type: FileType; size?: number }): ReactElement {
  return (
    <span className="cf-ico" data-type={type} style={{ width: size, height: size }} aria-hidden="true">
      <Svg d={GLYPH[type]} size={Math.round(size * 0.55)} stroke={1.8} />
    </span>
  );
}

// ---- Sending: the attach button, the chip, drop and paste ----

/** The paperclip ("Attach a file") and its hidden file input. `className` takes the composer's own button look. */
export function AttachButton({ attach, className, size = 18, disabled = false }: { attach: Attach; className: string; size?: number; disabled?: boolean }): ReactElement {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className={className}
        aria-label={FILE_COPY.attach}
        title={FILE_COPY.attach}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault() /* phones: keep the keyboard as it is */}
        onClick={() => input.current?.click()}
      >
        <PaperclipIcon size={size} />
      </button>
      <input
        ref={input}
        type="file"
        hidden
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          if (f) attach.pick(f);
          // The same file can be picked again after ✕.
          e.currentTarget.value = "";
        }}
      />
    </>
  );
}

/** The file waiting above the message box: icon, name, size (or what went wrong), Retry, ✕, the upload bar. */
export function FileChip({ attach, onRetry }: { attach: Attach; onRetry: () => void }): ReactElement | null {
  const { file, view, state } = attach;
  if (!file || !view) return null;
  const type = fileTypeOf(file.name, file.type);
  return (
    <div className={cx("cf-chip", view.error && "is-error")} role="group" aria-label={`File: ${file.name}`}>
      <TypeIcon type={type} size={32} />
      <span className="cf-chip__text">
        <b className="cf-chip__name" title={file.name}>
          {file.name}
        </b>
        <small className="cf-chip__note" role={view.error ? "alert" : undefined}>
          {view.note}
        </small>
      </span>
      {view.retry ? (
        <button type="button" className="cf-chip__retry" onClick={onRetry}>
          Retry
        </button>
      ) : null}
      <button type="button" className="cf-chip__x" aria-label={`Remove ${file.name}`} title="Remove" disabled={state.status === "sending"} onClick={attach.remove}>
        ×
      </button>
      {view.bar !== null ? (
        <span className="cf-chip__track" role="progressbar" aria-label={`Sending ${file.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(view.bar * 100)}>
          <span className="cf-chip__bar" style={{ width: `${Math.round(view.bar * 100)}%` }} />
        </span>
      ) : null}
    </div>
  );
}

// ---- Receiving: the bubble ----

/** Object URLs for thumbnails, kept for the visit so a thread's refetch doesn't download them again. */
const thumbs = new Map<string, { url: string | null; promise: Promise<string> }>();
const THUMBS_MAX = 120;

function thumbOf(file: ChatFile): Promise<string> {
  const hit = thumbs.get(file.id);
  if (hit) return hit.promise;
  const entry: { url: string | null; promise: Promise<string> } = { url: null, promise: Promise.resolve("") };
  entry.promise = fetchChatFile(file, { inline: true }).then(
    (blob) => {
      entry.url = URL.createObjectURL(blob);
      return entry.url;
    },
    (e: unknown) => {
      // A failure isn't kept: the next look tries again.
      thumbs.delete(file.id);
      throw e;
    },
  );
  thumbs.set(file.id, entry);
  if (thumbs.size > THUMBS_MAX) {
    const [oldest, old] = thumbs.entries().next().value as [string, { url: string | null }];
    thumbs.delete(oldest);
    if (old.url) URL.revokeObjectURL(old.url);
  }
  return entry.promise;
}

/** The thumbnail's address once fetched (null while loading), and the error if it failed. */
function useThumb(file: ChatFile): { url: string | null; error: unknown } {
  const [got, setGot] = useState<{ id: string; url: string | null; error: unknown }>(() => ({ id: file.id, url: thumbs.get(file.id)?.url ?? null, error: null }));
  useEffect(() => {
    let alive = true;
    thumbOf(file).then(
      (url) => {
        if (alive) setGot({ id: file.id, url, error: null });
      },
      (error: unknown) => {
        if (alive) setGot({ id: file.id, url: null, error });
      },
    );
    return () => {
      alive = false;
    };
  }, [file]);
  return got.id === file.id ? got : { url: thumbs.get(file.id)?.url ?? null, error: null };
}

const gone = (e: unknown) => e instanceof ApiError && e.status === 410;

/** Download as a blob, saved under the file's name. A program file asks once more ("Download anyway"). */
function DownloadButton({ file, risky, onGone, label = "Download" }: { file: ChatFile; risky: boolean; onGone: () => void; label?: string }): ReactElement {
  const [step, setStep] = useState<"idle" | "confirm" | "busy">("idle");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (step !== "confirm") return;
    const id = window.setTimeout(() => setStep("idle"), 8000);
    return () => window.clearTimeout(id);
  }, [step]);
  const go = async () => {
    if (step === "busy") return;
    if (risky && step !== "confirm") {
      setStep("confirm");
      return;
    }
    setStep("busy");
    setError(null);
    try {
      await downloadChatFile(file);
      setStep("idle");
    } catch (e) {
      setStep("idle");
      if (gone(e)) onGone();
      else setError(errorMessage(e));
    }
  };
  return (
    <span className="cf-dl">
      <button type="button" className={cx("cf-dl__btn", step === "confirm" && "is-confirm")} onClick={() => void go()} disabled={step === "busy"} aria-label={step === "confirm" ? `Download ${file.name} anyway` : `${label} ${file.name}`}>
        <Svg d={DOWN} size={15} stroke={2.2} />
        <span>{step === "busy" ? "Downloading…" : step === "confirm" ? "Download anyway" : label}</span>
      </button>
      {error ? (
        <small className="cf-dl__err" role="alert">
          {error}
        </small>
      ) : null}
    </span>
  );
}

function Lightbox({ file, url, risky, onGone, onClose }: { file: ChatFile; url: string; risky: boolean; onGone: () => void; onClose: () => void }): ReactElement {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => before?.focus?.();
  }, []);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape") return;
    // Only the lightbox closes (not the chat window around the thread).
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };
  return createPortal(
    // Clicks stay in here: React would carry them to the bubble (the phone's tap-for-actions).
    <div className="cf-lb" role="dialog" aria-modal="true" aria-label={file.name} onKeyDown={onKey} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="cf-lb__scrim" tabIndex={-1} aria-label="Close" onClick={onClose} />
      <figure className="cf-lb__fig">
        <img src={url} alt={file.name} className="cf-lb__img" />
        <figcaption className="cf-lb__bar">
          <span className="cf-lb__name">
            <b title={file.name}>{file.name}</b>
            <small>{sizeLine(file)}</small>
          </span>
          <DownloadButton file={file} risky={risky} onGone={onGone} />
          <button ref={closeRef} type="button" className="cf-lb__x" aria-label="Close" title="Close" onClick={onClose}>
            ×
          </button>
        </figcaption>
      </figure>
    </div>,
    document.body,
  );
}

function ImageThumb({ file, risky, onGone, fallback }: { file: ChatFile; risky: boolean; onGone: () => void; fallback: ReactNode }): ReactElement {
  const { url, error } = useThumb(file);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (gone(error)) onGone();
  }, [error, onGone]);
  if (error) return <>{fallback}</>;
  if (!url) return <span className="cf-thumb is-loading" role="img" aria-label={`Loading ${file.name}`} />;
  return (
    <>
      <button type="button" className="cf-thumb" onClick={() => setOpen(true)} aria-label={`Open ${file.name}`} title={file.name}>
        <img src={url} alt={file.name} />
      </button>
      {open ? <Lightbox file={file} url={url} risky={risky} onGone={onGone} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/**
 * What a line with a file shows inside its bubble (same bubble colours as text lines): the thumbnail or the card,
 * the caption, a caution for a program file from someone else, and "Kept until 16 Nov" in small grey text; or the
 * grey "no longer available" card. Renders nothing for a line without a file (`file` null or missing).
 */
export function FileBubbleBody({
  file,
  mine,
  sender,
  renderCaption,
}: {
  file: ChatFile | null | undefined;
  /** You sent it: no caution, no second ask. */
  mine: boolean;
  /** The sender's first name (the caution names them). */
  sender: string;
  /** The caption as the thread shows text (links, @mentions). Default: links. */
  renderCaption?: (text: string) => ReactNode;
}): ReactElement | null {
  const [lost, setLost] = useState(false);
  const view = bubbleOf(file, { mine, sender });
  if (view.kind === "text") return null;
  const caption = view.caption ? <span className="cf-cap">{renderCaption ? renderCaption(view.caption) : <Linkified text={view.caption} />}</span> : null;
  if (view.kind === "expired" || lost) {
    return (
      <span className="cf-wrap">
        <span className="cf-card is-gone">
          <TypeIcon type={view.kind === "expired" ? "other" : view.type} size={36} />
          <span className="cf-card__gone">{FILE_COPY.expired}</span>
        </span>
        {caption}
      </span>
    );
  }
  const onGone = () => setLost(true);
  const card = (
    <span className="cf-card">
      <TypeIcon type={view.type} size={36} />
      <span className="cf-card__text">
        <b className="cf-card__name" title={view.file.name}>
          {view.file.name}
        </b>
        <small className="cf-card__meta">{view.sizeLine}</small>
      </span>
      <DownloadButton file={view.file} risky={!!view.risky} onGone={onGone} />
    </span>
  );
  return (
    <span className="cf-wrap">
      {view.kind === "image" ? <ImageThumb file={view.file} risky={!!view.risky} onGone={onGone} fallback={card} /> : card}
      {view.risky ? (
        <span className="cf-risky" role="note">
          <Svg d={WARN} size={14} stroke={2.2} />
          {view.risky}
        </span>
      ) : null}
      {caption}
      {view.kept ? <small className="cf-kept">{view.kept}</small> : null}
    </span>
  );
}
