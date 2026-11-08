/**
 * Rules: the settings on the Rules board (DashRules) that the policy API (GET/PUT devices/policy/) does not hold yet.
 * Everything else on Rules — USB, websites (off / watch / block, the site lists, own sites, allowed sites), the data
 * limits, file names in alerts, read-only on a big USB copy, and which remote tools are blocked — is the REAL policy.
 *
 * Sample here (kept for the tab's life, like a server would), one set per scope (company / department / PC; a scope
 * with nothing of its own starts from the company's):
 * - Remote tools: Allow (no alert) as apart from Watch, custom tools' names, tools taken off the list.
 * - Software: the new-software alerts switch.
 *
 * When the policy grows these fields, `getRulesExtras` / `saveRulesExtras` become part of getPolicy / updatePolicy.
 * SAMPLES_ON off (production): the extras are NEUTRAL (nothing allowed, added or removed beyond the real policy),
 * nothing is stored, and RulesPage hides every control above.
 */
import { sample, sampleStore, SAMPLES_ON } from "./index";

export interface RulesExtras {
  softwareAlerts: boolean;
  /** Remote tools set to Allow: they run with no alert (the API only knows blocked or not). */
  allowTools: string[];
  /** Tools the owner added (name, optional app file "tool.exe"). */
  customTools: Array<{ name: string; exe: string }>;
  /** Built-in tools the owner took off the list (ids). */
  removedTools: string[];
}

const DEFAULTS: RulesExtras = {
  softwareAlerts: true,
  allowTools: ["Quick Assist"],
  customTools: [],
  removedTools: [],
};

/** Production: extras that add nothing to the real policy (the draft is the policy as saved). */
const NEUTRAL: RulesExtras = {
  ...DEFAULTS,
  allowTools: [],
  customTools: [],
  removedTools: [],
};

type ExtrasStore = { get: () => RulesExtras; set: (next: RulesExtras) => void };
const stores = new Map<string, ExtrasStore>();
function storeFor(scope: string): ExtrasStore {
  let st = stores.get(scope);
  if (!st) {
    st = sampleStore<RulesExtras>(scope === "company" ? "rules" : `rules.${scope}`, () =>
      scope === "company" ? structuredClone(DEFAULTS) : structuredClone<RulesExtras>(storeFor("company").get()),
    );
    stores.set(scope, st);
  }
  return st;
}

/** GET the Rules extras at a scope (sample). */
export function getRulesExtras(signal?: AbortSignal, scope = "company"): Promise<RulesExtras> {
  if (!SAMPLES_ON) return sample(structuredClone(NEUTRAL), signal, 0);
  return sample(storeFor(scope).get(), signal);
}

/** PUT the Rules extras at a scope (sample). */
export function saveRulesExtras(next: RulesExtras, scope = "company"): Promise<RulesExtras> {
  if (!SAMPLES_ON) return sample(structuredClone(NEUTRAL), undefined, 0);
  storeFor(scope).set(structuredClone(next));
  return sample(next, undefined, 120);
}
