/**
 * v1.4 Rules sample data (Kitecrest demo): work hours per scope, holidays, protection overrides per department
 * / PC, and (v1.4.1) leave requests waiting in Overview → Needs you. Used ONLY when samples are on (dev server,
 * VITE_SAMPLE_DATA=1) AND the backend doesn't serve the v1.4 endpoints yet (404 / 405, or a policy answer with no
 * `own`), so the Rules screens work on a backend from before v1.4. With the v1.4 backend every call is real. Production builds never read this.
 *
 * Same rules as the server (brief §1c): effective = company ← department ← PC; a department / PC keeps only what it
 * overrides; DELETE drops its row.
 */
import {
  WORK_HOURS_DEFAULTS,
  type Holiday,
  type Leave,
  type Member,
  type Policy,
  type PolicyAtScope,
  type PolicyUpdate,
  type RulesScope,
  type WorkHours,
  type WorkHoursAtScope,
} from "../../lib/api";
import { sample, sampleStore } from "./index";

interface HoursState {
  company: WorkHours;
  /** Department / PC overrides. */
  own: Partial<Record<RulesScope, Partial<WorkHours>>>;
}

const hoursStore = sampleStore<HoursState>("rules.hours", () => ({
  company: { ...WORK_HOURS_DEFAULTS },
  own: {
    "department:developer": { start: "11:00", end: "20:00", days: "1111100" },
    "department:accounts": { start: "09:30", end: "18:30" },
  },
}));

const holidayStore = sampleStore<Holiday[]>("rules.holidays", () => [
  { id: 1, name: "Diwali", date: "2026-10-20" },
  { id: 2, name: "Christmas", date: "2026-12-25" },
  { id: 3, name: "Republic Day", date: "2027-01-26" },
]);

const policyStore = sampleStore<Partial<Record<RulesScope, PolicyUpdate>>>("rules.policyOwn", () => ({}));

/** The chain from the company down to `scope` (`parent` = the scope one level up, for a PC). */
function chain(scope: RulesScope, parent: RulesScope | null): RulesScope[] {
  if (scope === "company") return [];
  if (scope.startsWith("department:")) return [scope];
  return parent && parent !== "company" ? [parent, scope] : [scope];
}

function hoursAt(st: HoursState, scope: RulesScope, parent: RulesScope | null): WorkHoursAtScope {
  const effective = { ...st.company };
  for (const s of chain(scope, parent)) Object.assign(effective, st.own[s] ?? {});
  const own = scope === "company" || Boolean(st.own[scope]);
  return { effective, own, fields: scope === "company" ? { ...st.company } : { ...(st.own[scope] ?? {}) } };
}

export function sampleWorkHours(scope: RulesScope, parent: RulesScope | null, signal?: AbortSignal): Promise<WorkHoursAtScope> {
  return sample(hoursAt(hoursStore.get(), scope, parent), signal);
}

export function sampleSaveWorkHours(scope: RulesScope, parent: RulesScope | null, patch: Partial<WorkHours>): Promise<WorkHoursAtScope> {
  const st = structuredClone(hoursStore.get());
  if (scope === "company") st.company = { ...st.company, ...patch };
  else st.own[scope] = { ...(st.own[scope] ?? {}), ...patch };
  hoursStore.set(st);
  return sample(hoursAt(st, scope, parent), undefined, 120);
}

export function sampleResetWorkHours(scope: RulesScope): Promise<void> {
  const st = structuredClone(hoursStore.get());
  delete st.own[scope];
  hoursStore.set(st);
  return sample(undefined, undefined, 120);
}

export function sampleHolidays(signal?: AbortSignal): Promise<Holiday[]> {
  return sample([...holidayStore.get()].sort((a, b) => a.date.localeCompare(b.date)), signal);
}

