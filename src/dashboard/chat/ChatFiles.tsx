import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  ACCEPT,
  ApiError,
  bubbleOf,
  canSaveAs,
  dayText,
  durationText,
  dlView,
  errorMessage,
  FILE_COPY,
  fetchLegacyFile,
  fetchThumb,
  fileTypeOf,
  formatSize,
  getFileTicket,
  gridLayout,
  isAbortError,
  isLegacy,
  MAX_FILES,
  nativeDownload,
  percent,
  pickSaveTarget,
  RECHECK_MS,
  ringDash,
  saveBlob,
  SenderOffline,
  senderOnline,
  sizeLine,
  stopSharingFile,
  streamToFile,
  waitingText,
  type ChatFile,
  type DlState,
  type DlView,
  type FileTicket,
  type FileType,
} from "../../lib/api";
import { cx } from "../../lib/cx";
import { Linkified } from "../components/Linkified";
import { Modal } from "../components/Modal";
import { findHeld, heldBlob, opfsSupported, removeHeld, useHeld } from "./fileHold";
import type { Attach, TrayItem } from "./useAttach";
import "../../styles/dash13/chatfiles.css";

/**
 * v1.5 file sharing in chat, round 2 (BRIEF2 §4): files stay on the sender's device. The owner dashboard's pieces,
 * shared by every chat composer and thread (Chat page desktop + phone, the floating chat windows, Team › Chat):
 * - sending: the attach menu (Document · Photos & videos, up to 10) and the send tray with previews;
 * - receiving: photo/video tiles (thumbnails from thumb_url as auth blobs) and the batch grid, the lightbox (from the
 *   ticket's inline_url), PDFs in a new tab, document cards with Download ▾ (native download from the ticket's url;
 *   Save as… streams into a picked file on Chrome/Edge), the sender-offline wait, and "Not shared any more.";
 * - "Shared by me" (Stop sharing) for the files this browser keeps.
 * Round-1 files (a server copy with a `url`, dev only) still render and download as blobs.
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
const CHEV = "m6 9 6 6 6-6";
const LEFT = "m15 18-6-6 6-6";
const RIGHT = "m9 18 6-6-6-6";
const PLUS = "M12 5v14M5 12h14";

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

function PlayIcon(): ReactElement {
  return (
    <span className="cf-play" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
      </svg>
    </span>
  );
}

/** The simple spinner ring: a value 0…1 fills it; "spin" turns a short arc. */
export function Ring({ value, size = 28, label }: { value: number | "spin"; size?: number; label: string }): ReactElement {
  const r = (size - 4) / 2;
  const spin = value === "spin";
  const d = ringDash(spin ? 0.28 : value, r);
  return (
    <span
      className={cx("cf-ring", spin && "is-spin")}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={spin ? undefined : Math.round(value * 100)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="cf-ring__track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} />
        <circle
          className="cf-ring__bar"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={d.dasharray}
          strokeDashoffset={d.dashoffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
    </span>
  );
}

// ---- Sending: the attach menu, the send tray ----

/**
 * The paperclip ("Attach a file") and its menu: Document · Photos & videos, each a picker with multi-select.
 * `variant="tile"` is the tray's "Add more" tile. `className` takes the composer's own button look.
 */
export function AttachButton({
  attach,
  className,
  size = 18,
  disabled = false,
  variant = "icon",
}: {
  attach: Attach;
  className: string;
  size?: number;
  disabled?: boolean;
  variant?: "icon" | "tile";
}): ReactElement {
  const [open, setOpen] = useState(false);
  const doc = useRef<HTMLInputElement>(null);
  const media = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open]);
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const pick = (input: HTMLInputElement | null) => {
    close(false);
    input?.click();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    }
  };
  const input = (ref: typeof doc, accept: string) => (
    <input
      ref={ref}
      type="file"
      multiple
      accept={accept}
      hidden
      tabIndex={-1}
      aria-hidden="true"
      onChange={(e) => {
        const files = Array.from(e.currentTarget.files ?? []);
        if (files.length) attach.add(files);
        // The same files can be picked again after ✕.
        e.currentTarget.value = "";
      }}
    />
  );
  return (
    <span className={cx("cf-attach", variant === "tile" && "cf-attach--tile")}>
      <button
        ref={trigger}
        type="button"
        className={className}
        aria-label={variant === "tile" ? "Add more files" : FILE_COPY.attach}
        title={variant === "tile" ? "Add more" : FILE_COPY.attach}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled || attach.busy}
        onMouseDown={(e) => e.preventDefault() /* phones: keep the keyboard as it is */}
        onClick={() => setOpen((o) => !o)}
      >
        {variant === "tile" ? (
          <>
            <span className="cf-tile__pic cf-tile__pic--add">
              <Svg d={PLUS} size={20} />
            </span>
            <span className="cf-tile__name">Add more</span>
          </>
        ) : (
          <PaperclipIcon size={size} />
        )}
      </button>
      {open ? (
        <>
          <button type="button" tabIndex={-1} aria-label="Close menu" className="cf-scrim" onClick={() => close()} />
          <div ref={menu} className="cf-amenu" role="menu" aria-label={FILE_COPY.attach} onKeyDown={onKey}>
            <button type="button" role="menuitem" onClick={() => pick(doc.current)}>
              <TypeIcon type="doc" size={30} />
              {FILE_COPY.document}
            </button>
            <button type="button" role="menuitem" onClick={() => pick(media.current)}>
              <TypeIcon type="image" size={30} />
              {FILE_COPY.media}
            </button>
          </div>
        </>
      ) : null}
      {input(doc, ACCEPT.document)}
      {input(media, ACCEPT.media)}
    </span>
  );
}

