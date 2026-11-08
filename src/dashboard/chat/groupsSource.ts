import {
  ApiError,
  createGroup,
  deleteGroupMessage,
  editGroupMessage,
  getChatSettings,
  listChatReports,
  listGroupMessages,
  listGroups,
  markGroupRead,
  markReportHandled,
  saveChatSettings,
  sendGroupMessage,
  updateGroup,
  type ChatGroup,
  type ChatMessage,
  type ChatReport,
  type ChatSettings,
  type GroupInput,
  type Member,
} from "../../lib/api";
import { SAMPLES_ON } from "../fixtures";
import * as S from "../fixtures/chat";

/**
 * Where team-chat groups come from (v1.4). The server's /api/chat/ when it has it; otherwise, in a sample build
 * (SAMPLES_ON), the sample groups in fixtures/chat.ts; otherwise (production against an older server) no groups,
 * and the screens hide New group. Decided by the first groups list of the visit: a 404 there means "no chat API".
 *
 * Every screen calls these, never lib/api's chat calls directly, so the switch lives in one place.
 */

type Mode = "unknown" | "api" | "sample" | "none";
let mode: Mode = "unknown";
/** Members for the sample (it lays its groups onto the real team). */
let team: readonly Member[] = [];

/** False when the server has no chat API and there is no sample: no groups, no New group. */
export function groupsAvailable(): boolean {
  return mode !== "none";
}

function notFound(e: unknown): boolean {
  return e instanceof ApiError && e.kind === "not_found";
}

export async function loadGroups(members: readonly Member[] | undefined, signal?: AbortSignal): Promise<ChatGroup[]> {
  if (members) team = members;
  if (mode === "sample") return S.sampleListGroups(team, signal);
  if (mode === "none") return [];
  try {
    const groups = await listGroups(signal);
    mode = "api";
    return groups;
  } catch (e) {
    if (mode === "unknown" && notFound(e)) {
      mode = SAMPLES_ON ? "sample" : "none";
      return mode === "sample" ? S.sampleListGroups(team, signal) : [];
    }
    throw e;
  }
}

export function loadGroupMessages(id: number, signal?: AbortSignal): Promise<ChatMessage[]> {
  return mode === "sample" ? S.sampleListMessages(id, team, signal) : listGroupMessages(id, {}, signal);
}

export function postGroupMessage(id: number, body: string, replyTo: number | null): Promise<ChatMessage> {
  return mode === "sample" ? S.sampleSend(id, body, replyTo) : sendGroupMessage(id, { body, reply_to: replyTo });
}

export function changeGroupMessage(id: number, messageId: number, body: string): Promise<ChatMessage> {
  return mode === "sample" ? S.sampleEdit(id, messageId, body) : editGroupMessage(id, messageId, body);
}

export function removeGroupMessage(id: number, messageId: number): Promise<void> {
  return mode === "sample" ? S.sampleDelete(id, messageId) : deleteGroupMessage(id, messageId);
}

export function readGroup(id: number): Promise<void> {
  return mode === "sample" ? S.sampleRead(id) : markGroupRead(id);
}

export function makeGroup(input: GroupInput): Promise<ChatGroup> {
  return mode === "sample" ? S.sampleCreate(input, team) : createGroup(input);
}

export function editGroup(id: number, patch: Partial<GroupInput>): Promise<ChatGroup> {
  return mode === "sample" ? S.sampleUpdate(id, patch, team) : updateGroup(id, patch);
}

export async function loadReports(signal?: AbortSignal): Promise<ChatReport[]> {
  if (mode === "sample") return S.sampleReports(team, signal);
  if (mode === "none") return [];
  try {
    return await listChatReports(signal);
  } catch (e) {
    if (!notFound(e)) throw e;
    // Asked before the groups list decided: no chat API here, so the same rule applies.
    if (mode === "unknown") mode = SAMPLES_ON ? "sample" : "none";
    return mode === "sample" ? S.sampleReports(team, signal) : [];
  }
}

export function handleReport(id: number): Promise<ChatReport> {
  return mode === "sample" ? S.sampleHandle(id) : markReportHandled(id);
}

export function loadChatSettings(signal?: AbortSignal): Promise<ChatSettings> {
  return mode === "sample" ? S.sampleSettings(signal) : getChatSettings(signal);
}

export function storeChatSettings(patch: Partial<ChatSettings>): Promise<ChatSettings> {
  return mode === "sample" ? S.sampleSaveSettings(patch) : saveChatSettings(patch);
}
