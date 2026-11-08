/**
 * Team tasks v1.4 — the one task UI, used by Tasks, Overview and Chat (design: zinwe-wt/_v14 prototype; API: §1a).
 *
 * import { TaskPanel, TaskCard, QuickAdd, TaskForm, useTeamTasks } from "../tasks2";
 * (and import "../tasks2/tasks2.css" once on the page — every component uses its .tv-* classes).
 *
 * ── useTeamTasks(opts?) → TeamTasks ───────────────────────────────────────────────────────────────────────────
 *   opts: { enabled?: boolean (false = load nothing, e.g. no team_chat on the plan),
 *           pollMs?: number (default 15 000), members?: Member[] (default: the shell's team list) }
 *   returns { tasks: TTask[] | undefined, dir: Directory (people by key "m<memberId>" + groups), error, pending, reload,
 *             sample: boolean (sample backend in dev), now: number, needs: number (waiting on the owner: review /
 *             help / can't do it — the Tasks badge), byId(id), act: { create, patch, action, copyToChat, chat, say,
 *             read } }
 *   One call per screen; pass the result as `team` to every component below. Any change fires TEAM_TASKS_CHANGED
 *   ("zinwe:tasks-changed") so every other view reloads at once.
 *
 * ── <TaskPanel team taskId create? tab? card? onClose onOpen? say? chatHref? /> ──────────────────────────────────
 *   team: TeamTasks · taskId: number | null (the task to show) · create?: TaskPrefill | null (with taskId null: the
 *   new-task form in the panel; after Send it turns into that task) · tab?: "overview" | "chat" | "activity"
 *   (first tab; "chat" for a chat card's Open) · card?: "reply" | "reopen" | "reassign" | "due" | "cancel" (open
 *   that inline card in What's happening) · onClose() · onOpen?(id) (the panel now shows another task: keep the URL
 *   in step) · say?(text, undo?) (toast; the panel has its own when left out) · chatHref?(t) (where "Open chat"
 *   goes; default: its group `/app/chat?group=<id>` or `/app/chat/<memberId>`).
 *   Desktop: 560 px right panel over a scrim. Phone (≤ 760 px): full-height bottom sheet.
 *
 * ── <TaskCard task team onOpen thread? flash? say? /> ────────────────────────────────────────────────────────────
 *   task: TTask · team: TeamTasks · onOpen(id, { tab?, card? }) (open the panel; the card's primary button runs
 *   Approve / Nudge / Restore itself and asks for the panel with a card for Reply / Reassign / Reopen / Move due) ·
 *   thread?: boolean (chat: footer with the last reply, "N replies", "Open task chat" and a reply box that posts into
 *   the task chat) · flash?: boolean (new card highlight) · say?(text, undo?).
 *
 * ── <QuickAdd team fixed? initialText? autoFocus? onSent? onOpenFull? onCancel? say? /> ─────────────────────────
 *   fixed?: { memberIds?: number[]; groupId?: number | null } (Chat: the person / group it is for — "Add a task for
 *   Karan…") · initialText?: string ("/task …" or "Make a task" from a message) · autoFocus? · onSent?(task) ·
 *   onOpenFull?(prefill: TaskPrefill) ("Open full form" / "Steps": open <TaskPanel create={prefill} />) ·
 *   onCancel?() (Escape on an empty line) · say?(text, undo?) (Undo cancels the task just sent).
 *
 * ── <TaskForm team prefill? editing? onClose onSent? say? bare? /> ───────────────────────────────────────────────
 *   The panel in create mode on its own (scrim + panel). prefill?: TaskPrefill · editing?: TTask (edit instead) ·
 *   onClose() · onSent?(task) · say? · bare? (insides only, no scrim/panel). Usually prefer
 *   <TaskPanel taskId={null} create={prefill} />, which turns into the task after Send.
 *
 * TaskPrefill: { title?, memberIds?: number[], groupId?: number | null, details?, high?, d?: day offset (0 = today),
 *   time?: "6:00 PM" | "Any time", repeat?: "" | "day" | "week" | "month", mode?: "all" | "any", inOrder?,
 *   steps?: { title, ownerId: number | null }[] }
 */
export { TaskPanel } from "./TaskPanel";
export { TaskCard, ChatCount } from "./TaskCard";
export { QuickAdd } from "./QuickAdd";
export { TaskForm } from "./TaskForm";
export { useTeamTasks, useTaskChat, teamTasksChanged, TEAM_TASKS_CHANGED, type TeamTasks, type TeamTaskActions } from "./useTeamTasks";
export { type TaskPrefill, type PanelTab, type PanelCard, type OpenOpts, type Say } from "./parts";
export { chatHrefOf, prefillOf } from "./actions";
export { useToast } from "./toast";
export { happen, journey, laneOf, needsYou, pillOf, dueOf, type TTask, type Directory, type Person, type Group, type Lane } from "./engine";
