import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { TaskCard, type OpenOpts, type Say, type TeamTasks, type TTask } from "../tasks2";
import { isOpenTeamTask } from "./teamTasks";

/**
 * A conversation's Tasks tab (v1.4, board DashChat): the tasks2 cards for this person or group, open ones first,
 * newest first. A card opens the task panel (its chat icon on the Chat tab; its button may ask for an inline card).
 */
export function ConvTasks({
  label,
  team,
  tasks,
  onOpen,
  say,
}: {
  /** "Priya", or "the Design group". */
  label: string;
  team: TeamTasks;
  tasks: readonly TTask[];
  onOpen: (id: number, opts?: OpenOpts) => void;
  say?: Say;
}): ReactElement {
  const sorted = [...tasks].sort((a, b) => Number(isOpenTeamTask(b)) - Number(isOpenTeamTask(a)) || b.id - a.id);
  return (
    <div className="cv-ctab" aria-label={`Tasks with ${label}`}>
      <div className="cv-ctab__h">
        <span>Tasks with {label}. Open one to follow it, or add one from the message box.</span>
        <Link to="/app/tasks">See all on the Tasks page</Link>
      </div>
      {!team.tasks ? (
        <p className="cv-ctab__none" role="status">
          Loading tasks…
        </p>
      ) : sorted.length ? (
        <div className="cv-ctab__list">
          {sorted.map((t) => (
            <TaskCard key={t.id} task={t} team={team} onOpen={onOpen} say={say} />
          ))}
        </div>
      ) : (
        <p className="cv-ctab__none">No tasks with {label} yet. Use + Task in the message box.</p>
      )}
    </div>
  );
}
