import { authedRequest } from "./http";

/**
 * v1.4 team chat (z_chat), owner side: groups, their messages, reports and the chat settings. Contract: the v1.4
 * brief §1b (D:\Programming\zinwe-wt\_v14\BRIEF.md; the backend's api-v14.md when it lands). Plan module: team_chat.
 *
 * Privacy (owner decision, final): the owner is in every group and never reads chats between members, so there is
 * no endpoint for them here. The owner's own chat with each person stays on the member message API (devices.ts).
 *
 * Reading is lenient: optional fields an older or newer backend may leave out or shape differently (seen_by, the
 * group's last line, pins) are normalised by the helpers at the bottom, so the screens read one shape.
 */

/** The six group pictures (New group dialog), by key. Unknown keys show "people". */
export type GroupIcon = "design" | "code" | "people" | "megaphone" | "briefcase" | "star";
export const GROUP_ICONS: readonly GroupIcon[] = ["design", "code", "people", "megaphone", "briefcase", "star"];

/** Who wrote a line: the owner/admin, or a member. */
export interface ChatAuthor {
  kind: "owner" | "member";
  member_id: number | null;
  name: string;
}

/** The newest line of a group, for its tile. */
export interface GroupLastLine {
  text: string;
  by: ChatAuthor | null;
  at: string;
  system?: boolean;
  /** The line is a task card. */
  task_id?: number | null;
}

export interface ChatGroup {
  id: number;
  kind: "group";
  name: string;
  icon: GroupIcon | string;
  /** Only the owner can post ("Only you can post"). */
  announce: boolean;
  /** Everyone in the group besides the owner (who is in every group). */
  member_ids: number[];
  /** Lines from others the owner hasn't read yet. */
  unread: number;
  /** Someone tagged the owner (@Ananya) in an unread line. Optional. */
  mentioned?: boolean;
  last_message: GroupLastLine | null;
  last_message_at: string | null;
  created_at: string;
}

export interface ChatReplyQuote {
  id: number;
  by: ChatAuthor | null;
  body: string;
}

export interface ChatMessage {
  id: number;
  by: ChatAuthor | null;
  body: string;
  reply_to: ChatReplyQuote | null;
  /** A task card line (z_devices task id). */
  task_id: number | null;
  /** A system line ("You added A and B."). */
  system: boolean;
  edited: boolean;
  deleted: boolean;
  at: string;
  /** Owner's lines: who has read it. A count, or the readers (names or {name}). */
  seen_by?: number | Array<string | { member_id?: number; name: string }>;
}

export interface GroupInput {
  name: string;
  icon: GroupIcon;
  member_ids: number[];
  announce: boolean;
}

/** A message a member reported to the owner. Only that message comes here, never the rest of the chat. */
export interface ChatReport {
  id: number;
  conversation: { id: number; kind: "group" | "direct"; name: string } | null;
  message: { id: number; body: string; by: ChatAuthor | null; at: string } | null;
  reporter: { member_id: number; name: string } | null;
  note: string;
  created_at: string;
  handled_at: string | null;
}

export interface ChatSettings {
  /** Members may message each other (only people who share a group). Default true. */
  allow_member_dm: boolean;
}

/** How long a line can still be edited or deleted for everyone. */
export const CHAT_EDIT_MS = 15 * 60 * 1000;
export const CHAT_BODY_MAX = 2000;
export const GROUP_NAME_MAX = 60;

const BASE = "/api/chat";

/** GET /api/chat/groups/ — every group, with the owner's unread count and the newest line. */
export async function listGroups(signal?: AbortSignal): Promise<ChatGroup[]> {
  const rows = await authedRequest<unknown>(`${BASE}/groups/`, { signal });
  return listOf(rows).map(normaliseGroup);
}

/** POST /api/chat/groups/ — make a group; the server adds the "You made the group…" line. */
export async function createGroup(input: GroupInput): Promise<ChatGroup> {
  return normaliseGroup(await authedRequest<unknown>(`${BASE}/groups/`, { method: "POST", body: input }));
}

/** PATCH /api/chat/groups/<id>/ — rename, picture, people, announce; each change becomes a system line. */
export async function updateGroup(id: number, patch: Partial<GroupInput>): Promise<ChatGroup> {
  return normaliseGroup(await authedRequest<unknown>(`${BASE}/groups/${id}/`, { method: "PATCH", body: patch }));
}

/** GET /api/chat/groups/<id>/messages/ — oldest first (sorted here either way); `before` pages back. */
export async function listGroupMessages(id: number, params: { before?: number } = {}, signal?: AbortSignal): Promise<ChatMessage[]> {
  const rows = await authedRequest<unknown>(`${BASE}/groups/${id}/messages/`, { signal, query: { before: params.before } });
  return listOf(rows)
    .map(normaliseMessage)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || a.id - b.id);
}

