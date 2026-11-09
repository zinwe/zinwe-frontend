import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import {
  ApiError,
  captionFor,
  checkPicks,
  FILE_COPY,
  isAbortError,
  kindOf,
  patchChatFile,
  registerChatFile,
  sendFailure,
  tileView,
  type FileKind,
  type PickNote,
  type TileStatus,
  type TileView,
} from "../../lib/api";
import { addHeld, askPersist, browserId, dropHeldFile, holdFile, newBatchId, NoRoom, opfsSupported, removeHeld, sha256Of } from "./fileHold";
import { makePreview, type LocalPreview } from "./filePreview";
import { fileMaxBytes, rememberSharingOff } from "./fileSharing";

/** One picked file in the send tray. */
export interface TrayItem {
  key: string;
  file: File;
  kind: FileKind;
  /** null while it is being made; then the tile's picture (or none: the type icon). */
  preview: LocalPreview | null;
  status: TileStatus;
  view: TileView;
  /** Registered (kept in this browser, the server has its record). */
  fileId: string | null;
  /** Its line was posted. */
  posted: boolean;
}

export interface Attach {
  items: TrayItem[];
  /** What a pick refused (too big, too many, no room), shown under the tray. */
  notes: PickNote[];
  /** Files wait to go. */
  has: boolean;
  /** Sending now: ✕, Add more and Send wait. */
  busy: boolean;
  /** A file can't go as it is (a refusal without Retry): remove it first. */
  blocksSend: boolean;
  /** A send failed and can be tried again. */
  canRetry: boolean;
  /** The plan's per-file limit. */
  maxBytes: number;
  add: (files: File[]) => void;
  remove: (key: string) => void;
  /**
   * Send every file: copy each into this browser and register it (same batch_id), then post one line per file
   * in order, the caption on the last. Resolves with what each `post` returned, or undefined when something failed
   * (its tile says why; Send again picks up where it stopped).
   */
  send: <T>(post: (fileId: string, caption: string, last: boolean, name: string) => Promise<T>, opts: { caption: string; chat: string }) => Promise<T[] | undefined>;
}

let seq = 0;

/**
 * The files waiting in a composer (v1.5 round 2, BRIEF2 §4): the attach menu adds up to 10, each with a preview;
 * Send keeps them in this browser (OPFS), registers them and posts their lines.
 */
