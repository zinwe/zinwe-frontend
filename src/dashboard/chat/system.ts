/**
 * Approval notes ("Your Lunch break at 2:13 PM was approved", sent by decide_break in z_devices/services.py) are
 * events, not conversation: the thread shows them as a small grey line, the tile as "✓ Lunch break 2:13 PM approved".
 * A note the owner typed with the approval keeps its bubble.
 */
const APPROVED = /^Your (.+) at (\d{1,2}:\d{2}\s?[AP]M) was approved$/i;

/** "Lunch break 2:13 PM approved", or null when the line isn't a plain approval. */
export function approvalLine(text: string | null | undefined): string | null {
  const m = APPROVED.exec((text ?? "").trim());
  if (!m) return null;
  const what = m[1].charAt(0).toUpperCase() + m[1].slice(1);
  return `${what} ${m[2]} approved`;
}
