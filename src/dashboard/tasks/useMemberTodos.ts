import { useCallback } from "react";
import { listTodos, type MemberTodo } from "../../lib/api";
import { useResource, type Resource } from "../useResource";

const POLL_MS = 60_000;

/**
 * Every member's own to-dos, for a page that shows several people: one request, however many cards. `enabled` false
 * (no team_chat on the plan) loads nothing.
 */
export function useMemberTodos({ enabled = true }: { enabled?: boolean } = {}): Resource<MemberTodo[]> {
  const load = useCallback((signal: AbortSignal) => (enabled ? listTodos({}, signal) : Promise.resolve([])), [enabled]);
  return useResource(load, { pollMs: enabled ? POLL_MS : undefined });
}

/** Open ones first, soonest due first (no date last); then done ones, last finished first. */
export function sortTodos(todos: readonly MemberTodo[]): MemberTodo[] {
  const key = (t: MemberTodo) => t.due_date ?? "9999-12-31";
  return [...todos].sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    if (a.status === "open") return key(a).localeCompare(key(b));
    return (b.done_at ?? b.updated_at).localeCompare(a.done_at ?? a.updated_at);
  });
}
