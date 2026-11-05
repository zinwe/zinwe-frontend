/**
 * Break and End day decisions (FR-16). decide_break in z_devices/services.py tells the member in a chat line:
 * approved = "Your Lunch break at 2:13 PM was approved" (body: the owner's note, or empty); asked about =
 * "About your Lunch break at 2:13 PM" (body: the owner's note, or "<Name> would like a word about this break. You
 * can reply here."). A log-out reads "Your log-out at 6:10 PM …". The thread shows these as event cards
 * (chat/WorkdayCard, board LabChatWorkday), the tile as "✓ Lunch break 2:13 PM approved".
 */
const APPROVED = /^Your (.+) at (\d{1,2}:\d{2}\s?[AP]M) was approved$/i;
const ASKED = /^About your (.+) at (\d{1,2}:\d{2}\s?[AP]M)$/i;
/** The body the server writes when the owner asked without a note of their own. */
const DEFAULT_ASK = /would like a word about this (break|log-out)\. You can reply here\.$/i;

/** "Lunch break 2:13 PM approved", or null when the line isn't a plain approval. */
export function approvalLine(text: string | null | undefined): string | null {
  const m = APPROVED.exec((text ?? "").trim());
  if (!m) return null;
  const what = m[1].charAt(0).toUpperCase() + m[1].slice(1);
  return `${what} ${m[2]} approved`;
}

/**
 * The tile line of a question without a note of your own (the tile has the body, the server's "would like a word"
 * line): "You asked about a break" / "You asked about their End day". null for any other line.
 */
export function askedLine(text: string | null | undefined): string | null {
  const m = DEFAULT_ASK.exec((text ?? "").trim());
  if (!m) return null;
  return m[1].toLowerCase() === "break" ? "You asked about a break" : "You asked about their End day";
}

export interface WorkDecision {
  /** "approved", or "asked" (denied: the owner would like a word). */
  decision: "approved" | "asked";
  /** A log-out (End day) rather than a break. */
  endDay: boolean;
  /** The break's reason as the server words it ("Lunch", "Tea / coffee"); "" for a plain break or a log-out. */
  reason: string;
  /** When it began, as the server wrote it ("1:05 PM"). */
  when: string;
  /** The note the owner typed with the decision ("" when there was none). */
  note: string;
}

/** A decision line you sent (sender owner), or null for any other line. */
export function decisionOf(m: { sender: string; title?: string | null; body?: string | null }): WorkDecision | null {
  if (m.sender !== "owner") return null;
  const title = (m.title ?? "").trim();
  const hit = APPROVED.exec(title) ?? ASKED.exec(title);
  if (!hit) return null;
  const what = hit[1].trim();
  const endDay = /^log-out$/i.test(what);
  if (!endDay && !/break$/i.test(what)) return null;
  const body = (m.body ?? "").trim();
  return {
    decision: APPROVED.test(title) ? "approved" : "asked",
    endDay,
    reason: endDay ? "" : what.replace(/\s*break$/i, "").trim(),
    when: hit[2].replace(/\s+/g, " ").toUpperCase(),
    note: DEFAULT_ASK.test(body) ? "" : body,
  };
}
