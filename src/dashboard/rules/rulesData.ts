/**
 * The Rules page's v1.4 calls: the real API (lib/api/rules.ts), with the sample stand-in (fixtures/workRules.ts)
 * only when samples are on and the backend has no v1.4 endpoints yet. Once a call finds the endpoint missing,
 * that area stays on samples for the tab's life, so loads and saves never mix the two.
 */
import {
  addHoliday,
  ApiError,
  deleteHoliday,
  getPolicy,
  getPolicyAt,
  getWorkHours,
  listHolidays,
  resetPolicyAt,
  resetWorkHours,
  saveWorkHours,
  updatePolicyAt,
  type Holiday,
  type PolicyAtScope,
  type PolicyUpdate,
  type RulesScope,
  type WorkHours,
  type WorkHoursAtScope,
} from "../../lib/api";
import { SAMPLES_ON } from "../fixtures";
import {
  sampleAddHoliday,
  sampleDeleteHoliday,
  sampleHolidays,
  samplePolicyAt,
  sampleResetPolicyAt,
  sampleResetWorkHours,
  sampleSavePolicyAt,
  sampleSaveWorkHours,
  sampleWorkHours,
} from "../fixtures/workRules";

const onSample = { hours: false, holidays: false, policy: false };

/** The backend doesn't have this endpoint (or this method) yet. */
function missing(err: unknown): boolean {
  return SAMPLES_ON && err instanceof ApiError && (err.status === 404 || err.status === 405);
}

async function tryReal<T>(area: keyof typeof onSample, real: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  if (onSample[area]) return fallback();
  try {
    return await real();
  } catch (err) {
    if (!missing(err)) throw err;
    onSample[area] = true;
    return fallback();
  }
}

export function loadWorkHours(scope: RulesScope, parent: RulesScope | null, signal?: AbortSignal): Promise<WorkHoursAtScope> {
  return tryReal("hours", () => getWorkHours(scope, signal), () => sampleWorkHours(scope, parent, signal));
}

export function putWorkHours(scope: RulesScope, parent: RulesScope | null, patch: Partial<WorkHours>): Promise<WorkHoursAtScope> {
  return tryReal("hours", () => saveWorkHours(scope, patch), () => sampleSaveWorkHours(scope, parent, patch));
}

export function dropWorkHours(scope: RulesScope): Promise<void> {
  return tryReal("hours", () => resetWorkHours(scope), () => sampleResetWorkHours(scope));
}

export function loadHolidays(signal?: AbortSignal): Promise<Holiday[]> {
  return tryReal("holidays", () => listHolidays(signal), () => sampleHolidays(signal)).then((list) =>
    [...list].sort((a, b) => a.date.localeCompare(b.date)),
  );
}

export function createHoliday(input: { name: string; date: string }): Promise<Holiday> {
  return tryReal("holidays", () => addHoliday(input), () => sampleAddHoliday(input));
}

export function removeHoliday(id: number): Promise<void> {
  return tryReal("holidays", () => deleteHoliday(id), () => sampleDeleteHoliday(id));
}

/** The protection policy at a scope. A pre-v1.4 backend answers a scoped GET with the company policy and no `own`. */
export async function loadPolicyAt(scope: RulesScope, parent: RulesScope | null, signal?: AbortSignal): Promise<PolicyAtScope> {
  if (onSample.policy && scope !== "company") return samplePolicyAt(await getPolicy(signal), scope, parent);
  const at = await getPolicyAt(scope, signal);
  if (at.own !== null || scope === "company" || !SAMPLES_ON) return { ...at, own: Boolean(at.own) };
  onSample.policy = true;
  return samplePolicyAt(at.policy, scope, parent);
}

export async function savePolicyAt(scope: RulesScope, parent: RulesScope | null, patch: PolicyUpdate): Promise<PolicyAtScope> {
  if (onSample.policy && scope !== "company") return sampleSavePolicyAt(await getPolicy(), scope, parent, patch);
  const at = await updatePolicyAt(scope, patch);
  return { ...at, own: Boolean(at.own) };
}

export function dropPolicyAt(scope: RulesScope): Promise<void> {
  if (onSample.policy) return sampleResetPolicyAt(scope);
  return resetPolicyAt(scope);
}
