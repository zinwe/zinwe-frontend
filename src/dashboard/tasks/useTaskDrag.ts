import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Verdict } from "./pageModel";

/** The lifted copy under the pointer (or flying back after a refused drop). */
export interface DragGhost {
  id: number;
  x: number;
  y: number;
  w: number;
  back: boolean;
}
/** Where the pointer is: the lane (data-lane), the task it would go before (null = the end), and what a drop means. */
export interface DragOver {
  lane: string;
  before: number | null;
  v: Verdict;
}

interface Press {
  id: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  w: number;
  left: number;
  top: number;
  started: boolean;
}

/**
 * Drag a task with a mouse, pen or finger (pointer events, as LabDashTasks): a list row by its grip, a board card
 * anywhere but its buttons ([data-nodrag]). Lanes carry data-lane, tasks data-card. A drop calls `onDrop` with the
 * verdict; a refused one flies back and calls `onRefuse` with the reason. Esc cancels a drag.
 */
export function useTaskDrag({
  verdictOf,
  onDrop,
  onRefuse,
  ghostWidth,
}: {
  verdictOf: (id: number, lane: string) => Verdict;
  onDrop: (id: number, lane: string, before: number | null, v: Verdict) => void;
  onRefuse: (why: string) => void;
  /** Cap the lifted copy's width (a list row is wide; the copy looks like a card). */
  ghostWidth?: number;
}) {
  const [ghost, setGhost] = useState<DragGhost | null>(null);
  const [over, setOver] = useState<DragOver | null>(null);
  const press = useRef<Press | null>(null);
  const overRef = useRef<DragOver | null>(null);
  const raf = useRef<number | null>(null);
  const backTimer = useRef<number | undefined>(undefined);
  const justDragged = useRef(false);
  const cleanup = useRef<() => void>(() => {});
  const cb = useRef({ verdictOf, onDrop, onRefuse });
  useEffect(() => {
    cb.current = { verdictOf, onDrop, onRefuse };
  });

  useEffect(
    () => () => {
      cleanup.current();
      window.clearTimeout(backTimer.current);
      if (raf.current != null) cancelAnimationFrame(raf.current);
    },
    [],
  );

  const start = useCallback(
    (id: number, e: ReactPointerEvent<HTMLElement>, el: HTMLElement | null) => {
      if (e.button !== 0 || !el) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("[data-nodrag]")) return;
      const r = el.getBoundingClientRect();
      const w = Math.min(r.width, ghostWidth ?? r.width);
      press.current = { id, x0: e.clientX, y0: e.clientY, dx: Math.min(e.clientX - r.left, w - 24), dy: e.clientY - r.top, w, left: r.left, top: r.top, started: false };
      cleanup.current();

      const finish = (cancelled: boolean) => {
        const p = press.current;
        press.current = null;
        cleanup.current();
        if (!p || !p.started) return;
        if (raf.current != null) cancelAnimationFrame(raf.current);
        raf.current = null;
        justDragged.current = true;
        window.setTimeout(() => (justDragged.current = false), 60);
        const o = cancelled ? null : overRef.current;
        overRef.current = null;
        setOver(null);
        if (o && o.v.kind !== "no") {
          setGhost(null);
          cb.current.onDrop(p.id, o.lane, o.before, o.v);
          return;
        }
        // Refused, cancelled or dropped outside a lane: the copy flies back to where it was.
        setGhost({ id: p.id, x: p.left, y: p.top, w: p.w, back: true });
        window.clearTimeout(backTimer.current);
        backTimer.current = window.setTimeout(() => setGhost(null), 200);
        if (o && o.v.kind === "no") cb.current.onRefuse(o.v.why);
      };

      const move = (ev: PointerEvent) => {
        const p = press.current;
        if (!p) return;
        if (!p.started) {
          if (Math.abs(ev.clientX - p.x0) + Math.abs(ev.clientY - p.y0) < 6) return;
          p.started = true;
          document.body.classList.add("tq-dragging");
        }
        ev.preventDefault();
        const x = ev.clientX;
        const y = ev.clientY;
        // Near the top or bottom edge the page scrolls, so a long list can be crossed.
        if (y < 70) window.scrollBy(0, -14);
        else if (y > window.innerHeight - 50) window.scrollBy(0, 14);
        const hit = document.elementFromPoint(x, y);
        const laneEl = hit?.closest?.<HTMLElement>("[data-lane]") ?? null;
        let next: DragOver | null = null;
        if (laneEl) {
          const lane = laneEl.dataset.lane ?? "";
          const v = cb.current.verdictOf(p.id, lane);
          let before: number | null = null;
          if (v.kind === "move") {
            const cards = Array.from(laneEl.querySelectorAll<HTMLElement>("[data-card]")).filter((c) => Number(c.dataset.card) !== p.id);
            for (const c of cards) {
              const cr = c.getBoundingClientRect();
              if (y < cr.top + cr.height / 2) {
                before = Number(c.dataset.card);
                break;
              }
            }
          }
          next = { lane, before, v };
        }
        overRef.current = next;
        if (raf.current != null) return;
        raf.current = requestAnimationFrame(() => {
          raf.current = null;
          setGhost({ id: p.id, x: x - p.dx, y: y - p.dy, w: p.w, back: false });
          setOver(overRef.current);
        });
      };
      const up = () => finish(false);
      const cancel = () => finish(true);
      const key = (ev: KeyboardEvent) => {
        if (ev.key === "Escape" && press.current?.started) {
          ev.preventDefault();
          ev.stopPropagation();
          finish(true);
        }
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", cancel);
      document.addEventListener("keydown", key, true);
      cleanup.current = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", cancel);
        document.removeEventListener("keydown", key, true);
        document.body.classList.remove("tq-dragging");
        cleanup.current = () => {};
      };
    },
    [ghostWidth],
  );

  /** True right after a drag ended: the click that follows a drop must not open the task. */
  const wasDrag = useCallback(() => justDragged.current, []);

  return { ghost, over, start, wasDrag };
}
