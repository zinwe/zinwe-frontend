import { authedRequest } from "./http";

/**
 * A member's own to-dos from their Zinwe app. Read-only here: only their app changes them. Plan module: team_chat,
 * like tasks. A to-do made before the app shared them stays on that PC and never shows up here.
 */
export interface MemberTodoStep {
  title: string;
  done: boolean;
}

export interface MemberTodo {
  id: number;
  client_id: string;
  member_id: number;
  member_name: string;
  title: string;
  /** yyyy-mm-dd, or null for no date. */
  due_date: string | null;
  steps: MemberTodoStep[];
  status: "open" | "done";
  done_at: string | null;
  created_at: string;
  /** When the member last changed it. */
  updated_at: string;
  /** Always false in the owner's lists: deleted to-dos are left out. */
  deleted: boolean;
  /** v1.3.5 (F-17): how many chat lines are about this to-do (its thread). Missing on older backends. */
  talk_count?: number;
}

/** GET /api/devices/todos/ — every member's to-dos, or one's with `member`; open · done · all (default); newest change first. */
export function listTodos(params: { status?: "open" | "done" | "all"; member?: number } = {}, signal?: AbortSignal): Promise<MemberTodo[]> {
  const q = new URLSearchParams();
  if (params.status) q.set("status", params.status);
  if (params.member != null) q.set("member", String(params.member));
  const qs = q.toString();
  return authedRequest<MemberTodo[]>(`/api/devices/todos/${qs ? `?${qs}` : ""}`, { signal });
}

/** GET /api/devices/members/<id>/todos/ — one person's to-dos. */
export function listMemberTodos(memberId: number, signal?: AbortSignal): Promise<MemberTodo[]> {
  return authedRequest<MemberTodo[]>(`/api/devices/members/${memberId}/todos/`, { signal });
}
