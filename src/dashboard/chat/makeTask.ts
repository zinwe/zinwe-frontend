/**
 * "Make a task" from a chat line (v1.4.1, board DashChat): the line's first line becomes the title (no @tags, cut at
 * a word to fit the task form's 120 characters, no full stop at the end); when anything was cut, the whole message
 * goes into Details so nothing is lost. No imports: the unit tests run it under plain Node.
 */
export const TASK_TITLE_MAX = 120;
/** The task form's Details box. */
export const TASK_DETAILS_MAX = 1000;
/** A title cut shorter than this would say too little: cut mid-word instead. */
const MIN_WORD_CUT = 40;

export function taskFromMessage(text: string): { title: string; details: string } {
  const full = text.replace(/\r\n?/g, "\n").trim();
  const first = full.split("\n").find((l) => l.trim()) ?? "";
  const clean = first
    .replace(/(^|\s)@[A-Za-z][\w-]*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  let title = clean;
  if (title.length > TASK_TITLE_MAX) {
    const room = title.slice(0, TASK_TITLE_MAX - 1);
    const space = room.lastIndexOf(" ");
    title = `${(space >= MIN_WORD_CUT ? room.slice(0, space) : room).replace(/[\s,;:–-]+$/, "")}…`;
  } else {
    title = title.replace(/[.!]+$/, "");
  }
  // Only @tags or nothing: fall back to the raw first line.
  if (!title) title = first.trim().slice(0, TASK_TITLE_MAX);
  const cut = clean.length > TASK_TITLE_MAX || full.includes("\n");
  return { title, details: cut ? full.slice(0, TASK_DETAILS_MAX) : "" };
}
