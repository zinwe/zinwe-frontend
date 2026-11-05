/**
 * FR-44 picture state for the dashboard: the latest picture per member (shared by every avatar on the page), the
 * optimistic saver the pickers use, and the initials fallback.
 */
import { useState, useSyncExternalStore } from "react";
import {
  knownPicture,
  pictureErrorMessage,
  picturesStamp,
  rememberPicture,
  removeMemberPicture,
  setMemberAvatar,
  subscribePictures,
  uploadMemberPhoto,
  type MemberPicture,
} from "../../lib/api";
import { shrinkPhoto } from "./photo";

/** Shown under the picker (owner ask: say plainly who sees it). */
export const PICTURE_PRIVACY = "Only shown inside your Zinwe account.";

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
}

/** The latest picture for a member: what was set on this page wins over an older payload. */
export function useMemberPicture(memberId: number | null | undefined, fromPayload: MemberPicture | null | undefined): MemberPicture | null {
  useSyncExternalStore(subscribePictures, picturesStamp, picturesStamp);
  const live = knownPicture(memberId);
  return live !== undefined ? live : (fromPayload ?? null);
}

/**
 * Save a member's picture with an optimistic update: every avatar on the page changes at once, and goes back to
 * what it was if the server says no (the reason shows in the picker).
 */
export function usePictureSaver(memberId: number, name: string, current: MemberPicture | null) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const first = name.trim().split(/\s+/)[0] || name;

  const run = async (optimistic: MemberPicture | null, call: () => Promise<MemberPicture | null>, done: string) => {
    const before = current;
    setBusy(true);
    setError("");
    setNote("");
    rememberPicture(memberId, optimistic);
    try {
      rememberPicture(memberId, await call());
      setNote(done);
    } catch (err) {
      rememberPicture(memberId, before);
      setError(pictureErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return {
    busy,
    note,
    error,
    pickAvatar: (key: string, label: string) =>
      void run({ kind: "avatar", key }, () => setMemberAvatar(memberId, key), `${label} picture set.`),
    upload: async (file: File) => {
      setError("");
      setNote("");
      let shrunk: { blob: Blob; kb: number };
      try {
        shrunk = await shrinkPhoto(file);
      } catch (err) {
        setError(pictureErrorMessage(err));
        return;
      }
      const preview = URL.createObjectURL(shrunk.blob);
      await run(
        { kind: "photo", url: preview, updated_at: null },
        () => uploadMemberPhoto(memberId, shrunk.blob),
        `Photo saved (${shrunk.kb} KB).`,
      );
      // The server's copy has its own URL now; keep the preview a moment so the swap doesn't flash.
      window.setTimeout(() => URL.revokeObjectURL(preview), 30_000);
    },
    remove: () =>
      void run(
        null,
        async () => {
          await removeMemberPicture(memberId);
          return null;
        },
        `Picture removed. ${first}’s initials show instead.`,
      ),
  };
}
