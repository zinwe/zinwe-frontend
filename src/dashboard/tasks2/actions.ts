import type { CSSProperties } from "react";
import { errorMessage } from "../../lib/api";
import { clock, dayDiff, memberIdOf, namesOf, personIn, stepInfo, type Directory, type Person, type TTask } from "./engine";
import type { Say, TaskPrefill } from "./parts";
import type { TeamTasks } from "./useTeamTasks";

export function avStyle(p: Pick<Person, "av" | "fg">): CSSProperties {
  return { backgroundColor: p.av, color: p.fg ?? "#404040" };
}

/** Who a nudge reaches: in a relay, whoever's turn it is; else everyone on it. */
export function nudgeTarget(t: TTask): string | null {
  const info = stepInfo(t);
  return t.inOrder && info.cur >= 0 && t.steps[info.cur].owner ? t.steps[info.cur].owner : null;
}

/**
 * The buttons that need no more input run here (Approve, Nudge, Restore); the rest (Reply, Reopen…, Reassign, Move
 * due date) need the panel's inline card: returns false so the caller opens it.
 */
export async function runDirect(team: TeamTasks, t: TTask, act: string, say: Say): Promise<boolean> {
  const { dir } = team;
  try {
    if (act === "approve") {
      await team.act.action(t.id, { action: "approve" });
      say(`Approved. ${namesOf(dir, t.people)} see${t.people.length === 1 ? "s" : ""} it in the Zinwe app.`);
      return true;
    }
    if (act === "nudge") {
      const target = nudgeTarget(t);
      const mid = target ? dir.byKey[target]?.memberId : undefined;
      await team.act.action(t.id, mid != null ? { action: "nudge", member_id: mid } : { action: "nudge" });
      say(`Nudged ${target ? personIn(dir, target).first : namesOf(dir, t.people)}. Zinwe reminds them on their PC.`);
      return true;
    }
    if (act === "restore") {
      await team.act.action(t.id, { action: "restore" });
      say(`Restored. It’s back in ${namesOf(dir, t.people)}’s Zinwe app.`);
      return true;
    }
    if (act === "none") return true;
  } catch (err) {
    say(errorMessage(err));
    return true;
  }
  return false;
}

/** The chat this task belongs to: its group, or the one person's chat with you. */
export function chatHrefOf(t: TTask, dir: Directory): string | null {
  if (t.group) return `/app/chat?group=${t.group.id}`;
  if (t.people.length === 1) {
    const id = dir.byKey[t.people[0]]?.memberId;
    return id != null ? `/app/chat/${id}` : null;
  }
  return null;
}

/** A task's values as a prefill (Duplicate). */
export function prefillOf(t: TTask, dir: Directory, now: number): TaskPrefill {
  return {
    title: t.title,
    memberIds: t.people.map((k) => memberIdOf(k, dir)).filter((x): x is number => x != null),
    details: t.details,
    high: t.high,
    d: t.dueAt != null ? Math.max(0, dayDiff(t.dueAt, now)) : 0,
    time: t.dueAt == null || t.anyTime ? "Any time" : clock(t.dueAt),
    repeat: t.repeat,
    mode: t.mode,
    inOrder: t.inOrder,
    steps: t.steps.map((s) => ({ title: s.text, ownerId: memberIdOf(s.owner, dir) })),
  };
}
