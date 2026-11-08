/**
 * The Rules page draft: one flat object of every protection setting on the board, built from the real policy at
 * the picked scope (GET devices/policy/?scope=) plus the sample extras (fixtures/rules.ts). Save sends only the
 * policy blocks that changed (PUT devices/policy/, or PATCH ?scope= for a department / PC) and stores the extras.
 * Work hours save on their own, at once (rules/useWorkHours.ts).
 * Production builds (SAMPLES_ON off): the extras are neutral, so the draft is exactly the real policy.
 */
import { type Policy, type PolicyUpdate, type UsbMode, type WebCategory } from "../../lib/api";
import { SAMPLES_ON } from "../fixtures";
import type { RulesExtras } from "../fixtures/rules";
import { normalizeExe } from "../features/policyText";
import { KNOWN_REMOTE_TOOLS, knownTool } from "../features/remoteTools";

export const MB = 1_048_576;
export const GB = 1024 * MB;

export type WebChoice = "off" | "watch" | "block";
export type ToolMode = "block" | "watch" | "allow";
/** Switched on for the owner the first time they choose blocking, if no list is on yet. */
export const DEFAULT_LISTS: readonly WebCategory[] = ["adult", "gambling", "malware", "phishing"];

/** Remote-control tools Zinwe knows (board RSEED). `agent` = the name the Zinwe app matches (blocked_tools). */
export const REMOTE_SEED: ReadonlyArray<{ id: string; name: string; agent: string; what: string }> = [
  { id: "anydesk", name: "AnyDesk", agent: "AnyDesk", what: "Remote desktop app, often used for support calls." },
  { id: "teamviewer", name: "TeamViewer", agent: "TeamViewer", what: "Remote control and file transfer between PCs." },
  { id: "ultraviewer", name: "UltraViewer", agent: "UltraViewer", what: "Free remote desktop app, common in India." },
  { id: "rustdesk", name: "RustDesk", agent: "RustDesk", what: "Open-source remote desktop." },
  { id: "crd", name: "Chrome Remote Desktop", agent: "Chrome Remote Desktop", what: "Google’s remote access through Chrome." },
  { id: "splashtop", name: "Splashtop", agent: "Splashtop", what: "Remote access for work and IT support." },
  { id: "supremo", name: "Supremo", agent: "Supremo", what: "Remote desktop that runs without installing." },
  { id: "aeroadmin", name: "AeroAdmin", agent: "AeroAdmin", what: "Portable remote desktop, no install needed." },
  { id: "ammyy", name: "Ammyy Admin", agent: "Ammyy Admin", what: "Older portable remote-control tool." },
  { id: "logmein", name: "LogMeIn", agent: "LogMeIn", what: "Remote access for businesses." },
  { id: "zohoassist", name: "Zoho Assist", agent: "Zoho Assist", what: "Remote support tool for help desks." },
  {
    id: "quickassist",
    name: "Windows Quick Assist",
    agent: "Quick Assist",
    // "Allowed" is a sample-only mode (fixtures/rules.ts); production builds only have Block and Watch.
    what: SAMPLES_ON ? "Built into Windows. Allowed so IT can help; sessions are still recorded." : "Built into Windows, often used by IT to help.",
  },
];

export interface ToolRow {
  id: string;
  name: string;
  /** Name sent in blocked_tools. */
  agent: string;
  what: string;
  mode: ToolMode;
  custom: boolean;
  /** Custom tools: the app file, "tool.exe" ("" = none). */
  exe: string;
}

