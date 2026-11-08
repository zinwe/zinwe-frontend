import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { ApiError, FILE_COPY, chipFailure, chipFor, chipView, isAbortError, uploadChatFile, type ChatFile, type ChipState, type ChipView } from "../../lib/api";
import { rememberSharingOff } from "./fileSharing";

export interface Attach {
  /** The picked file (the chip shows while there is one). */
  file: File | null;
  state: ChipState;
  view: ChipView | null;
  pick: (file: File) => void;
  remove: () => void;
  /**
   * Send with the file: upload it (once; a Retry after a failed post reuses the upload), then `post(fileId)`.
   * Resolves with what `post` returned, or undefined when it failed (the chip then says why) or was removed.
   */
  send: <T>(post: (fileId: string) => Promise<T>) => Promise<T | undefined>;
}

/**
 * The file waiting in a composer (v1.5): pick → chip (refused at once over 25 MB) → Send uploads it with progress
 * (the chip's thin orange bar), then posts the line with `file_id`. A failure leaves the chip with Retry.
 */
export function useAttach(): Attach {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<ChipState>({ status: "ready" });
  const uploaded = useRef<ChatFile | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  const stop = () => {
    ctrl.current?.abort();
    ctrl.current = null;
  };
  useEffect(() => stop, []);

  const pick = useCallback((next: File) => {
    stop();
    uploaded.current = null;
    setFile(next);
    setState(chipFor(next));
  }, []);

  const remove = useCallback(() => {
    stop();
    uploaded.current = null;
    setFile(null);
    setState({ status: "ready" });
  }, []);

  const send = async <T,>(post: (fileId: string) => Promise<T>): Promise<T | undefined> => {
    if (!file) return undefined;
    const c = new AbortController();
    ctrl.current = c;
    try {
      if (!uploaded.current) {
        setState({ status: "uploading", progress: 0 });
        uploaded.current = await uploadChatFile(file, {
          signal: c.signal,
          onProgress: (p) => {
            if (!c.signal.aborted) setState({ status: "uploading", progress: p });
          },
        });
      }
      if (c.signal.aborted) return undefined;
      setState({ status: "sending" });
      const result = await post(uploaded.current.id);
      if (ctrl.current === c) ctrl.current = null;
      uploaded.current = null;
      setFile(null);
      setState({ status: "ready" });
      return result;
    } catch (e) {
      if (isAbortError(e) || c.signal.aborted) return undefined;
      if (e instanceof ApiError) {
        // The upload went stale (over an hour, or already used): Retry uploads it again.
        if (e.fieldErrors.file_id) uploaded.current = null;
        if (e.status === 403 && e.message === FILE_COPY.off) rememberSharingOff();
      }
      setState(chipFailure(e instanceof ApiError ? { status: e.status, message: e.message } : null));
      return undefined;
    }
  };

  return { file, state, view: file ? chipView(state, file.size) : null, pick, remove, send };
}

/** A dragged file or a pasted picture, if there is one. */
function fileOfTransfer(dt: DataTransfer | null): File | null {
  if (!dt) return null;
  if (dt.files && dt.files.length) return dt.files[0];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === "file") {
      const f = item.getAsFile();
      if (f) return f;
    }
  }
  return null;
}

/** Drop a file onto the composer, or paste a picture into the message box (when sharing is on). */
export function dropProps(attach: Attach, on: boolean) {
  return {
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!on || !Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      if (!on) return;
      const f = fileOfTransfer(e.dataTransfer);
      if (!f) return;
      e.preventDefault();
      attach.pick(f);
    },
  };
}

export function pasteFile(attach: Attach, on: boolean) {
  return (e: ClipboardEvent<HTMLElement>) => {
    if (!on) return;
    const f = fileOfTransfer(e.clipboardData);
    // Only a real file: pasted text stays text.
    if (!f || !e.clipboardData.types.includes("Files")) return;
    e.preventDefault();
    attach.pick(f.name ? f : new File([f], `Pasted image.${(f.type.split("/")[1] ?? "png").replace("jpeg", "jpg")}`, { type: f.type }));
  };
}