function TrayTile({ it, attach }: { it: TrayItem; attach: Attach }): ReactElement {
  const type = fileTypeOf(it.file.name, it.file.type);
  const dur = it.kind === "video" ? durationText(it.preview?.duration_s) : "";
  return (
    <div className={cx("cf-tile", it.view.error && "is-error", it.status.s === "sent" && "is-sent")} title={it.view.error ? `${it.file.name}: ${it.view.note}` : it.file.name}>
      <span className="cf-tile__pic">
        {it.preview?.url ? <img src={it.preview.url} alt="" /> : <TypeIcon type={type} size={34} />}
        {it.kind === "video" && it.preview?.url ? <PlayIcon /> : null}
        {dur ? <span className="cf-badge">{dur}</span> : null}
        {it.view.ring !== null ? (
          <span className="cf-tile__ring">
            <Ring value={it.view.ring} size={30} label={`Sending ${it.file.name}`} />
          </span>
        ) : null}
      </span>
      <span className="cf-tile__name">{it.file.name}</span>
      <small className="cf-tile__note" role={it.view.error ? "alert" : undefined}>
        {it.view.note}
      </small>
      {!attach.busy && !it.posted ? (
        <button type="button" className="cf-tile__x" aria-label={`Remove ${it.file.name}`} title="Remove" onClick={() => attach.remove(it.key)}>
          ×
        </button>
      ) : null}
    </div>
  );
}

/** The files waiting above the message box: tiles with previews, ✕ each, "Add more", and what a pick refused. */
export function SendTray({ attach, onRetry }: { attach: Attach; onRetry: () => void }): ReactElement | null {
  if (!attach.items.length && !attach.notes.length) return null;
  return (
    <div className="cf-tray" role="group" aria-label="Files to send">
      {attach.items.length ? (
        <div className="cf-tray__row">
          {attach.items.map((it) => (
            <TrayTile key={it.key} it={it} attach={attach} />
          ))}
          {attach.items.length < MAX_FILES && !attach.busy ? <AttachButton attach={attach} className="cf-tile cf-tile--add" variant="tile" /> : null}
        </div>
      ) : null}
      {attach.canRetry && !attach.busy ? (
        <p className="cf-tray__note is-error">
          <span>{FILE_COPY.failed}</span>
          <button type="button" className="cf-tray__retry" onClick={onRetry}>
            Retry
          </button>
        </p>
      ) : null}
      {attach.notes.map((n, i) => (
        <p key={`${n.name}-${i}`} className="cf-tray__note is-error" role="alert">
          {n.name ? <b>{n.name}</b> : null}
          <span>{n.text}</span>
        </p>
      ))}
    </div>
  );
}

// ---- Thumbnails (auth blobs, kept for the visit) ----

const thumbs = new Map<string, { url: string | null; promise: Promise<string> }>();
const THUMBS_MAX = 160;

function thumbSource(file: ChatFile): (() => Promise<Blob>) | null {
  if (isLegacy(file)) return file.kind === "image" ? () => fetchLegacyFile(file, { inline: true }) : null;
  return file.thumb_url ? () => fetchThumb(file.thumb_url as string) : null;
}

