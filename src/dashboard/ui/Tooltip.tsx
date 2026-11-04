import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

/**
 * The one tooltip (shared standard, boards' `.zn-tt`): white card above its anchor with a 6 px arrow, flips
 * below when there is no room, kept inside the screen. Opens on hover and on keyboard focus; Escape closes.
 *
 *   const tip = useTip();
 *   <a {...tip.anchor("tile-alerts", <TipBody title="Needs you" text="…" />)}>…</a>
 *   {tip.node}
 */

export interface TipRow {
  label: ReactNode;
  value: ReactNode;
  /** Colour square before the label (chart series). */
  color?: string;
  total?: boolean;
}

export interface TipBodyProps {
  title?: ReactNode;
  color?: string;
  sub?: ReactNode;
  rows?: readonly TipRow[];
  text?: ReactNode;
  hint?: ReactNode;
}

/** The standard tooltip content: heading (with an optional colour square), sub line, rows, text, hint. */
export function TipBody({ title, color, sub, rows, text, hint }: TipBodyProps): ReactElement {
  return (
    <>
      {title ? (
        <div className="zn-tt-h">
          {color ? <span className="zn-tt-sq" style={{ background: color }} /> : null}
          {title}
        </div>
      ) : null}
      {sub ? <div className={`zn-tt-sub${color ? " ind" : ""}`}>{sub}</div> : null}
      {rows && rows.length ? (
        <div className={`zn-tt-rows${title ? "" : " first"}`}>
          {rows.map((r, i) => (
            <div key={i} className={`zn-tt-row${r.total ? " tot" : ""}`}>
              <span>
                {r.color ? <span className="zn-tt-sq" style={{ background: r.color }} /> : null}
                {r.label}
              </span>
              <b>{r.value}</b>
            </div>
          ))}
        </div>
      ) : null}
      {text ? <div className={`zn-tt-text${title || rows ? "" : " first"}`}>{text}</div> : null}
      {hint ? <div className="zn-tt-hint">{hint}</div> : null}
    </>
  );
}

/** An open tooltip: what to show and the rectangle it points at. */
export interface TipOpen {
  key: string;
  content: ReactNode;
  rect: DOMRect;
  wide: boolean;
}

/** The positioned tooltip card (rendered by useTip). */
export function TipLayer({ id, open, onClose }: { id: string; open: TipOpen; onClose: () => void }): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; arrow: number; below: boolean } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { rect } = open;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const centre = rect.left + rect.width / 2;
    let left = centre - w / 2;
    left = Math.max(12, Math.min(left, vw - w - 12));
    const vh = document.documentElement.clientHeight;
    const below = rect.top - h - 10 < 8;
    // Never past the bottom of the screen either (a tall card under a low anchor).
    const top = Math.max(8, Math.min(below ? rect.bottom + 10 : rect.top - h - 10, vh - h - 8));
    const arrow = Math.max(12, Math.min(centre - left, w - 12));
    // Measuring the rendered card is the only way to place it; one extra render, before paint.
    setPos({ left, top, arrow, below });
  }, [open]);

  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      id={id}
      role="tooltip"
      className={`zn-tt${open.wide ? " wide" : ""}${pos?.below ? " below" : ""}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0, visibility: "hidden" }}
    >
      {open.content}
      <span className="zn-tt-ar" style={{ left: pos?.arrow ?? 0 }} aria-hidden="true" />
    </div>
  );
}
