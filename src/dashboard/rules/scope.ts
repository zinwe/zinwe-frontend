/**
 * "These rules apply to" (boards DashRules / DashRulesHours, logic/rules_hours.js): who the rules on a Rules tab are
 * for. Everyone at the company, one department (the person's tag on the Team page = Member.role), or one PC.
 * Rules flow company ← department ← PC.
 */
import { MEMBER_ROLES, type Device, type Member, type MemberRole, type RulesScope } from "../../lib/api";

/** A role read as a department name ("developer" → "Development"), as the board names them. */
export const DEPT_LABEL: Record<MemberRole, string> = {
  developer: "Development",
  designer: "Design",
  sales: "Sales",
  support: "Support",
  accounts: "Accounts",
  operations: "Operations",
  management: "Management",
  other: "Other",
};

export interface DeptOption {
  scope: RulesScope;
  role: MemberRole;
  name: string;
  /** "Priya, Emily, Sneha". */
  who: string;
}

export interface PcOption {
  scope: RulesScope;
  deviceId: number;
  host: string;
  /** The person on that PC ("" when it isn't linked to anyone). */
  person: string;
  /** Their department, when they have a tag. */
  role: MemberRole | null;
}

export interface ScopeOptions {
  depts: DeptOption[];
  pcs: PcOption[];
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** The departments people are tagged with (Team page order), and every PC that's still enrolled. */
export function scopeOptions(members: readonly Member[] | undefined, devices: readonly Device[] | undefined): ScopeOptions {
  const active = (members ?? []).filter((m) => m.is_active);
  const depts: DeptOption[] = [];
  for (const { value } of MEMBER_ROLES) {
    const people = active.filter((m) => m.role === value);
    if (!people.length) continue;
    depts.push({ scope: `department:${value}`, role: value, name: DEPT_LABEL[value], who: people.map((m) => firstName(m.name)).join(", ") });
  }
  const roleOf = new Map(active.map((m) => [m.id, m.role || null]));
  const pcs: PcOption[] = (devices ?? [])
    .filter((d) => !d.is_revoked)
    .map((d) => ({
      scope: `device:${d.id}` as RulesScope,
      deviceId: d.id,
      host: d.hostname,
      person: d.member_name ?? "",
      role: (d.member_id != null ? roleOf.get(d.member_id) : null) ?? null,
    }))
    .sort((a, b) => a.host.localeCompare(b.host));
  return { depts, pcs };
}

export type ScopeKind = "company" | "department" | "device";

export function scopeKind(scope: RulesScope): ScopeKind {
  return scope === "company" ? "company" : scope.startsWith("department:") ? "department" : "device";
}

/** A valid scope from a link / stored value, else the company. */
export function parseScope(raw: string | null | undefined): RulesScope {
  if (!raw) return "company";
  const dept = /^department:([a-z]+)$/.exec(raw);
  if (dept && MEMBER_ROLES.some((r) => r.value === dept[1])) return raw as RulesScope;
  return /^device:\d+$/.test(raw) ? (raw as RulesScope) : "company";
}

/** The scope one level up: a PC → its department (or the company), a department → the company. */
export function parentScope(scope: RulesScope, opts: ScopeOptions): RulesScope | null {
  if (scope === "company") return null;
  if (scope.startsWith("department:")) return "company";
  const pc = opts.pcs.find((p) => p.scope === scope);
  return pc?.role ? `department:${pc.role}` : "company";
}

/** What the scope is called in its lines ("KC-DEV-01 · Karan Malhotra", "Development"). */
export function scopeName(scope: RulesScope, opts: ScopeOptions): string {
  if (scope === "company") return "Everyone";
  const dept = opts.depts.find((d) => d.scope === scope);
  if (dept) return dept.name;
  if (scope.startsWith("department:")) return DEPT_LABEL[scope.slice(11) as MemberRole] ?? "This department";
  const pc = opts.pcs.find((p) => p.scope === scope);
  return pc ? (pc.person ? `${pc.host} · ${pc.person}` : pc.host) : "This PC";
}

/**
 * The line beside the picker (board wording). `tab`: the Work hours tab names hours, the protection tabs say
 * "on this tab". `parentOwn`: for a PC, whether its department has its own rules (then it follows the department).
 */
export function scopeLine(scope: RulesScope, own: boolean, opts: ScopeOptions, tab: "hours" | "protection", parentOwn = false): string {
  if (scope === "company") return "Company rules. Pick a department or one PC to give it its own.";
  const name = scopeName(scope, opts);
  if (scopeKind(scope) === "device") {
    if (own) return `${name} has its own rules${tab === "protection" ? " on this tab" : ""}. Anything you change here applies only to this PC.`;
    const pc = opts.pcs.find((p) => p.scope === scope);
    const above = pc?.role && parentOwn ? `the ${DEPT_LABEL[pc.role]}` : "the company";
    return `${name} follows ${above} rules. Change anything here and it applies only to this PC.`;
  }
  if (own)
    return tab === "hours"
      ? `${name} has its own hours. Anything you change here applies to every ${name} PC.`
      : `${name} has its own rules on this tab. Anything you change here applies to every ${name} PC.`;
  return `${name} follows the company rules. Change anything here and it applies to every ${name} PC.`;
}

/** The toast after "Reset to company rules": a PC goes back to its department's rules when it has a department. */
export function resetLine(scope: RulesScope, opts: ScopeOptions): string {
  const pc = opts.pcs.find((p) => p.scope === scope);
  return `Back to the ${pc?.role ? "department" : "company"} rules.`;
}

/** Where a saved change goes ("every PC", "that PC", "their PCs"), for "Saved. Reaches … within a minute." */
export function reachLine(scope: RulesScope): string {
  const k = scopeKind(scope);
  return `Saved. Reaches ${k === "company" ? "every PC" : k === "device" ? "that PC" : "their PCs"} within a minute.`;
}