function thumbOf(file: ChatFile, load: () => Promise<Blob>): Promise<string> {
  const hit = thumbs.get(file.id);
  if (hit) return hit.promise;
  const entry: { url: string | null; promise: Promise<string> } = { url: null, promise: Promise.resolve("") };
  entry.promise = load().then(
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

/** The thumbnail's address once fetched (null while loading or when there is none), and the error if it failed. */
function useThumb(file: ChatFile): { url: string | null; error: unknown; none: boolean } {
  const load = file.available ? thumbSource(file) : null;
  const [got, setGot] = useState<{ id: string; url: string | null; error: unknown }>(() => ({ id: file.id, url: thumbs.get(file.id)?.url ?? null, error: null }));
  const has = !!load;
  useEffect(() => {
    if (!has) return;
    const source = thumbSource(file);
    if (!source) return;
    let alive = true;
    thumbOf(file, source).then(
      (url) => alive && setGot({ id: file.id, url, error: null }),
      (error: unknown) => alive && setGot({ id: file.id, url: null, error }),
    );
    return () => {
      alive = false;
    };
  }, [file, has]);
  const now = got.id === file.id ? got : { url: thumbs.get(file.id)?.url ?? null, error: null };
  return { ...now, none: !has };
}

const isGone = (e: unknown) => e instanceof ApiError && e.status === 410;

// ---- Downloading ----

type Pending = { kind: "native" } | { kind: "save"; target: NonNullable<Awaited<ReturnType<typeof pickSaveTarget>>> } | null;

interface Download {
  state: DlState;
  view: DlView;
  download: () => Promise<void>;
  saveAs: () => Promise<void>;
  /** A PDF in a new tab (from inline_url). */
  openTab: () => void;
  cancel: () => void;
  /** Save as… is offered (Chrome / Edge, a round-2 file). */
  saveAsOk: boolean;
}

/**
 * Download a file (BRIEF2 §4): a ticket, then "is the sender there?" (status_url). Online → the browser downloads
 * natively from the ticket's url (its own progress, its own place to save). Offline → "Waiting for Priya's PC…",
 * Download off, and a re-check every 30 s that then carries on by itself. Save as… streams into a picked file with
 * our ring and %. A program file asks once more. A file this browser keeps is saved straight from here.
 */
function useDownload(file: ChatFile, first: string, risky: boolean, onGone: () => void): Download {
  const [state, setState] = useState<DlState>({ s: "idle" });
  const pending = useRef<Pending>(null);
  const ctrl = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      ctrl.current?.abort();
    };
  }, []);
  const put = useCallback((next: DlState) => {
    if (alive.current) setState(next);
  }, []);

  // A program file's second ask goes back after a while.
  useEffect(() => {
    if (state.s !== "confirm") return;
    const id = window.setTimeout(() => put({ s: "idle" }), 8000);
    return () => window.clearTimeout(id);
  }, [state.s, put]);

  const fail = useCallback(
    (e: unknown) => {
      if (isAbortError(e) || ctrl.current?.signal.aborted) {
        pending.current = null;
        put({ s: "idle" });
      } else if (e instanceof SenderOffline) put({ s: "waiting" });
      else if (isGone(e)) {
        pending.current = null;
        put({ s: "gone" });
        onGone();
      } else {
        pending.current = null;
        put({ s: "error", message: errorMessage(e) });
      }
    },
    [onGone, put],
  );

  const go = useCallback(
    async (ticket: FileTicket, p: Pending) => {
      pending.current = null;
      if (!p) {
        put({ s: "idle" });
        return;
      }
      if (p.kind === "native") {
        nativeDownload(ticket.url, file.name);
        put({ s: "idle" });
        return;
      }
      const c = new AbortController();
      ctrl.current = c;
      put({ s: "saving", progress: 0 });
      let shown = 0;
      try {
        await streamToFile(ticket.url, p.target, file.size, {
          signal: c.signal,
          onProgress: (v) => {
            const pct = Math.floor(v * 100);
            if (pct !== shown) {
              shown = pct;
              put({ s: "saving", progress: v });
            }
          },
        });
        put({ s: "idle" });
      } catch (e) {
        // Offline mid-way: keep the picked file and carry on when they're back.
        if (e instanceof SenderOffline) pending.current = p;
        fail(e);
      } finally {
        if (ctrl.current === c) ctrl.current = null;
      }
    },
    [fail, file.name, file.size, put],
  );

  const run = useCallback(
    async (p: Pending) => {
      pending.current = p;
      put({ s: "checking" });
      try {
        const ticket = await getFileTicket(file.id);
        if (!(await senderOnline(ticket))) {
          put({ s: "waiting" });
          return;
        }
        await go(ticket, p);
      } catch (e) {
        fail(e);
      }
    },
    [fail, file.id, go, put],
  );

  // While the sender is offline: ask again every 30 s; once they're back, carry on (or just enable Download).
  useEffect(() => {
    if (state.s !== "waiting") return;
    const id = window.setInterval(async () => {
      try {
        const ticket = await getFileTicket(file.id);
        if (await senderOnline(ticket)) await go(ticket, pending.current);
      } catch (e) {
        fail(e);
      }
    }, RECHECK_MS);
    return () => window.clearInterval(id);
  }, [state.s, file.id, go, fail]);

  const asked = () => {
    if (risky && state.s !== "confirm") {
      put({ s: "confirm" });
      return false;
    }
    return true;
  };

  const download = async () => {
    if (state.s === "checking" || state.s === "saving" || !asked()) return;
    if (isLegacy(file)) {
      put({ s: "checking" });
      try {
        saveBlob(await fetchLegacyFile(file), file.name);
        put({ s: "idle" });
      } catch (e) {
        fail(e);
      }
      return;
    }
    const held = findHeld(file.id);
    const local = held ? await heldBlob(held.ref) : null;
    if (local) {
      saveBlob(local, file.name);
      put({ s: "idle" });
      return;
    }
    await run({ kind: "native" });
  };

  const saveAs = async () => {
    if (state.s === "checking" || state.s === "saving" || !asked()) return;
    let target;
    try {
      target = await pickSaveTarget(file.name);
    } catch (e) {
      fail(e);
      return;
    }
    if (!target) return;
    const held = findHeld(file.id);
    const local = held ? await heldBlob(held.ref) : null;
    if (local) {
      put({ s: "saving", progress: null });
      try {
        await local.stream().pipeTo(await target.createWritable());
        put({ s: "idle" });
      } catch (e) {
        fail(e);
      }
      return;
    }
    await run({ kind: "save", target });
  };

  const openTab = () => {
    if (state.s === "checking" || state.s === "saving") return;
    // The tab opens inside the click (no pop-up block), then goes to the file once the ticket is here.
    const win = window.open("", "_blank");
    const goTo = (url: string) => {
      if (win && !win.closed) win.location.href = url;
      else window.open(url, "_blank", "noopener");
    };
    void (async () => {
      put({ s: "checking" });
      try {
        const held = findHeld(file.id);
        const local = held ? await heldBlob(held.ref) : null;
        if (local) {
          goTo(URL.createObjectURL(local));
          put({ s: "idle" });
          return;
        }
        const ticket = await getFileTicket(file.id);
        if (!(await senderOnline(ticket))) {
          win?.close();
          pending.current = null;
          put({ s: "waiting" });
          return;
        }
        goTo(ticket.inline_url);
        put({ s: "idle" });
      } catch (e) {
        win?.close();
        fail(e);
      }
    })();
  };

  const cancel = () => {
    ctrl.current?.abort();
    pending.current = null;
    put({ s: "idle" });
  };

  return { state, view: dlView(state, first), download, saveAs, openTab, cancel, saveAsOk: canSaveAs() && !isLegacy(file) };
}

