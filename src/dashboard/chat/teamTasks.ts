import type { ChatGroup } from "../../lib/api";
import type { TeamTasks, TTask } from "../tasks2";

/**
 * Chat's reading of the v1.4 team tasks (tasks2, built by the web-tasks area; one `useTeamTasks()` per page, passed
 * as `team`). Only who is on a task, its group and its status are read here, from either shape a task can have:
 * the engine's TTask (people = keys "m<memberId>", group = {id, name}) or the §1a JSON (people[].member_id,
 * group_id), so the filters stay right before and after the merge with the real module.
 */
type Loose = {
  id: number;
  status: string;
  people?: Array<string | { member_id: number }>;
  group?: { id: number } | null;
  group_id?: number | null;
  raw?: { group_id?: number | null };
};

const loose = (t: TTask) => t as unknown as Loose;

export function memberIdsOf(t: TTask): number[] {
  return (loose(t).people ?? []).map((p) => (typeof p === "string" ? Number(p.replace(/^m/, "")) : p.member_id)).filter((n) => Number.isFinite(n));
}

export function groupIdOf(t: TTask): number | null {
  const x = loose(t);
  return x.group?.id ?? x.group_id ?? x.raw?.group_id ?? null;
}

const CLOSED = new Set(["approved", "cancelled"]);
export const isOpenTeamTask = (t: TTask) => !CLOSED.has(loose(t).status);

/** A group's tasks: posted in it, or a team task whose people are all in it. */
export function tasksOfGroup(team: TeamTasks, g: Pick<ChatGroup, "id" | "member_ids">): TTask[] {
  return (team.tasks ?? []).filter((t) => {
    if (groupIdOf(t) === g.id) return true;
    const ids = memberIdsOf(t);
    return ids.length > 1 && ids.every((id) => g.member_ids.includes(id));
  });
}

/** A person's tasks: every task they are on. */
export function tasksOfPerson(team: TeamTasks, memberId: number): TTask[] {
  return (team.tasks ?? []).filter((t) => memberIdsOf(t).includes(memberId));
}
