import type { ReactElement } from "react";
import type { RulesScope } from "../../lib/api";
import type { ScopeOptions } from "./scope";

/**
 * "These rules apply to" (boards DashRules / DashRulesHours): the picker (Everyone at <company> · A department ·
 * One PC), then the "Own rules" badge, the line saying what follows what, and "Reset to company rules".
 */
export function ScopeBar({
  company,
  scope,
  opts,
  own,
  line,
  busy,
  onScope,
  onReset,
}: {
  company: string;
  scope: RulesScope;
  opts: ScopeOptions;
  /** This department / PC has its own rules on the open tab. */
  own: boolean;
  line: string;
  /** A load or reset is running: the picker stays usable, Reset waits. */
  busy?: boolean;
  onScope: (next: RulesScope) => void;
  onReset: () => void;
}): ReactElement {
  const custom = own && scope !== "company";
  return (
    <div className="rl-scope" role="group" aria-label="Who these rules apply to">
      <label htmlFor="rl-scope-sel" className="rl-scope__l">
        These rules apply to
      </label>
      <select id="rl-scope-sel" className="rh-sel rl-scope__sel" value={scope} onChange={(e) => onScope(e.target.value as RulesScope)}>
        <option value="company">Everyone at {company}</option>
        {opts.depts.length ? (
          <optgroup label="A department">
            {opts.depts.map((d) => (
              <option key={d.scope} value={d.scope}>
                {d.name} · {d.who}
              </option>
            ))}
          </optgroup>
        ) : null}
        {opts.pcs.length ? (
          <optgroup label="One PC">
            {opts.pcs.map((p) => (
              <option key={p.scope} value={p.scope}>
                {p.host}
                {p.person ? ` · ${p.person}` : ""}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
      <span className="rl-scope__c" aria-live="polite">
        {custom ? <span className="rh-badge">Own rules</span> : null}
        <span>{line}</span>
        {custom ? (
          <button type="button" className="rh-link" disabled={busy} onClick={onReset}>
            Reset to company rules
          </button>
        ) : null}
      </span>
    </div>
  );
}
