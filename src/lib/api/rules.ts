import { authedRequest } from "./http";
import { normalizePolicy, type MemberRole, type Policy, type PolicyUpdate } from "./devices";

/**
 * v1.4 Rules (brief §1c): work hours, breaks and how a day counts, per scope; holidays; leave decisions; and the
 * protection policy at a scope. Everything is under /api/devices/.
 *
 * A scope is who a rule is for: the whole company, one department (a member's role on the Team page) or one PC.
 * Rules flow company ← department ← PC: a department or PC row holds only what it overrides; the rest comes from
 * the level above. Old agents and the old web build keep using GET/PUT devices/policy/ (= the company scope).
 */
export type RulesScope = "company" | `department:${MemberRole}` | `device:${number}`;

/** Work hours, breaks and day counting (WorkSchedule). Times are "HH:MM" (24 h); `days` is Mon..Sun as "1111110". */
export interface WorkHours {
  days: string;
  start: string;
  end: string;
  late_grace_min: number;
  /** Lunch and short breaks together, per day. */
  break_allowed_min: number;
  /** Ask for the owner's OK on one break longer than this; 0 = never ask. */
  break_ok_over_min: number;
  /** A quiet note in the person's Zinwe app before and when they reach break_allowed_min. */
  tell_member_over: boolean;
  /** Also show it in the owner's Needs you. */
  tell_owner_over: boolean;
  /** Ask for the owner's OK when someone presses End day before `end` on a working day. */
  ok_early_end: boolean;
  full_day_hours: number;
  /** Start day after this = a half day. */
  half_start_after: string;
  /** End day before this = a half day. */
  half_end_before: string;
}

export type WorkHoursField = keyof WorkHours;

/** GET rules/hours/?scope= — the rules that apply at that scope, and what this scope sets itself. */
export interface WorkHoursAtScope {
  /** company ← department ← PC, merged. */
  effective: WorkHours;
  /** This scope has its own row (a department or PC with overrides; always true for the company). */
  own: boolean;
  /** What this scope sets itself (null / missing = inherited). The company sets everything. */
  fields: Partial<Record<WorkHoursField, WorkHours[WorkHoursField] | null>>;
}

/** The company defaults the backend creates lazily (brief §1c). */
export const WORK_HOURS_DEFAULTS: WorkHours = {
  days: "1111110",
  start: "10:00",
  end: "19:00",
  late_grace_min: 15,
  break_allowed_min: 75,
  break_ok_over_min: 45,
  tell_member_over: true,
  tell_owner_over: true,
  ok_early_end: true,
  full_day_hours: 8,
  half_start_after: "13:00",
  half_end_before: "14:00",
};

function normalizeHours(raw: WorkHoursAtScope): WorkHoursAtScope {
  return {
    effective: { ...WORK_HOURS_DEFAULTS, ...(raw.effective ?? {}) },
    own: Boolean(raw.own),
    fields: raw.fields ?? {},
  };
}

/** GET /api/devices/rules/hours/?scope= */
export async function getWorkHours(scope: RulesScope, signal?: AbortSignal): Promise<WorkHoursAtScope> {
  return normalizeHours(await authedRequest<WorkHoursAtScope>("/api/devices/rules/hours/", { query: { scope }, signal }));
}

/** PUT /api/devices/rules/hours/?scope= — set these fields at this scope (a department / PC row is made if needed). */
export async function saveWorkHours(scope: RulesScope, patch: Partial<WorkHours>): Promise<WorkHoursAtScope> {
  return normalizeHours(await authedRequest<WorkHoursAtScope>("/api/devices/rules/hours/", { method: "PUT", query: { scope }, body: patch }));
}

/** DELETE /api/devices/rules/hours/?scope= — drop this department's / PC's own hours (back to the level above). Reload after. */
export async function resetWorkHours(scope: RulesScope): Promise<void> {
  await authedRequest<unknown>("/api/devices/rules/hours/", { method: "DELETE", query: { scope } });
}

/** A company holiday: reports count it as Holiday, never Absent. `date` is "YYYY-MM-DD". */
export interface Holiday {
  id: number;
  name: string;
  date: string;
}

/** GET /api/devices/rules/holidays/ — oldest first. */
export function listHolidays(signal?: AbortSignal): Promise<Holiday[]> {
  return authedRequest<Holiday[]>("/api/devices/rules/holidays/", { signal });
}

/** POST /api/devices/rules/holidays/ */
export function addHoliday(input: { name: string; date: string }): Promise<Holiday> {
  return authedRequest<Holiday>("/api/devices/rules/holidays/", { method: "POST", body: input });
}

/** DELETE /api/devices/rules/holidays/?id= */
export async function deleteHoliday(id: number): Promise<void> {
  await authedRequest<unknown>("/api/devices/rules/holidays/", { method: "DELETE", query: { id } });
}

export type LeaveStatus = "requested" | "approved" | "declined";

/** A day (or half day) off a person asked for in their Zinwe app. */
export interface Leave {
  id: number;
  member_id: number;
  member_name?: string;
  date: string;
  half: boolean;
  status: LeaveStatus;
  note: string;
}

/** POST /api/devices/leave/<id>/decision/ — approve or decline a leave request (shown in Overview → Needs you). */
export function decideLeave(id: number, decision: "approve" | "decline"): Promise<Leave> {
  return authedRequest<Leave>(`/api/devices/leave/${id}/decision/`, { method: "POST", body: { decision } });
}

/** The protection policy at a scope: the effective rules there, plus whether this scope overrides anything. */
export interface PolicyAtScope {
  policy: Policy;
  /** A department / PC with its own protection rules (always false for the company). null = the server didn't say
   *  (a backend from before v1.4, which has no per-scope rules). */
  own: boolean | null;
}

function scopedPolicy(raw: Policy & { own?: boolean; policy?: Policy }, scope: RulesScope): PolicyAtScope {
  // Accept both {…policy, own} and {policy: {…}, own}.
  const body = raw.policy ?? raw;
  return { policy: normalizePolicy(body), own: scope === "company" ? false : typeof raw.own === "boolean" ? raw.own : null };
}

/**
 * GET /api/devices/policy/?scope= — the protection rules that apply at that scope (company ← department ← PC).
 * The company scope uses the plain GET every older build uses.
 */
export async function getPolicyAt(scope: RulesScope, signal?: AbortSignal): Promise<PolicyAtScope> {
  const raw = await authedRequest<Policy & { own?: boolean }>("/api/devices/policy/", { query: scope === "company" ? {} : { scope }, signal });
  return scopedPolicy(raw, scope);
}

/**
 * Change the protection rules at a scope. Company: PUT devices/policy/ (as before). A department or PC: PATCH
 * devices/policy/?scope=, which writes that scope's override. Either way only the changed blocks are sent.
 */
export async function updatePolicyAt(scope: RulesScope, patch: PolicyUpdate): Promise<PolicyAtScope> {
  const raw =
    scope === "company"
      ? await authedRequest<Policy & { own?: boolean }>("/api/devices/policy/", { method: "PUT", body: patch })
      : await authedRequest<Policy & { own?: boolean }>("/api/devices/policy/", { method: "PATCH", query: { scope }, body: patch });
  return scopedPolicy(scope === "company" ? raw : { ...raw, own: raw.own ?? true }, scope);
}

/** DELETE /api/devices/policy/?scope= — a department / PC goes back to the rules above it. Reload after. */
export async function resetPolicyAt(scope: RulesScope): Promise<void> {
  await authedRequest<unknown>("/api/devices/policy/", { method: "DELETE", query: { scope } });
}