/** Download ▾ (Save as…), or the ring with % and ✕ while saving. */
function DownloadControl({ dl, file, tone = "card" }: { dl: Download; file: ChatFile; tone?: "card" | "bar" }): ReactElement {
  const [menu, setMenu] = useState(false);
  const v = dl.view;
  const moreRef = useRef<HTMLButtonElement>(null);
  if (v.ring !== null) {
    const saving = dl.state.s === "saving" && typeof v.ring === "number";
    return (
      <span className={cx("cf-dl", `cf-dl--${tone}`)}>
        <span className="cf-dl__busy">
          <Ring value={v.ring} size={24} label={saving ? `Saving ${file.name}` : `Getting ${file.name} ready`} />
          {saving ? <b className="cf-dl__pct">{percent(v.ring as number)}</b> : null}
          {v.cancel ? (
            <button type="button" className="cf-dl__cancel" aria-label={`Stop saving ${file.name}`} title="Stop" onClick={dl.cancel}>
              ×
            </button>
          ) : null}
        </span>
      </span>
    );
  }
  const confirm = dl.state.s === "confirm";
  return (
    <span className={cx("cf-dl", `cf-dl--${tone}`)}>
      <span className={cx("cf-split", dl.saveAsOk && "has-more")}>
        <button
          type="button"
          className={cx("cf-dl__btn", confirm && "is-confirm")}
          onClick={() => void dl.download()}
          disabled={v.disabled}
          title={dl.saveAsOk ? undefined : FILE_COPY.webHint}
          aria-label={confirm ? `Download ${file.name} anyway` : `Download ${file.name}`}
        >
          <Svg d={DOWN} size={15} stroke={2.2} />
          <span>{v.label}</span>
        </button>
        {dl.saveAsOk ? (
          <button
            ref={moreRef}
            type="button"
            className="cf-dl__more"
            aria-label={`More ways to download ${file.name}`}
            aria-haspopup="menu"
            aria-expanded={menu}
            disabled={v.disabled}
            onClick={() => setMenu((m) => !m)}
          >
            <Svg d={CHEV} size={14} stroke={2.4} />
          </button>
        ) : null}
      </span>
      {menu ? (
        <>
          <button type="button" tabIndex={-1} aria-label="Close menu" className="cf-scrim" onClick={() => setMenu(false)} />
          <div
            className="cf-dlmenu"
            role="menu"
            aria-label={`Download ${file.name}`}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              e.stopPropagation();
              setMenu(false);
              moreRef.current?.focus();
            }}
          >
            <button
              type="button"
              role="menuitem"
              autoFocus
              onClick={() => {
                setMenu(false);
                void dl.saveAs();
              }}
            >
              <Svg d={DOWN} size={15} stroke={2.2} />
              {FILE_COPY.saveAs}
            </button>
            <p className="cf-dlmenu__hint">{FILE_COPY.webHint}</p>
          </div>
        </>
      ) : null}
    </span>
  );
}

