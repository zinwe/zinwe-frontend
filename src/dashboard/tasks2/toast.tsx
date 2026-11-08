import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { Say } from "./parts";

/** The toast at the bottom (5 s, optional Undo). */
export function useToast(): { say: Say; node: ReactElement | null } {
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const say: Say = useCallback((text, undo) => {
    window.clearTimeout(timer.current);
    setToast({ text, undo });
    timer.current = window.setTimeout(() => setToast(null), undo ? 5000 : 4500);
  }, []);
  const node = toast ? (
    <div className="tv tv-toast" role="status" aria-live="polite">
      <span>{toast.text}</span>
      {toast.undo ? (
        <button
          type="button"
          onClick={() => {
            toast.undo?.();
            window.clearTimeout(timer.current);
            setToast(null);
          }}
        >
          Undo
        </button>
      ) : null}
    </div>
  ) : null;
  return { say, node };
}

