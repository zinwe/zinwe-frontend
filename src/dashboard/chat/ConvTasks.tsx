import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { TaskCard } from "../tasks2";
import type { CardTask, ChatTask } from "./teamTasks";

/**
 * A conversation's Tasks tab (v1.4, board DashChat): the task cards for this person or group, newest first,
 * open ones before done ones. A card opens the task panel; its chat icon opens it on Chat.
 */
export function ConvTasks({
  label,
  tasks,
  loading,
  cardOf,
  onOpen,
}: {
  /** "Priya", or "the Design group". */
  label: string;
  tasks: readonly ChatTask[];
  loading: boolean;
  cardOf: (id: number) => CardTask | null;
  onOpen: (taskId: number, chat: boolean) => void;
}): ReactElement {
  const closed = (t: ChatTask) => t.status === "approved" || t.status === "cancelled";
  const sorted = [...tasks].sort((a, b) => Number(closed(a)) - Number(closed(b)) || b.id - a.id);
  return (
    <div className="cv-ctab" aria-label={`Tasks with ${label}`}>
      <div className="cv-ctab__h">
        <span>Tasks with {label}. Open one to follow it, or add one from the message box.</span>
        <Link to="/app/tasks">See all on the Tasks page</Link>
      </div>
      {loading ? (
        <p className="cv-ctab__none" role="status">
          Loading tasks…
        </p>
      ) : sorted.length ? (
        <div className="cv-ctab__list">
          {sorted.map((t) => {
            const card = cardOf(t.id);
            return card ? <TaskCard key={t.id} task={card} onOpen={(chat?: boolean) => onOpen(t.id, !!chat)} /> : null;
          })}
        </div>
      ) : (
        <p className="cv-ctab__none">No tasks with {label} yet. Use + Task in the message box.</p>
      )}
    </div>
  );
}
