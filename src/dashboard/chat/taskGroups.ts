import { isDueToday, isOpenTask, isOverdue, needsOwner } from "../tasks/model";
import { addDays, todayIso, type TaskView } from "../tasks/types";

/** The groups behind the phone Home card's counts (late, waiting on you, today, this week, later). */
export type Group = "late" | "mine" | "today" | "week" | "later";

/** One group per task: waiting on you wins, then late, today, the next 7 days, later (or no due day). */
export function groupOf(t: TaskView, today = todayIso()): Group {
  if (needsOwner(t)) return "mine";
  if (isOverdue(t)) return "late";
  if (isDueToday(t) || t.due === today) return "today";
  if (t.due && t.due <= addDays(today, 7)) return "week";
  return "later";
}

/** The open tasks across the team that the Tasks view counts (everything not approved or cancelled). */
export const openTasks = (tasks: readonly TaskView[]) => tasks.filter(isOpenTask);