export interface RulesDraft {
  web: WebChoice;
  cats: WebCategory[];
  sites: string[];
  /** Site ids (a name, or "h:…" for a hidden name). */
  allow: string[];
  usb: UsbMode;
  names: boolean;
  usbBytes: number;
  lanBytes: number;
  emailBytes: number;
  upBytes: number;
  usbLock: boolean;
  tools: ToolRow[];
  soft: boolean;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function toolId(name: string): string {
  return `c-${name.toLowerCase().replace(/[^a-z0-9.]+/g, "-")}`;
}

/** The draft as saved: the policy plus the extras. */
export function draftFrom(policy: Policy, extras: RulesExtras): RulesDraft {
  const rs = policy.remote_software;
  const blocking = rs.enabled && rs.blocking_enabled;
  const isBlocked = (agent: string) => blocking && rs.blocked_tools.some((t) => same(t, agent));
  const modeOf = (agent: string): ToolMode =>
    isBlocked(agent) ? "block" : extras.allowTools.some((t) => same(t, agent)) ? "allow" : "watch";

  const tools: ToolRow[] = REMOTE_SEED.filter((t) => !extras.removedTools.includes(t.id)).map((t) => ({
    ...t,
    mode: modeOf(t.agent),
    custom: false,
    exe: "",
  }));
  const listed = (agent: string) => tools.some((t) => same(t.agent, agent));
  // Blocked names the board doesn't list: a tool the app knows, or one the owner typed.
  for (const name of rs.blocked_tools) {
    if (listed(name) || REMOTE_SEED.some((t) => same(t.agent, name) && extras.removedTools.includes(t.id))) continue;
    const known = KNOWN_REMOTE_TOOLS.some((k) => same(k, name));
    const custom = extras.customTools.find((c) => same(c.name, name));
    tools.push({
      id: toolId(name),
      name,
      agent: name,
      what: known ? "Remote-control tool Zinwe knows." : "Added by you.",
      mode: modeOf(name),
      custom: !known,
      exe: custom?.exe ?? "",
    });
  }
  for (const c of extras.customTools) {
    if (listed(c.name)) continue;
    tools.push({ id: toolId(c.exe || c.name), name: c.name, agent: c.name, what: "Added by you.", mode: modeOf(c.name), custom: true, exe: c.exe });
  }
  // App files in the policy no custom tool accounts for.
  for (const exe of rs.extra_tool_executables) {
    const file = `${exe}.exe`;
    if (tools.some((t) => t.exe && same(normalizeExe(t.exe), exe))) continue;
    tools.push({ id: toolId(file), name: exe, agent: exe, what: "Added by you.", mode: modeOf(exe), custom: true, exe: file });
  }

  const w = policy.web;
  return {
    web: !w.enabled ? "off" : w.mode === "block" ? "block" : "watch",
    cats: [...w.categories],
    sites: [...w.custom_domains],
    allow: [...(w.allow_domains ?? [])],
    usb: policy.usb.mode,
    names: policy.data_transfer.include_details,
    usbBytes: policy.data_transfer.usb_warn_bytes,
    lanBytes: policy.data_transfer.lan_warn_bytes,
    emailBytes: policy.data_transfer.email_warn_bytes,
    upBytes: policy.data_transfer.web_upload_warn_bytes ?? GB,
    usbLock: policy.data_transfer.usb_lockdown,
    tools,
    soft: extras.softwareAlerts,
  };
}

/** How many settings differ (the board counts each setting once). */
export function changedKeys(saved: RulesDraft, d: RulesDraft): Array<keyof RulesDraft> {
  return (Object.keys(d) as Array<keyof RulesDraft>).filter((k) => JSON.stringify(saved[k]) !== JSON.stringify(d[k]));
}

/** The policy blocks to PUT (only those whose settings changed). */
export function policyPatch(policy: Policy, saved: RulesDraft, d: RulesDraft): PolicyUpdate {
  const changed = new Set(changedKeys(saved, d));
  const patch: PolicyUpdate = {};
  if (changed.has("usb")) patch.usb = { mode: d.usb };
  if (["web", "sites", "cats", "allow"].some((k) => changed.has(k as keyof RulesDraft))) {
    patch.web = {
      enabled: d.web !== "off",
      mode: d.web === "off" ? policy.web.mode : d.web === "block" ? "block" : "monitor",
      categories: [...d.cats],
      custom_domains: [...d.sites],
      allow_domains: [...d.allow],
    };
  }
  if (["names", "usbBytes", "lanBytes", "emailBytes", "upBytes", "usbLock"].some((k) => changed.has(k as keyof RulesDraft))) {
    patch.data_transfer = {
      ...policy.data_transfer,
      include_details: d.names,
      usb_warn_bytes: d.usbBytes,
      lan_warn_bytes: d.lanBytes,
      email_warn_bytes: d.emailBytes,
      web_upload_warn_bytes: d.upBytes,
      usb_lockdown: d.usbLock,
    };
  }
  const remoteOf = (x: RulesDraft) => ({
    blocked: x.tools.filter((t) => t.mode === "block").map((t) => t.agent),
    exes: x.tools.filter((t) => t.custom && t.exe).map((t) => normalizeExe(t.exe)),
  });
  if (JSON.stringify(remoteOf(saved)) !== JSON.stringify(remoteOf(d))) {
    const r = remoteOf(d);
    const watched = d.tools.some((t) => t.mode !== "allow") || r.exes.length > 0;
    patch.remote_software = {
      enabled: policy.remote_software.enabled || watched,
      blocking_enabled: r.blocked.length > 0,
      blocked_tools: r.blocked,
      extra_tool_executables: r.exes,
    };
  }
  return patch;
}

/** The extras to store after a save. */
export function extrasFrom(d: RulesDraft): RulesExtras {
  return {
    softwareAlerts: d.soft,
    allowTools: d.tools.filter((t) => t.mode === "allow").map((t) => t.agent),
    customTools: d.tools.filter((t) => t.custom).map((t) => ({ name: t.name, exe: t.exe })),
    removedTools: REMOTE_SEED.filter((s) => !d.tools.some((t) => t.id === s.id)).map((s) => s.id),
  };
}

/** A typed tool name matched to one the app knows ("anydesk" → "AnyDesk"), else as typed. */
export function agentName(raw: string): string {
  return knownTool(raw) ?? raw.trim().replace(/\s+/g, " ");
}