/** The line under a file while it waits or failed ("Waiting for Priya's PC…"). */
function DlNote({ view }: { view: DlView }): ReactElement | null {
  if (!view.note) return null;
  return (
    <small className={cx("cf-dlnote", view.noteKind === "wait" ? "is-wait" : "is-error")} role={view.noteKind === "error" ? "alert" : "status"}>
      {view.noteKind === "wait" ? <i className="cf-pulse" aria-hidden="true" /> : null}
      {view.note}
    </small>
  );
}

// ---- The lightbox (photos, videos) ----

type Source = { s: "loading" } | { s: "waiting" } | { s: "ready"; url: string; revoke: boolean } | { s: "gone" } | { s: "error"; message: string };

/** Where the lightbox shows the file from: the ticket's inline_url (online sender), this browser's copy, or round 1's blob. */
function useInlineSource(file: ChatFile, onGone: () => void): { source: Source; broken: () => void } {
  const [source, setSource] = useState<Source>({ s: "loading" });
  const [round, setRound] = useState(0);
  const [failedAt, setFailedAt] = useState(0);
  // The picture/video didn't load from the relay: the sender went away (wait, then try again), or it can't play here.
  useEffect(() => {
    if (!failedAt) return;
    let alive = true;
    let timer = 0;
    void (async () => {
      try {
        const ticket = await getFileTicket(file.id, { fresh: true });
        if (!alive) return;
        if (await senderOnline(ticket)) setSource({ s: "error", message: CANT_SHOW });
        else {
          setSource({ s: "waiting" });
          timer = window.setTimeout(() => alive && setRound((r) => r + 1), RECHECK_MS);
        }
      } catch (e) {
        if (alive) setSource(isGone(e) ? { s: "gone" } : { s: "error", message: errorMessage(e) });
      }
    })();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [failedAt, file.id]);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    let timer = 0;
    const set = (next: Source) => alive && setSource(next);
    const tryTicket = async () => {
      try {
        const ticket = await getFileTicket(file.id);
        if (await senderOnline(ticket)) set({ s: "ready", url: ticket.inline_url, revoke: false });
        else {
          set({ s: "waiting" });
          timer = window.setTimeout(() => void tryTicket(), RECHECK_MS);
        }
      } catch (e) {
        if (isGone(e)) {
          set({ s: "gone" });
          onGone();
        } else set({ s: "error", message: errorMessage(e) });
      }
    };
    void (async () => {
      if (!file.available) {
        set({ s: "gone" });
        return;
      }
      try {
        if (isLegacy(file)) {
          made = URL.createObjectURL(await fetchLegacyFile(file, { inline: true }));
          set({ s: "ready", url: made, revoke: true });
          return;
        }
        const held = findHeld(file.id);
        const local = held ? await heldBlob(held.ref) : null;
        if (local) {
          made = URL.createObjectURL(local);
          set({ s: "ready", url: made, revoke: true });
          return;
        }
      } catch (e) {
        set(isGone(e) ? { s: "gone" } : { s: "error", message: errorMessage(e) });
        return;
      }
      await tryTicket();
    })();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      if (made) URL.revokeObjectURL(made);
    };
  }, [file, onGone, round]);
  return { source, broken: () => setFailedAt(Date.now()) };
}

