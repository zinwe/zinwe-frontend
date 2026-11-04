import { useState, type CSSProperties, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { cx } from "../../lib/cx";
import { useZingle, type ZinglePlace } from "./zingle";

/** Trimmed wordmark proportions (public/brand/zinwe-logo.png, 837 x 206). */
const LOGO_ASPECT = 837 / 206;

interface BrandProps {
  /** "link" (default) renders a home link; "static" a plain span (decorative use). */
  variant?: "link" | "static";
  /** Link target (default "/"). */
  to?: string;
  ariaLabel?: string;
  /** "dark" lettering for light surfaces (default); "light" lettering for ink backgrounds. */
  tone?: "dark" | "light";
  /** Display height in px (the files cover 1x/2x/3x up to 32px). */
  height?: number;
  className?: string;
  /** F-15: show the live Zingle here when it is scheduled for this place (website incl. sign-in, or dashboard). */
  zingle?: ZinglePlace;
}

/**
 * The Zinwe wordmark: the founder's original logo (orange Z, grey "inwe"),
 * background removed and served as WebP with a PNG fallback.
 * Regenerate the files with design/brand/make_brand.py.
 * With `zingle`, a live Zingle (F-15) takes the wordmark's exact box (same height, same width, so nothing moves),
 * its still frame under prefers-reduced-motion, and the wordmark comes back if the image fails.
 */
export function Brand({
  variant = "link",
  to = "/",
  ariaLabel,
  tone = "dark",
  height = 28,
  className,
  zingle: place,
}: BrandProps): ReactElement {
  // Zingles are drawn for light surfaces: the light (on-ink) wordmark keeps the official logo.
  const zingle = useZingle(tone === "dark" ? place : undefined);
  const [broken, setBroken] = useState<number | null>(null);
  const base = tone === "light" ? "/brand/zinwe-logo-light" : "/brand/zinwe-logo";
  const set = (ext: string) => `${base}-32.${ext} 1x, ${base}-64.${ext} 2x, ${base}-96.${ext} 3x`;
  const style = { "--brand-h": `${height}px` } as CSSProperties;

  const zingleOn = zingle !== null && broken !== zingle.id;
  const logo = zingleOn ? (
    <picture>
      {zingle.still_url ? <source media="(prefers-reduced-motion: reduce)" srcSet={zingle.still_url} /> : null}
      <img
        className="brand__logo"
        src={zingle.animated_url}
        width={Math.round(height * LOGO_ASPECT)}
        height={height}
        alt={zingle.alt || "Zinwe"}
        style={{ aspectRatio: "837 / 206", objectFit: "contain", objectPosition: "left center" }}
        onError={() => setBroken(zingle.id)}
      />
    </picture>
  ) : (
    <picture>
      <source type="image/webp" srcSet={set("webp")} />
      <img
        className="brand__logo"
        src={`${base}-64.png`}
        srcSet={set("png")}
        width={Math.round(height * LOGO_ASPECT)}
        height={height}
        alt="Zinwe"
        decoding="async"
      />
    </picture>
  );

  if (variant === "static") {
    return (
      <span className={cx("brand", className)} style={style}>
        {logo}
      </span>
    );
  }
  return (
    <Link className={cx("brand", className)} to={to} aria-label={ariaLabel} style={style}>
      {logo}
    </Link>
  );
}
