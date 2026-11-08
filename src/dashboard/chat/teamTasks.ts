import type { ChatGroup } from "../../lib/api";
import { TaskCard, useTeamTasks } from "../tasks2";

/**
 * The one place Chat reads the v1.4 team tasks (tasks2, built by the web-tasks area). Only the §1a fields Chat
 * needs are read, through this small shape, so the merge with the real tasks2 module stays a one-file concern.
 */
export interface ChatTask {
  id: number;
  title: string;
  status: string;
  group_id?: number | null;
  people: Array<{ member_id: number }>;
}

/** The card's own task type (whatever tasks2 calls it). */
export type CardTask = Parameters<typeof TaskCard>[0]["task"];

const CLOSED = new Set(["approved", "cancelled"]);
export const isOpenTask = (t: ChatTask) => !CLOSED.has(t.status);

export function useChatTasks(): { tasks: ChatTask[] | undefined; byId: (id: number) => CardTask | null; reload: () => void } {
  // Read either `tasks` or `data` (a useResource-style hook), so a small difference in the real hook still works.
  const r = useTeamTasks() as unknown as { tasks?: unknown; data?: unknown; reload?: () => void };
  const list = (Array.isArray(r.tasks) ? r.tasks : Array.isArray(r.data) ? r.data : undefined) as ChatTask[] | undefined;
  return {
    tasks: list,
    byId: (id) => ((list ?? []).find((t) => t.id === id) as CardTask | undefined) ?? null,
    reload: r.reload ?? (() => {}),
  };
}

/** A group's tasks: posted in it, or a team task whose people are all in it. */
export function tasksOfGroup(tasks: readonly ChatTask[], g: Pick<ChatGroup, "id" | "member_ids">): ChatTask[] {
  return tasks.filter((t) => t.group_id === g.id || (t.people.length > 1 && t.people.every((p) => g.member_ids.includes(p.member_id))));
}

/** A person's tasks: every task they are on. */
export function tasksOfPerson(tasks: readonly ChatTask[], memberId: number): ChatTask[] {
  return tasks.filter((t) => t.people.some((p) => p.member_id === memberId));
}
