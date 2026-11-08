import { authedRequest } from "./http";

/**
 * v1.4 team tasks (contract: zinwe-wt/_v14/api-v14.md §1, from BRIEF.md §1a). Owner side, token auth.
 *
 * One task goes to one or more people (TaskPerson rows); `member` stays the first person for old clients, so the old
 * FR-20 v2 calls in tasks.ts keep working beside these. Additive only: every field an older backend leaves out is
 * optional here and the screens degrade (no people block → one person from member_id/member_name).
 *
 * sent → seen → progress → review (everyone done, waiting for your OK) → approved; side states help, cantdo, cancelled.
 * "accepted" is the old "they confirmed" stage (FR-20 v2); the new screens read it as seen.
 */
export type TeamTaskStatus = "sent" | "seen" | "accepted" | "progress" | "help" | "cantdo" | "review" | "approved" | "cancelled";
export type TeamTaskMode = "all" | "any";
export type TeamTaskRepeat = "" | "day" | "week" | "month";
export type TaskPersonState = "sent" | "seen" | "progress" | "done" | "help" | "cantdo";

export interface TeamTaskPersonJson {
  member_id: number;
  name: string;
  role?: string;
  picture?: unknown;
  state: TaskPersonState;
  steps_total: number;
  steps_done: number;
  seen_at: string | null;
  started_at?: string | null;
  done_at: string | null;
  /** Their help / can't-do reason while it stands. */
  note?: string;
}

export interface TeamTaskStepJson {
  id: number;
  title: string;
  done: boolean;
  /** null = anyone on the task may tick it. */
  owner_id?: number | null;
  done_by_id?: number | null;
  done_at?: string | null;
}

export interface TeamTaskChatSummary {
  count: number;
  unread: number;
  last: { text: string; by: string; at: string } | null;
}

/**
 * One line of what happened, oldest first. `action`: created, seen, accepted, started, took (any-mode: the first to
 * start took it), step_done, step_undone, help, cantdo, finished (one person of a team said done), done (the task now
 * waits for the OK), note, approved, reopened, cancelled, restored, nudged, replied, reassigned, due_moved, edited.
 * `note` = the step title / the note / the changed fields. v1.4 rows name the person (`member_id`, `member_name`).
 */
export interface TeamTaskActivityJson {
  at: string;
  by: "owner" | "member";
  action: string;
  note: string;
  member_id?: number | null;
  member_name?: string;
  /** Sample backend spelling of member_name. */
  name?: string;
}

export interface TeamTaskJson {
  id: number;
  title: string;
  note: string;
  due_at: string | null;
  priority: "normal" | "high";
  status: TeamTaskStatus;
  mode?: TeamTaskMode;
  in_order?: boolean;
  repeat?: TeamTaskRepeat;
  next_on?: string | null;
  group_id?: number | null;
  /** Sample backend only (the API names the group through GET /api/chat/groups/). */
  group_name?: string;
  repeat_of_id?: number | null;
  people?: TeamTaskPersonJson[];
  steps: TeamTaskStepJson[];
  help_note?: string;
  cantdo_note?: string;
  reopen_note?: string;
  nudged_at?: string | null;
  chat?: TeamTaskChatSummary;
  activity: TeamTaskActivityJson[];
  /** The first person (old clients). */
  member?: number;
  member_id?: number;
  member_name?: string;
  created_at: string;
  updated_at: string;
  /** v1.3.5: lines said about this task (old thread count). */
  talk_count?: number;
  status_changed_at?: string;
  status_changed_by?: "owner" | "member";
}

export interface TeamTaskStepInput {
  /** Keep a step's tick and history on edit. */
  id?: number;
  title: string;
  owner_id: number | null;
}

