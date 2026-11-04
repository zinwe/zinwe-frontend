import { useEffect, useState } from "react";
import { authedRequest } from "../../lib/api";

/**
 * F-15 Zingles: our own animated logo for special days (Diwali…), scheduled in Admin → Publish → Zingles.
 * GET /api/auth/zingle/ (public, cached 5 min on the server) answers the one live now, or null. It is read once per
 * tab: kept in memory and in sessionStorage for 5 minutes, so page changes don't ask again. The image is loaded before
 * it replaces the wordmark, and any failure (no endpoint yet, no image) keeps the official logo.
 */

export type ZinglePlace = "website" | "dashboard";

export interface Zingle {
  id: number;
  animated_url: string;
  still_url: string;
  alt: string;
  /** Sign-in counts as website. */
  places: "website" | "dashboard" | "both";
}

const KEY = "zinwe.zingle";
const TTL_MS = 5 * 60_000;

let memo: { at: number; value: Zingle | null } | null = null;
let inflight: Promise<Zingle | null> | null = null;

function isZingle(value: unknown): value is Zingle {
  const z = value as Partial<Zingle> | null;
  return !!z && typeof z.animated_url === "string" && !!z.animated_url && typeof z.still_url === "string";
}

function readStored(): { at: number; value: Zingle | null } | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as { at?: number; value?: unknown } | null;
    if (!raw || typeof raw.at !== "number" || Date.now() - raw.at > TTL_MS) return null;
    return { at: raw.at, value: isZingle(raw.value) ? raw.value : null };
  } catch {
    return null;
  }
}

function store(value: Zingle | null): void {
  memo = { at: Date.now(), value };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(memo));
  } catch {
    /* storage blocked: the memory copy still saves the repeat requests */
  }
}

function loadZingle(): Promise<Zingle | null> {
  if (memo && Date.now() - memo.at <= TTL_MS) return Promise.resolve(memo.value);
  const stored = readStored();
  if (stored) {
    memo = stored;
    return Promise.resolve(stored.value);
  }
  inflight ??= authedRequest<unknown>("/api/auth/zingle/", { anonymous: true })
    .then(
      (data) => (isZingle(data) ? data : null),
      () => null,
    )
    .then((value) => {
      store(value);
      inflight = null;
      return value;
    });
  return inflight;
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** The live Zingle for this place, once its image has loaded; null otherwise (show the wordmark). */
export function useZingle(place: ZinglePlace | undefined): Zingle | null {
  const [zingle, setZingle] = useState<Zingle | null>(null);
  useEffect(() => {
    if (!place) return;
    let gone = false;
    void loadZingle().then((z) => {
      if (gone || !z || (z.places !== "both" && z.places !== place)) return;
      const img = new Image();
      img.onload = () => {
        if (!gone) setZingle(z);
      };
      img.src = reducedMotion() && z.still_url ? z.still_url : z.animated_url;
    });
    return () => {
      gone = true;
    };
  }, [place]);
  return zingle;
}