/** POST /api/chat/groups/<id>/messages/ — a line from the owner, optionally a reply. */
export async function sendGroupMessage(id: number, input: { body: string; reply_to?: number | null }): Promise<ChatMessage> {
  return normaliseMessage(await authedRequest<unknown>(`${BASE}/groups/${id}/messages/`, { method: "POST", body: input }));
}

/** PATCH /api/chat/groups/<id>/messages/<mid>/ — the owner's own line, within 15 minutes. */
export async function editGroupMessage(id: number, messageId: number, body: string): Promise<ChatMessage> {
  return normaliseMessage(await authedRequest<unknown>(`${BASE}/groups/${id}/messages/${messageId}/`, { method: "PATCH", body: { body } }));
}

/** DELETE /api/chat/groups/<id>/messages/<mid>/ — delete for everyone, within 15 minutes. */
export async function deleteGroupMessage(id: number, messageId: number): Promise<void> {
  await authedRequest<unknown>(`${BASE}/groups/${id}/messages/${messageId}/`, { method: "DELETE" });
}

/** POST /api/chat/groups/<id>/read/ — the owner read the group up to now. */
export async function markGroupRead(id: number): Promise<void> {
  await authedRequest<unknown>(`${BASE}/groups/${id}/read/`, { method: "POST" });
}

/** GET /api/chat/reports/ — newest first. */
export async function listChatReports(signal?: AbortSignal): Promise<ChatReport[]> {
  return listOf(await authedRequest<unknown>(`${BASE}/reports/`, { signal })) as ChatReport[];
}

/** POST /api/chat/reports/<id>/handled/ */
export async function markReportHandled(id: number): Promise<ChatReport> {
  return authedRequest<ChatReport>(`${BASE}/reports/${id}/handled/`, { method: "POST" });
}

export function getChatSettings(signal?: AbortSignal): Promise<ChatSettings> {
  return authedRequest<ChatSettings>(`${BASE}/settings/`, { signal });
}

export function saveChatSettings(patch: Partial<ChatSettings>): Promise<ChatSettings> {
  return authedRequest<ChatSettings>(`${BASE}/settings/`, { method: "PATCH", body: patch });
}

// ---- Reading helpers ----

/** A plain list, or DRF's paginated `{results: [...]}`. */
function listOf(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray((raw as { results?: unknown }).results)) return (raw as { results: unknown[] }).results;
  return [];
}

function authorOf(raw: unknown): ChatAuthor | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<ChatAuthor>;
  return { kind: r.kind === "member" ? "member" : "owner", member_id: typeof r.member_id === "number" ? r.member_id : null, name: String(r.name ?? "") };
}

export function normaliseGroup(raw: unknown): ChatGroup {
  const r = (raw ?? {}) as Partial<ChatGroup> & { members?: Array<{ member_id?: number; id?: number }> };
  const ids = Array.isArray(r.member_ids)
    ? r.member_ids.filter((n): n is number => typeof n === "number")
    : Array.isArray(r.members)
      ? r.members.map((m) => m.member_id ?? m.id).filter((n): n is number => typeof n === "number")
      : [];
  const last = r.last_message && typeof r.last_message === "object" ? r.last_message : null;
  return {
    id: Number(r.id),
    kind: "group",
    name: String(r.name ?? ""),
    icon: (r.icon as GroupIcon) || "people",
    announce: !!r.announce,
    member_ids: ids,
    unread: Number(r.unread ?? 0) || 0,
    mentioned: !!r.mentioned,
    last_message: last ? { text: String(last.text ?? ""), by: authorOf(last.by), at: String(last.at ?? ""), system: !!last.system, task_id: last.task_id ?? null } : null,
    last_message_at: r.last_message_at ?? last?.at ?? null,
    created_at: String(r.created_at ?? ""),
  };
}

export function normaliseMessage(raw: unknown): ChatMessage {
  const r = (raw ?? {}) as Partial<ChatMessage> & { created_at?: string };
  const q = r.reply_to && typeof r.reply_to === "object" ? r.reply_to : null;
  return {
    id: Number(r.id),
    by: authorOf(r.by),
    body: String(r.body ?? ""),
    reply_to: q ? { id: Number(q.id), by: authorOf(q.by), body: String(q.body ?? "") } : null,
    task_id: typeof r.task_id === "number" ? r.task_id : null,
    system: !!r.system,
    edited: !!r.edited,
    deleted: !!r.deleted,
    at: String(r.at ?? r.created_at ?? ""),
    seen_by: r.seen_by,
  };
}

/** How many have read a line, and their names when the server lists them. */
export function seenOf(m: Pick<ChatMessage, "seen_by">): { count: number; names: string[] } {
  const s = m.seen_by;
  if (typeof s === "number") return { count: s, names: [] };
  if (Array.isArray(s)) {
    const names = s.map((x) => (typeof x === "string" ? x : x?.name ?? "")).filter(Boolean);
    return { count: s.length, names };
  }
  return { count: 0, names: [] };
}