export interface TeamTaskCreate {
  title: string;
  note: string;
  due_at: string | null;
  priority: "normal" | "high";
  member_ids: number[];
  group_id?: number | null;
  post_in_group?: boolean;
  mode: TeamTaskMode;
  in_order: boolean;
  repeat: TeamTaskRepeat;
  steps: TeamTaskStepInput[];
}

export type TeamTaskPatch = Partial<{
  title: string;
  note: string;
  due_at: string | null;
  priority: "normal" | "high";
  repeat: TeamTaskRepeat;
  in_order: boolean;
  mode: TeamTaskMode;
  steps: TeamTaskStepInput[];
}>;

/** Owner actions on POST tasks/<id>/action/. */
export type TeamTaskAction =
  | { action: "approve" }
  | { action: "reopen"; note: string }
  | { action: "nudge"; member_id?: number }
  | { action: "reply"; note: string }
  | { action: "reassign"; member_id: number; from_member_id?: number }
  | { action: "move_due"; due_at: string }
  | { action: "cancel" }
  | { action: "restore" };

/** A line of the one shared task chat. `by.member_id` null = the owner. */
export interface TaskChatLineJson {
  id: number;
  by: { kind: "owner" | "member"; member_id: number | null; name: string };
  body: string;
  at: string;
}

/** A chat group, as far as tasks need it (the full group lives in the chat API). */
export interface TaskGroupJson {
  id: number;
  name: string;
  member_ids: number[];
}

/** The same calls, served by the API or by the sample backend (dashboard/fixtures/teamTasks.ts). */
export interface TeamTasksSource {
  list(signal?: AbortSignal): Promise<TeamTaskJson[]>;
  create(input: TeamTaskCreate): Promise<TeamTaskJson>;
  patch(id: number, patch: TeamTaskPatch): Promise<TeamTaskJson>;
  act(id: number, body: TeamTaskAction): Promise<TeamTaskJson>;
  chat(id: number, signal?: AbortSignal): Promise<TaskChatLineJson[]>;
  say(id: number, body: string): Promise<TaskChatLineJson>;
  read(id: number): Promise<void>;
  groups(signal?: AbortSignal): Promise<TaskGroupJson[]>;
  /** Post the task's card in its group chat, or in each person's chat with you. */
  copyToChat(task: TeamTaskJson): Promise<void>;
}

/** GET /api/devices/tasks/?status=all — every task of the account, newest activity first. */
export function listTeamTasks(signal?: AbortSignal): Promise<TeamTaskJson[]> {
  return authedRequest<TeamTaskJson[]>("/api/devices/tasks/", { query: { status: "all" }, signal });
}

/** POST /api/devices/tasks/ — one task for one or more people (and its card in the group, when asked). */
export function createTeamTask(input: TeamTaskCreate): Promise<TeamTaskJson> {
  return authedRequest<TeamTaskJson>("/api/devices/tasks/", { method: "POST", body: input });
}

/** PATCH /api/devices/tasks/<id>/ — title, note, due, priority, repeat, in order, steps (add, rename, owner). */
export function patchTeamTask(id: number, patch: TeamTaskPatch): Promise<TeamTaskJson> {
  return authedRequest<TeamTaskJson>(`/api/devices/tasks/${id}/`, { method: "PATCH", body: patch });
}

/** POST /api/devices/tasks/<id>/action/ — approve, reopen, nudge, reply, reassign, move_due, cancel, restore. */
export function teamTaskAction(id: number, body: TeamTaskAction): Promise<TeamTaskJson> {
  return authedRequest<TeamTaskJson>(`/api/devices/tasks/${id}/action/`, { method: "POST", body });
}

