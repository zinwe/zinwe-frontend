/**
 * The bell's group chats (v1.4.1): one item per group with something unread, e.g. "Design · Karan: Starting after
 * lunch" / "2 unread in Chat", opening /app/chat/g-<id>. Muted groups stay quiet (the owner's Chat prefs). No runtime
 * imports, so the unit tests run it under plain Node.
 */
import type { ChatGroup } from "../../lib/api/chat";

export interface BellGroupItem {
  id: string;
  kind: "chat";
  title: string;
  body: string;
  /** The newest line's time (missing: the bell stamps when it first saw it). */
  at?: string;
  href: string;
  opens: string;
}

const LINE_MAX = 80;

function firstOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

function cut(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > LINE_MAX ? `${one.slice(0, LINE_MAX - 1).trimEnd()}…` : one;
}

/** "Karan: Starting after lunch", "You: Task: Send the logo", or a system line as it is. */
export function groupLastLine(g: Pick<ChatGroup, "last_message">, ownerFirst = ""): string {
  const last = g.last_message;
  if (!last || !last.text) return "";
  if (last.system) return cut(last.text);
  const body = last.task_id != null && !/^task:/i.test(last.text) ? `Task: ${last.text}` : last.text;
  // The server names the writer by first name, the owner's too.
  const mine = !last.by || last.by.kind === "owner" || (last.by.member_id == null && !!ownerFirst && last.by.name === ownerFirst);
  const who = mine ? "You" : firstOf(last.by?.name ?? "");
  return cut(who && !body.startsWith(`${who}: `) ? `${who}: ${body}` : body);
}

export function groupChatItems(groups: readonly ChatGroup[] | undefined, muted: readonly string[] = [], ownerFirst = ""): BellGroupItem[] {
  return (groups ?? [])
    .filter((g) => g.unread > 0 && !muted.includes(`g${g.id}`))
    .map((g) => {
      const line = groupLastLine(g, ownerFirst);
      const n = g.unread;
      return {
        // A new line (or count) makes it unread again.
        id: `gchat-${g.id}-${n}-${g.last_message_at ?? ""}`,
        kind: "chat" as const,
        title: line ? `${g.name} · ${line}` : g.name,
        body: `${g.mentioned ? "You were mentioned · " : ""}${n === 1 ? "1 unread" : `${n} unread`} in Chat.`,
        at: g.last_message_at || g.last_message?.at || undefined,
        href: `/app/chat/g-${g.id}`,
        opens: g.name,
      };
    });
}
