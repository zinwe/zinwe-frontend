import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { groupOf, openTasks } from "../chat/taskGroups";
import { TaskMark } from "../tasks/icons";
import type { TaskView } from "../tasks/types";
import "../../styles/dash13/phone-tasks.css";

/**
 * Home on a phone: one line about the team's open tasks ("1 late · 2 due today · 1 to check ›") that opens
 * Chat → Tasks. Hidden on a desktop (the menu has Tasks) and when nothing is open.
 */
export function PhoneTasksCard({ tasks }: { tasks: readonly TaskView[] | undefined }): ReactElement | null {
  const open = openTasks(tasks ?? []);
  if (!open.length) return null;
  const late = open.filter((t) => groupOf(t) === "late").length;
  const today = open.filter((t) => groupOf(t) === "today").length;
  const mine = open.filter((t) => groupOf(t) === "mine").length;
  const parts = [late ? `${late} late` : "", today ? `${today} due today` : "", mine ? `${mine} waiting on you` : ""].filter(Boolean);
  return (
    <Link to="/app/chat#view=tasks" className="zn-ptasks">
      <span className="zn-ptasks__ic" aria-hidden="true">
        <TaskMark size={18} stroke={2} />
      </span>
      <span className="zn-ptasks__text">
        <b>Tasks</b>
        <span>
          {parts.length ? (
            parts.map((p, i) => (
              <span key={p}>
                {i ? " · " : ""}
                {i === 0 && late ? <em>{p}</em> : p}
              </span>
            ))
          ) : (
            <>{open.length === 1 ? "1 open task" : `${open.length} open tasks`}</>
          )}
        </span>
      </span>
      <span aria-hidden="true">›</span>
    </Link>
  );
}