export function useAttach(): Attach {
  const [items, setItems] = useState<TrayItem[]>([]);
  const [notes, setNotes] = useState<PickNote[]>([]);
  const [busy, setBusy] = useState(false);
  const live = useRef<TrayItem[]>([]);
  const batch = useRef<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const alive = useRef(true);
  /** Previews being made: Send waits for a file's preview so the server gets its picture. */
  const making = useRef(new Map<string, Promise<LocalPreview>>());
  useLayoutEffect(() => {
    live.current = items;
  }, [items]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      ctrl.current?.abort();
      live.current.forEach((it) => it.preview?.url && URL.revokeObjectURL(it.preview.url));
    };
  }, []);

  const patch = useCallback((key: string, change: Partial<Pick<TrayItem, "preview" | "status" | "fileId" | "posted">>) => {
    if (!alive.current) return;
    setItems((list) =>
      list.map((it) => {
        if (it.key !== key) return it;
        const next = { ...it, ...change };
        return { ...next, view: tileView(next.status, next.file.size) };
      }),
    );
  }, []);

  const add = useCallback(
    (files: File[]) => {
      if (!files.length) return;
      const max = fileMaxBytes();
      if (!opfsSupported()) {
        setNotes([{ name: "", text: FILE_COPY.noOpfs }]);
        return;
      }
      const { take, notes: refused } = checkPicks(files, live.current.length, max);
      setNotes(refused);
      const added: TrayItem[] = take.map((i) => {
        const file = files[i];
        const status: TileStatus = { s: "ready" };
        return { key: `f${++seq}`, file, kind: kindOf(file.name, file.type), preview: null, status, view: tileView(status, file.size), fileId: null, posted: false };
      });
      if (!added.length) return;
      setItems((list) => [...list, ...added]);
      for (const it of added) {
        const made = makePreview(it.file);
        making.current.set(it.key, made);
        void made.then((preview) => {
          making.current.delete(it.key);
          if (!alive.current || !live.current.some((x) => x.key === it.key)) {
            if (preview.url) URL.revokeObjectURL(preview.url);
            return;
          }
          patch(it.key, { preview });
        });
      }
    },
    [patch],
  );

  const remove = useCallback((key: string) => {
    const it = live.current.find((x) => x.key === key);
    if (!it) return;
    if (it.preview?.url) URL.revokeObjectURL(it.preview.url);
    // Registered but never posted: forget it here (the server drops unattached files itself).
    if (it.fileId && !it.posted) removeHeld(it.fileId);
    setItems((list) => list.filter((x) => x.key !== key));
    setNotes([]);
    if (live.current.length <= 1) batch.current = null;
  }, []);

  const send = async <T,>(post: (fileId: string, caption: string, last: boolean, name: string) => Promise<T>, { caption, chat }: { caption: string; chat: string }): Promise<T[] | undefined> => {
    const list = live.current.filter((it) => !it.posted);
    if (!list.length || busy) return undefined;
    if (!opfsSupported()) {
      setNotes([{ name: "", text: FILE_COPY.noOpfs }]);
      return undefined;
    }
    askPersist();
    const c = new AbortController();
    ctrl.current = c;
    setBusy(true);
    setNotes([]);
    // One batch for everything in the tray (a Retry after a partial send keeps it).
    const together = live.current.length > 1;
    if (together && !batch.current) batch.current = newBatchId();
    const batchId = together ? (batch.current ?? undefined) : undefined;
    const ids = new Map<string, string>(list.filter((it) => it.fileId).map((it) => [it.key, it.fileId as string]));
    let current: TrayItem | null = null;
    try {
      // 1. Keep each file in this browser and register it.
      for (const it of list) {
        current = it;
        if (ids.has(it.key)) continue;
        patch(it.key, { status: { s: "holding", progress: 0 } });
        const preview = it.preview ?? (await making.current.get(it.key)) ?? null;
        // The tile's % moves in whole steps (a big copy has thousands of chunks).
        let shown = 0;
        const ref = await holdFile(it.file, {
          signal: c.signal,
          onProgress: (p) => {
            const pct = Math.floor(p * 100);
            if (pct === shown) return;
            shown = pct;
            patch(it.key, { status: { s: "holding", progress: p } });
          },
        });
        patch(it.key, { status: { s: "registering" } });
        let made;
        try {
          made = await registerChatFile(
            {
              name: it.file.name,
              size: it.file.size,
              mime: it.file.type || "application/octet-stream",
              local_ref: ref,
              thumb_b64: preview?.b64,
              width: preview?.width,
              height: preview?.height,
              duration_s: preview?.duration_s,
              batch_id: batchId,
              browser_id: browserId(),
            },
            c.signal,
          );
        } catch (e) {
          // The server didn't take it: don't keep the copy.
          void dropHeldFile(ref);
          throw e;
        }
        addHeld({ id: made.id, ref, name: it.file.name, size: it.file.size, mime: it.file.type, kind: made.kind, at: Date.now(), chat });
        ids.set(it.key, made.id);
        patch(it.key, { fileId: made.id, status: { s: "registering" } });
        // The hash follows when it is ready (small files only).
        void sha256Of(it.file).then((sha) => {
          if (sha) void patchChatFile(made.id, { sha256: sha }).catch(() => undefined);
        });
      }
      // 2. Post the lines in order; the caption goes on the last.
      const results: T[] = [];
      for (let i = 0; i < list.length; i += 1) {
        const it = list[i];
        current = it;
        patch(it.key, { status: { s: "posting" } });
        results.push(await post(ids.get(it.key) as string, captionFor(i, list.length, caption), i === list.length - 1, it.file.name));
        patch(it.key, { posted: true, status: { s: "sent" } });
      }
      // Done: clear the tray.
      if (alive.current) {
        live.current.forEach((it) => it.preview?.url && URL.revokeObjectURL(it.preview.url));
        setItems([]);
      }
      batch.current = null;
      return results;
    } catch (e) {
      if (isAbortError(e) || c.signal.aborted) return undefined;
      if (e instanceof ApiError) {
        // The registration went stale (already used, or dropped): register it again on Retry.
        if (e.fieldErrors.file_id && current) {
          removeHeld(ids.get(current.key) ?? "");
          patch(current.key, { fileId: null });
        }
        if (e.status === 403 && e.message === FILE_COPY.off) rememberSharingOff();
      }
      const failed = sendFailure(e instanceof NoRoom ? { noRoom: true } : e instanceof ApiError ? { status: e.status, message: e.message } : null);
      if (current) patch(current.key, { status: failed });
      return undefined;
    } finally {
      if (ctrl.current === c) ctrl.current = null;
      if (alive.current) setBusy(false);
    }
  };

  const blocksSend = items.some((it) => it.status.s === "failed" && !it.status.retry);
  const canRetry = items.some((it) => it.status.s === "failed" && it.status.retry);
  return { items, notes, has: items.length > 0, busy, blocksSend, canRetry, maxBytes: fileMaxBytes(), add, remove, send };
}

/** Dragged files or a pasted picture. */
function filesOfTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  if (dt.files && dt.files.length) return Array.from(dt.files);
  const out: File[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === "file") {
      const f = item.getAsFile();
      if (f) out.push(f);
    }
  }
  return out;
}

/** Drop files onto the composer, or paste a picture into the message box (when sharing is on). */
export function dropProps(attach: Attach, on: boolean) {
  return {
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!on || attach.busy || !Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      if (!on || attach.busy) return;
      const files = filesOfTransfer(e.dataTransfer);
      if (!files.length) return;
      e.preventDefault();
      attach.add(files);
    },
  };
}

export function pasteFile(attach: Attach, on: boolean) {
  return (e: ClipboardEvent<HTMLElement>) => {
    if (!on || attach.busy) return;
    const files = filesOfTransfer(e.clipboardData);
    // Only a real file: pasted text stays text.
    if (!files.length || !e.clipboardData.types.includes("Files")) return;
    e.preventDefault();
    attach.add(files.map((f) => (f.name ? f : new File([f], `Pasted image.${(f.type.split("/")[1] ?? "png").replace("jpeg", "jpg")}`, { type: f.type }))));
  };
}