/** A chat line from the API, whatever its vintage (v1.4 `by`/`body`/`at`, or an old Message row). */
export function toChatLine(raw: unknown): TaskChatLineJson {
  const r = (raw ?? {}) as Record<string, unknown>;
  const by = r.by as TaskChatLineJson["by"] | undefined;
  if (by && typeof by === "object") {
    return { id: Number(r.id), by, body: String(r.body ?? r.text ?? ""), at: String(r.at ?? r.created_at ?? "") };
  }
  const member = r.sender === "member" || r.sender_member != null;
  const memberId = (r.sender_member ?? r.member ?? r.member_id ?? null) as number | null;
  return {
    id: Number(r.id),
    by: { kind: member ? "member" : "owner", member_id: member ? memberId : null, name: String(r.sender_name ?? r.name ?? "") },
    body: String(r.body ?? r.title ?? ""),
    at: String(r.at ?? r.created_at ?? ""),
  };
}

/** GET /api/devices/tasks/<id>/chat/ — the task chat, oldest first. */
export async function listTaskChat(id: number, signal?: AbortSignal): Promise<TaskChatLineJson[]> {
  const rows = await authedRequest<unknown>(`/api/devices/tasks/${id}/chat/`, { signal });
  const list = Array.isArray(rows) ? rows : ((rows as { results?: unknown[] })?.results ?? []);
  return list.map(toChatLine).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** POST /api/devices/tasks/<id>/chat/ — a line for everyone on the task. */
export async function postTaskChat(id: number, body: string): Promise<TaskChatLineJson> {
  return toChatLine(await authedRequest<unknown>(`/api/devices/tasks/${id}/chat/`, { method: "POST", body: { body } }));
}

/** POST /api/devices/tasks/<id>/chat/read/ — the owner has read the task chat. */
export async function readTaskChat(id: number): Promise<void> {
  await authedRequest<unknown>(`/api/devices/tasks/${id}/chat/read/`, { method: "POST", body: {} });
}

/** GET /api/chat/groups/ — the groups a task can go to. Missing chat API = no groups. */
export async function listTaskGroups(signal?: AbortSignal): Promise<TaskGroupJson[]> {
  const rows = await authedRequest<unknown>("/api/chat/groups/", { signal });
  const list = Array.isArray(rows) ? rows : ((rows as { results?: unknown[] })?.results ?? []);
  return list.map((raw) => {
    const g = raw as Record<string, unknown>;
    const ids = Array.isArray(g.member_ids)
      ? (g.member_ids as number[])
      : Array.isArray(g.members)
        ? (g.members as Array<Record<string, unknown>>).map((m) => Number(m.member_id ?? m.id))
        : [];
    return { id: Number(g.id), name: String(g.name ?? ""), member_ids: ids.filter((n) => Number.isFinite(n)) };
  });
}

/** The task card as a line in its group chat (POST /api/chat/groups/<id>/messages/ with the task). */
export async function postTaskCardInGroup(groupId: number, taskId: number): Promise<void> {
  await authedRequest<unknown>(`/api/chat/groups/${groupId}/messages/`, { method: "POST", body: { body: "", task_id: taskId } });
}

/** The task card in one person's chat with you (the FR-20 chat line, about this task). */
export async function postTaskCardToMember(memberId: number, taskId: number, title: string): Promise<void> {
  await authedRequest<unknown>(`/api/devices/members/${memberId}/message/`, {
    method: "POST",
    body: { title: `Task: ${title}`.slice(0, 120), body: "", channel: "chat", about_task: taskId },
  });
}

export const teamTasksApi: TeamTasksSource = {
  list: listTeamTasks,
  create: createTeamTask,
  patch: patchTeamTask,
  act: teamTaskAction,
  chat: listTaskChat,
  say: postTaskChat,
  read: readTaskChat,
  groups: (signal) => listTaskGroups(signal).catch(() => []),
  async copyToChat(t) {
    if (t.group_id) return postTaskCardInGroup(t.group_id, t.id);
    const ids = t.people?.length ? t.people.map((p) => p.member_id) : t.member_id != null ? [t.member_id] : t.member != null ? [t.member] : [];
    await Promise.all(ids.map((m) => postTaskCardToMember(m, t.id, t.title)));
  },
};
