import { useCallback, useState } from "react";

/**
 * The owner's own order of tasks inside a group (list) or column (board). The tasks API has no order field, so the
 * order is kept in this browser (localStorage), not on the account: another browser or PC shows the default order.
 * One ranking for both views; tasks it doesn't know yet (new ones) come first, in the default order.
 */
const KEY = "zinwe.tasks.order.v1";
const MAX = 500;

interface Saved {
  order: number[];
  /** The list follows your order (after a drag), instead of the sorted column. */
  listManual: boolean;
}

function read(): Saved {
  try {
    const raw = window.localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Partial<Saved>) : null;
    const order = Array.isArray(v?.order) ? v.order.filter((n): n is number => typeof n === "number") : [];
    return { order, listManual: v?.listManual === true };
  } catch {
    return { order: [], listManual: false };
  }
}

function write(v: Saved): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ order: v.order.slice(0, MAX), listManual: v.listManual }));
  } catch {
    // Private mode or a full store: the order still works until the page reloads.
  }
}

export function useTaskOrder() {
  const [saved, setSaved] = useState<Saved>(read);
  const save = useCallback((next: Saved) => {
    setSaved(next);
    write(next);
  }, []);

  /** Sort `list` (already in its default order) by your order; unknown ones first, keeping their default order. */
  const sortByOrder = useCallback(
    <T extends { id: number }>(list: readonly T[]): T[] => {
      const rank = new Map(saved.order.map((id, i) => [id, i]));
      const fresh = list.filter((t) => !rank.has(t.id));
      const known = list.filter((t) => rank.has(t.id)).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
      return [...fresh, ...known];
    },
    [saved.order],
  );

  /** Put `id` just before `beforeId` (null: at the end) in a lane shown as `laneIds`, and remember that order. */
  const place = useCallback(
    (laneIds: readonly number[], id: number, beforeId: number | null, listManual?: boolean) => {
      const rest = laneIds.filter((x) => x !== id);
      const at = beforeId == null ? rest.length : Math.max(0, rest.indexOf(beforeId));
      const lane = [...rest.slice(0, at), id, ...rest.slice(at)];
      save({ order: [...lane, ...saved.order.filter((x) => !lane.includes(x))], listManual: listManual ?? saved.listManual });
    },
    [save, saved],
  );

  const setListManual = useCallback((on: boolean) => save({ ...saved, listManual: on }), [save, saved]);

  return { sortByOrder, place, listManual: saved.listManual, setListManual };
}