const CANT_SHOW = "This file can't be shown here. Download it instead.";

function LightboxBody({ file, first, onGone }: { file: ChatFile; first: string; onGone: () => void }): ReactElement {
  const { source, broken } = useInlineSource(file, onGone);
  const [loaded, setLoaded] = useState(false);
  const thumb = useThumb(file);
  if (source.s === "ready") {
    return (
      <span className="cf-lb__stage">
        {file.kind === "video" ? (
          <video className="cf-lb__img" src={source.url} controls playsInline preload="metadata" onLoadedData={() => setLoaded(true)} onError={broken} aria-label={file.name} />
        ) : (
          <img src={source.url} alt={file.name} className="cf-lb__img" onLoad={() => setLoaded(true)} onError={broken} />
        )}
        {!loaded ? (
          <span className="cf-lb__center">
            <Ring value="spin" size={40} label={`Loading ${file.name}`} />
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span className="cf-lb__stage is-empty">
      {thumb.url ? <img src={thumb.url} alt="" className="cf-lb__img cf-lb__img--dim" /> : null}
      <span className="cf-lb__center">
        {source.s === "loading" ? <Ring value="spin" size={40} label={`Loading ${file.name}`} /> : null}
        {source.s === "waiting" ? (
          <span className="cf-lb__msg">
            <i className="cf-pulse" aria-hidden="true" />
            {waitingText(first)}
          </span>
        ) : null}
        {source.s === "gone" ? <span className="cf-lb__msg">{FILE_COPY.notShared}</span> : null}
        {source.s === "error" ? (
          <span className="cf-lb__msg" role="alert">
            {source.message}
          </span>
        ) : null}
      </span>
    </span>
  );
}

function LightboxBar({ file, first, onGone, closeRef, onClose }: { file: ChatFile; first: string; onGone: () => void; closeRef: RefObject<HTMLButtonElement | null>; onClose: () => void }): ReactElement {
  const dl = useDownload(file, first, false, onGone);
  return (
    <figcaption className="cf-lb__bar">
      <span className="cf-lb__name">
        <b title={file.name}>{file.name}</b>
        <small>{sizeLine(file)}</small>
        <DlNote view={dl.view} />
      </span>
      {file.available ? <DownloadControl dl={dl} file={file} tone="bar" /> : null}
      <button ref={closeRef} type="button" className="cf-lb__x" aria-label="Close" title="Close" onClick={onClose}>
        ×
      </button>
    </figcaption>
  );
}

function Lightbox({ files, start, first, onGone, onClose }: { files: ChatFile[]; start: number; first: string; onGone: () => void; onClose: () => void }): ReactElement {
  const [at, setAt] = useState(start);
  const closeRef = useRef<HTMLButtonElement>(null);
  const file = files[Math.min(at, files.length - 1)];
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => before?.focus?.();
  }, []);
  const many = files.length > 1;
  const step = (d: number) => setAt((i) => (i + d + files.length) % files.length);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      // Only the lightbox closes (not the chat window around the thread).
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (many && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !(e.target instanceof HTMLVideoElement)) {
      e.preventDefault();
      step(e.key === "ArrowLeft" ? -1 : 1);
    }
  };
  const who = file.sender?.first_name || first;
  return createPortal(
    // Clicks stay in here: React would carry them to the bubble (the phone's tap-for-actions).
    <div className="cf-lb" role="dialog" aria-modal="true" aria-label={file.name} onKeyDown={onKey} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="cf-lb__scrim" tabIndex={-1} aria-label="Close" onClick={onClose} />
      <figure className="cf-lb__fig">
        <LightboxBody key={file.id} file={file} first={who} onGone={onGone} />
        {many ? (
          <>
            <button type="button" className="cf-lb__nav is-prev" aria-label="Previous" onClick={() => step(-1)}>
              <Svg d={LEFT} size={20} stroke={2.4} />
            </button>
            <button type="button" className="cf-lb__nav is-next" aria-label="Next" onClick={() => step(1)}>
              <Svg d={RIGHT} size={20} stroke={2.4} />
            </button>
            <span className="cf-lb__count">
              {at + 1} / {files.length}
            </span>
          </>
        ) : null}
        <LightboxBar key={`bar-${file.id}`} file={file} first={who} onGone={onGone} closeRef={closeRef} onClose={onClose} />
      </figure>
    </div>,
    document.body,
  );
}

