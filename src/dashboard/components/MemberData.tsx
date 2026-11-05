import { useCallback, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { getTopMetrics } from "../../lib/api";
import { formatBytes } from "../features/metrics";
import { TipBody } from "../ui/Tooltip";
import type { Tip } from "../ui/useTip";
import { useResource } from "../useResource";

const DAYS = 7;

const gb = (bytes: number) => (bytes > 0 ? formatBytes(bytes) : "0 GB");

/**
 * DashTeam "Internet data · last 7 days": the person's total (from the team report) and the website or service that
 * used the most (asked only when there is data). The row links to Internet usage, filtered to them.
 */
export function MemberData({
  memberId,
  connected,
  bytes,
  tip,
}: {
  memberId: number;
  connected: boolean;
  /** Total over the last 7 days; undefined while the report loads. */
  bytes: number | undefined;
  tip: Tip;
}): ReactElement {
  const hasData = connected && (bytes ?? 0) > 0;
  const loadTop = useCallback(
    (signal: AbortSignal) =>
      hasData
        ? getTopMetrics({ category: "web.data.site", member: memberId, days: DAYS, limit: 1 }, signal)
        : Promise.resolve(null),
    [memberId, hasData],
  );
  const top = useResource(loadTop, { pollMs: 5 * 60_000 });
  const site = top.data?.items[0];
  const total = bytes === undefined ? "–" : connected ? gb(bytes) : "0 GB";
  const netTip = tip.anchor(`net-${memberId}`, <TipBody text="See where it went on Internet usage" />);

  return (
    <div className="zt-net">
      <Link
        className="zt-zrow"
        to={`/app/internet?member=${memberId}`}
        aria-label={`Internet data, last 7 days: ${total}. See where it went on Internet usage`}
        {...netTip}
      >
        <span className="z-lbl zt-k">Internet data · last 7 days</span>
        <b className="z-num">{total}</b>
      </Link>
      {!connected ? (
        <span className="zt-muted">Nothing yet. It shows once their PC connects.</span>
      ) : bytes === undefined ? null : hasData ? (
        site ? (
          <span className="zt-most">
            Most: <b>{site.key}</b> · {formatBytes(site.bytes)}
          </span>
        ) : null
      ) : (
        <span className="zt-muted">No data yet. Needs the latest Zinwe app.</span>
      )}
    </div>
  );
}
