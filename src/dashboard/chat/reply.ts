import type { Message } from "../../lib/api";
import type { TaskView } from "../tasks/types";

/**
 * Replies in Chat. The messages API has no "reply to" field, so a reply goes out with its subject line saying what
 * it answers ("Re: <their line>" or "About: <task title>"): the member sees that in their Zinwe window, and this
 * page turns it back into the quote above the bubble.
 */
export interface ReplyTarget {
  /** Thread item key: m<message id> or t<task id>. */
  key: string;
  /** "Replying to Priya", "Replying to your message", "Replying about this task". */
  head: string;
  /** The quoted line. */
  text: string;
  /** The subject the reply goes out with. */
  subject: string;
  /** Composer placeholder: "Reply to <placeholder>…". */
  placeholder: string;
  /** A draft to start from. */
  draft?: string;
  /** v1.4 group lines: the line it answers (sent as reply_to; groups have a real reply field). */
  messageId?: number;
}

/** The first line of a message, as quoted. */
export function firstLine(m: Pick<Message, "body" | "title">): string {
  return String(m.body || m.title || "").split("\n")[0].trim();
}

/** The quote above a reply you sent: what it answers, who said it, and where it is in the thread. */
export function quoteOf(m: Message, thread: readonly Message[], tasks: readonly TaskView[], first: string): { key: string | null; who: string; text: string } | null {
  const title = m.title ?? "";
  if (title.startsWith("About: ")) {
    const name = title.slice(7).replace(/…$/, "");
    const t = tasks.find((x) => x.title.startsWith(name));
    // Other notes use "About: …" subjects too (alert notes): only a task's title becomes a quote.
    return t ? { key: `t${t.id}`, who: "You", text: `Task: ${t.title}` } : null;
  }
  if (title.startsWith("Re: ")) {
    const quoted = title.slice(4).replace(/…$/, "").trim();
    if (!quoted) return null;
    const at = new Date(m.created_at).getTime();
    const hit = thread.find((x) => x.id !== m.id && new Date(x.created_at).getTime() <= at && firstLine(x).startsWith(quoted));
    return { key: hit ? `m${hit.id}` : null, who: hit ? (hit.sender === "owner" ? "You" : first) : "", text: hit ? firstLine(hit) : title.slice(4) };
  }
  return null;
}