// ---- Receiving: tiles, the grid, the card ----

function MediaTile({ file, onOpen, wide = false, more = 0, single = false }: { file: ChatFile; onOpen: () => void; wide?: boolean; more?: number; single?: boolean }): ReactElement {
  const { url } = useThumb(file);
  const dur = file.kind === "video" ? durationText(file.duration_s) : "";
  const ratio = single && file.width && file.height ? `${file.width} / ${file.height}` : undefined;
  return (
    <button
      type="button"
      className={cx("cf-media", single && "is-single", wide && "is-wide", !url && "is-loading", !file.available && "is-gone")}
      style={ratio ? { aspectRatio: ratio } : undefined}
      onClick={onOpen}
      aria-label={`Open ${file.name}${more ? ` and ${more - 1} more` : ""}`}
      title={file.name}
    >
      {url ? <img src={url} alt="" /> : <TypeIcon type={file.kind === "video" ? "video" : "image"} size={34} />}
      {file.kind === "video" && file.available ? <PlayIcon /> : null}
      {dur ? <span className="cf-badge">{dur}</span> : null}
      {more ? <span className="cf-more">+{more}</span> : null}
    </button>
  );
}

function DocCard({ file, view, first, risky, onGone }: { file: ChatFile; view: { sizeLine: string; type: FileType; preview: "lightbox" | "tab" | null }; first: string; risky: boolean; onGone: () => void }): ReactElement {
  const dl = useDownload(file, first, risky, onGone);
  const [open, setOpen] = useState(false);
  const openIt = view.preview === "tab" ? dl.openTab : view.preview === "lightbox" ? () => setOpen(true) : null;
  return (
    <span className="cf-card">
      {openIt ? (
        <button type="button" className="cf-card__open" onClick={openIt} aria-label={`Open ${file.name}`} title={`Open ${file.name}`}>
          <TypeIcon type={view.type} size={36} />
        </button>
      ) : (
        <TypeIcon type={view.type} size={36} />
      )}
      <span className="cf-card__text">
        {openIt ? (
          <button type="button" className="cf-card__name is-link" title={file.name} onClick={openIt} tabIndex={-1}>
            {file.name}
          </button>
        ) : (
          <b className="cf-card__name" title={file.name}>
            {file.name}
          </b>
        )}
        <small className="cf-card__meta">{view.sizeLine}</small>
        <DlNote view={dl.view} />
      </span>
      <DownloadControl dl={dl} file={file} />
      {open ? <Lightbox files={[file]} start={0} first={first} onGone={onGone} onClose={() => setOpen(false)} /> : null}
    </span>
  );
}

function GoneCard({ type }: { type: FileType }): ReactElement {
  return (
    <span className="cf-card is-gone">
      <TypeIcon type={type} size={36} />
      <span className="cf-card__gone">{FILE_COPY.notShared}</span>
    </span>
  );
}