export function sampleAddHoliday(input: { name: string; date: string }): Promise<Holiday> {
  const list = holidayStore.get();
  const h: Holiday = { id: Math.max(0, ...list.map((x) => x.id)) + 1, ...input };
  holidayStore.set([...list, h]);
  return sample(h, undefined, 120);
}

export function sampleDeleteHoliday(id: number): Promise<void> {
  holidayStore.set(holidayStore.get().filter((h) => h.id !== id));
  return sample(undefined, undefined, 120);
}

/** Merge a policy override block by block (each block replaced field by field). */
function mergePolicy(base: Policy, over: PolicyUpdate | undefined): Policy {
  if (!over) return base;
  return {
    ...base,
    usb: over.usb ? { ...base.usb, ...over.usb } : base.usb,
    web: over.web ? { ...base.web, ...over.web } : base.web,
    data_transfer: over.data_transfer ? { ...base.data_transfer, ...over.data_transfer } : base.data_transfer,
    remote_software: over.remote_software ? { ...base.remote_software, ...over.remote_software } : base.remote_software,
  };
}

function policyAt(company: Policy, scope: RulesScope, parent: RulesScope | null): PolicyAtScope {
  const own = policyStore.get();
  let p = company;
  for (const s of chain(scope, parent)) p = mergePolicy(p, own[s]);
  return { policy: structuredClone(p), own: scope !== "company" && Boolean(own[scope]) };
}

/** The real company policy with this scope's sample overrides on top. */
export function samplePolicyAt(company: Policy, scope: RulesScope, parent: RulesScope | null): PolicyAtScope {
  return policyAt(company, scope, parent);
}

export function sampleSavePolicyAt(company: Policy, scope: RulesScope, parent: RulesScope | null, patch: PolicyUpdate): Promise<PolicyAtScope> {
  const own = structuredClone(policyStore.get());
  const cur = own[scope] ?? {};
  own[scope] = { ...cur, ...patch };
  policyStore.set(own);
  return sample(policyAt(company, scope, parent), undefined, 120);
}

export function sampleResetPolicyAt(scope: RulesScope): Promise<void> {
  const own = structuredClone(policyStore.get());
  delete own[scope];
  policyStore.set(own);
  return sample(undefined, undefined, 120);
}

/** `n` days ahead as "YYYY-MM-DD" (local). */
function daysAhead(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const leaveStore = sampleStore<Leave[] | null>("rules.leave", () => null);

/** Waiting leave requests, laid onto the real team (the second person asks for a half day, the third for a day). */
export function sampleLeave(members: readonly Member[] | undefined, signal?: AbortSignal): Promise<Leave[]> {
  let list = leaveStore.get();
  if (!list) {
    const team = (members ?? []).filter((m) => m.is_active);
    if (!team.length) return sample([], signal);
    const a = team[1] ?? team[0];
    const b = team[2];
    const at = new Date(Date.now() - 2 * 3_600_000).toISOString();
    list = [
      { id: 9001, member_id: a.id, member_name: a.name, date: daysAhead(4), half: true, status: "requested", note: "Doctor’s appointment in the morning", created_at: at, decided_at: null },
      ...(b ? [{ id: 9002, member_id: b.id, member_name: b.name, date: daysAhead(9), half: false, status: "requested" as const, note: "Family function", created_at: at, decided_at: null }] : []),
    ];
    leaveStore.set(list);
  }
  return sample(list.filter((l) => l.status === "requested"), signal);
}

export function sampleDecideLeave(id: number, decision: "approve" | "decline"): Promise<Leave> {
  const list = leaveStore.get() ?? [];
  const at = new Date().toISOString();
  const next = list.map((l) => (l.id === id ? { ...l, status: decision === "approve" ? ("approved" as const) : ("declined" as const), decided_at: at } : l));
  leaveStore.set(next);
  const one = next.find((l) => l.id === id);
  if (!one) return Promise.reject(new Error("That request wasn't found."));
  return sample(one, undefined, 120);
}
