import { useCallback } from "react";
import { listTodos, type MemberTodo } from "../../lib/api";
import { useResource, type Resource } from "../useResource";
import type { TaskView } from "./types";

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

/**
 * A member's own to-do as a TaskView, so the Tasks page lists, sorts, filters and counts it with the tasks: open = To
 * do ("sent"), or In progress once a step is ticked; done = Done ("approved"). `own` marks it read-only.
 */
export function todoView(t: MemberTodo): TaskView {
  const ticked = t.steps.some((s) => s.done);
  const updated = Date.parse(t.updated_at);
  return {
    id: -t.id,
    memberId: t.member_id,
    name: t.member_name,
    title: t.title,
    details: "",
    due: t.due_date ?? "",
    time: "",
    high: false,
    status: t.status === "done" ? "approved" : ticked ? "progress" : "sent",
    steps: t.steps.map((s, i) => ({ id: i, label: s.title, done: s.done })),
    note: "",
    noteBy: "",
    confirm: false,
    needsOk: false,
    byMember: false,
    edited: false,
    nudgedAt: "",
    log: [],
    createdAt: Date.parse(t.created_at),
    updatedAt: updated,
    messageId: null,
    own: true,
  };
}