function BatchGrid({ files, first }: { files: ChatFile[]; first: string }): ReactElement {
  const [open, setOpen] = useState<number | null>(null);
  const cells = gridLayout(files.length);
  const noop = useCallback(() => undefined, []);
  return (
    <>
      <span className={cx("cf-grid", `cf-grid--${Math.min(files.length, 4)}`)} role="group" aria-label={`${files.length} photos and videos`}>
        {cells.map((c) => (
          <MediaTile key={files[c.index].id} file={files[c.index]} wide={c.wide} more={c.more} onOpen={() => setOpen(c.index)} />
        ))}
      </span>
      {open !== null ? <Lightbox files={files} start={open} first={first} onGone={noop} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

/**
 * What a line with a file shows inside its bubble (same bubble colours as text lines): a photo/video tile, a batch
 * grid (`batch`: the run's files, this line being its last), or a card with Download ▾; then a caution for a program
 * file from someone else, the caption, and "Kept in this browser…" under your own file kept here. A stopped, gone or
 * too-old file is the grey "Not shared any more." card. Renders nothing for a line without a file.
 */
export function FileBubbleBody({
  file,
  mine,
  sender,
  renderCaption,
  batch,
}: {
  file: ChatFile | null | undefined;
  /** You sent it: no caution, no second ask. */
  mine: boolean;
  /** The sender's first name (the caution and the wait name them). */
  sender: string;
  /** The caption as the thread shows text (links, @mentions). Default: links. */
  renderCaption?: (text: string) => ReactNode;
  /** Photos and videos sent together (this line is the last of them). */
  batch?: ChatFile[] | null;
}): ReactElement | null {
  const [lost, setLost] = useState(false);
  const onGone = useCallback(() => setLost(true), []);
  const [open, setOpen] = useState(false);
  const held = useHeld();
  const heldHere = !!file && held.some((h) => h.id === file.id);
  const view = bubbleOf(file, { mine, sender, heldHere });
  if (view.kind === "text" || !file) return null;
  const first = file.sender?.first_name || sender;
  const caption = file.caption ? <span className="cf-cap">{renderCaption ? renderCaption(file.caption) : <Linkified text={file.caption} />}</span> : null;

  if (batch && batch.length > 1) {
    const own = (file.mine ?? mine) && batch.some((f) => held.some((h) => h.id === f.id));
    return (
      <span className="cf-wrap">
        <BatchGrid files={batch} first={first} />
        {caption}
        {own ? <small className="cf-own">{FILE_COPY.ownBrowser}</small> : null}
      </span>
    );
  }
  if (view.kind === "gone" || lost) {
    return (
      <span className="cf-wrap">
        <GoneCard type={view.type} />
        {caption}
      </span>
    );
  }
  return (
    <span className="cf-wrap">
      {view.kind === "media" ? (
        <>
          <MediaTile file={file} single onOpen={() => setOpen(true)} />
          {open ? <Lightbox files={[file]} start={0} first={first} onGone={onGone} onClose={() => setOpen(false)} /> : null}
        </>
      ) : (
        <DocCard file={file} view={view} first={first} risky={!!view.risky} onGone={onGone} />
      )}
      {view.risky ? (
        <span className="cf-risky" role="note">
          <Svg d={WARN} size={14} stroke={2.2} />
          {view.risky}
        </span>
      ) : null}
      {caption}
      {view.own ? <small className="cf-own">{view.own}</small> : null}
    </span>
  );
}

// ---- Shared by me ----

/** The files this browser keeps for others, with Stop sharing (chat ⋮ › Shared by me). */
export function SharedByMeDialog({ onClose }: { onClose: () => void }): ReactElement {
  const held = useHeld();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stop = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await stopSharingFile(id);
    } catch (e) {
      // Already stopped or gone on the server: forget it here too.
      if (!(e instanceof ApiError && (e.status === 404 || e.status === 410))) {
        setError(errorMessage(e));
        setBusy(null);
        return;
      }
    }
    removeHeld(id);
    setBusy(null);
  };
  return (
    <Modal open onClose={onClose} title="Shared by me" size="sm">
      <div className="cf-shared">
        <p className="cf-shared__lead">{opfsSupported() ? FILE_COPY.ownBrowser : FILE_COPY.noOpfs}</p>
        {held.length === 0 ? (
          <p className="cf-shared__empty">Nothing shared from this browser.</p>
        ) : (
          <ul className="cf-shared__list">
            {held.map((h) => (
              <li key={h.id} className="cf-shared__row">
                <TypeIcon type={fileTypeOf(h.name, h.mime)} size={34} />
                <span className="cf-shared__text">
                  <b title={h.name}>{h.name}</b>
                  <small>{[h.chat, dayText(h.at), formatSize(h.size)].filter(Boolean).join(" · ")}</small>
                </span>
                <button type="button" className="z-btn sm" disabled={busy === h.id} onClick={() => void stop(h.id)} aria-label={`${FILE_COPY.stop}: ${h.name}`}>
                  {busy === h.id ? "Stopping…" : FILE_COPY.stop}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error ? (
          <p role="alert" className="cv-set__err">
            {error}
          </p>
        ) : null}
        <div className="dash-confirm__actions">
          <button type="button" className="z-btn pri" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
