import { authedRequest } from "./http";
import type { MemberPicture } from "./pictures";

/**
 * FR-20 v2: tasks the owner hands a member (contract: .claude/dev/planning/v1.3.1-fix-roadmap.md, sample JSON in
 * .claude/dev/docs/15-api-reference.md → "Tasks (FR-20 v2)"). Plan module: team_chat, like Chat.
 *
 * sent → seen → accepted (they confirmed) → progress → review (they marked it done, waiting for your OK) → approved;
 * side states help (they asked for help, `help_note`) and cancelled.
 */
export type TaskStatus = "sent" | "seen" | "accepted" | "progress" | "help" | "review" | "approved" | "cancelled";
export type TaskPriority = "normal" | "high";

export interface TaskStepRow {
  id: number;
  title: string;
  done: boolean;
}

/**
 * One line of what happened, oldest first. `action`: created, edited (note = the changed fields), seen, accepted,
 * started, help, done, note, step_done / step_undone (note = the step's title), approved, reopened, cancelled, nudged.
 */
export interface TaskActivityRow {
  at: string;
  by: "owner" | "member";
  action: string;
  note: string;
}

export interface Task {
  id: number;
  member_id: number;
  member_name: string;
  /** FR-44: the assignee's picture (null = initials; older backends leave it out). */
  member_picture?: MemberPicture | null;
  title: string;
  note: string;
  due_at: string | null;
  priority: TaskPriority;
  steps: TaskStepRow[];
  status: TaskStatus;
  help_note: string;
  created_at: string;
  updated_at: string;
  status_changed_at: string;
  status_changed_by: "owner" | "member";
  /** The chat line that carries the task (its card in the thread). */
  message_id: number | null;
  activity: TaskActivityRow[];
  /** v1.3.5 (F-17): how many chat lines are about this task (its thread). Missing on older backends. */
  talk_count?: number;
}

export const TASK_TITLE_MAX = 120;
export const TASK_NOTE_MAX = 1000;

/** GET /api/devices/tasks/ — open (default) · done (approved or cancelled) · all; newest activity first. */
export function listTasks(params: { status?: "open" | "done" | "all"; member?: number } = {}, signal?: AbortSignal): Promise<Task[]> {
  const q = new URLSearchParams();
  if (params.status) q.set("status", params.status);
  if (params.member != null) q.set("member", String(params.member));
  const qs = q.toString();
  return authedRequest<Task[]>(`/api/devices/tasks/${qs ? `?${qs}` : ""}`, { signal });
}

export interface TaskInput {
  title: string;
  note?: string;
  /** ISO date-time, or null for no due date. */
  due_at?: string | null;
  priority?: TaskPriority;
  /** Step titles (a new task); on edit, also `{id, title}` to keep a step's tick. */
  steps?: Array<string | { id?: number; title: string; done?: boolean }>;
}

/** POST /api/devices/members/<id>/tasks/ — the task and its line in that person's chat. */
export function createTask(memberId: number, input: TaskInput): Promise<Task> {
  return authedRequest<Task>(`/api/devices/members/${memberId}/tasks/`, { method: "POST", body: input });
}

/** PATCH /api/devices/tasks/<id>/ — title, note, due date, priority, steps (ticked steps stay ticked). */
export function updateTask(id: number, patch: Partial<TaskInput>): Promise<Task> {
  return authedRequest<Task>(`/api/devices/tasks/${id}/`, { method: "PATCH", body: patch });
}

export type OwnerTaskAction = "approve" | "reopen" | "cancel" | "nudge";

/** POST /api/devices/tasks/<id>/action/ — approve ("Mark done"), reopen, cancel or nudge, with an optional note. */
export function taskAction(id: number, action: OwnerTaskAction, note?: string): Promise<Task> {
  return authedRequest<Task>(`/api/devices/tasks/${id}/action/`, { method: "POST", body: note ? { action, note } : { action } });
}
