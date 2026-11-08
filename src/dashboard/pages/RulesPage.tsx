import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type ReactElement } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../auth/authContext";
import { usePageMeta } from "../../hooks/usePageMeta";
import { errorMessage, listDevices, type PolicyAtScope, type RulesScope, type UsbMode } from "../../lib/api";
import { Toast, type ToastTone } from "../components/Toast";
import { useEntitlements } from "../features/entitlements";
import { SAMPLES_ON } from "../fixtures";
import { getRulesExtras, saveRulesExtras, type RulesExtras } from "../fixtures/rules";
import { hoursPill } from "../rules/hoursModel";
import {
  changedKeys,
  draftFrom,
  extrasFrom,
  GB,
  MB,
  policyPatch,
  REMOTE_SEED,
  agentName,
  toolId,
  type RulesDraft,
  type ToolMode,
} from "../rules/model";
import { Card, Def, OptCard, SizeField, SwitchRow } from "../rules/parts";
import { PlanNote } from "../rules/PlanNote";
import { dropPolicyAt, loadPolicyAt, loadWorkHours, savePolicyAt } from "../rules/rulesData";
import { parentScope, parseScope, reachLine, resetLine, scopeKind, scopeLine, scopeName, scopeOptions } from "../rules/scope";
import { ScopeBar } from "../rules/ScopeBar";
import { useLeaveGuard } from "../rules/useLeaveGuard";
import { useWorkHours } from "../rules/useWorkHours";
import { WebsitesTab } from "../rules/WebsitesTab";
import { WorkHoursTab } from "../rules/WorkHoursTab";
import { PageHead } from "../shell/PageHead";
import { useShell } from "../shell/shellContext";
import { ErrorBlock, Sheet, Sk } from "../ui/States";
import { useTip } from "../ui/useTip";
import { useResource } from "../useResource";
import "../../styles/dash13/rules.css";
import "../../styles/dash13/rules-hours.css";

const ALL_TABS: ReadonlyArray<[string, string]> = [
  ["hours", "Work hours"],
  ["web", "Websites"],
  ["usb", "USB & files"],
  ["limits", "Share limits"],
  ["remote", "Remote tools"],
  ["software", "Software"],
];
/** Software (new-software alerts) holds only a setting the policy API doesn't save yet (fixtures/rules.ts): production
 *  builds (SAMPLES_ON off) leave it out. Work hours is real since v1.4 (rules/hours/). */
const TABS = SAMPLES_ON ? ALL_TABS : ALL_TABS.filter(([k]) => k !== "software");
const TAB_ALIAS: Record<string, string> = {
  websites: "web",
  files: "usb",
  remotes: "remote",
  tools: "remote",
  apps: "remote",
  soft: "software",
  work: "hours",
  breaks: "hours",
};
const ALL_MODES: ReadonlyArray<[ToolMode, string]> = [
  ["block", "Block"],
  ["watch", "Watch"],
  ["allow", "Allow"],
];
/** Allow (no alert) is sample-only: the policy API only knows blocked or not. */
const MODES = SAMPLES_ON ? ALL_MODES : ALL_MODES.filter(([k]) => k !== "allow");
const EXE_RE = /^[^\\/:*?"<>|\s][^\\/:*?"<>|]*\.exe$/i;
const LEDE = "Every protection in one place. Changes reach every PC within about a minute and keep working offline. Employees see the active rules in their Zinwe window.";
const USB_MODES = { allow: "Allow", read_only: "Read-only", block: "Block" } as const;
const WEB_STATES = { off: "Off", watch: "Watch only", block: "Block & watch" } as const;

/** Page names for the leave guard ("2 changes to leave for Alerts"). */
const PAGE_NAMES: ReadonlyArray<[string, string]> = [
  ["/app/alerts", "Alerts"],
  ["/app/activity", "Activity"],
  ["/app/internet", "Internet usage"],
  ["/app/data", "Data safety"],
  ["/app/remote", "Apps & remote tools"],
  ["/app/team", "Team & PCs"],
  ["/app/chat", "Chat"],
  ["/app/tasks", "Tasks"],
  ["/app/reports", "Reports"],
  ["/app/settings", "Settings"],
  ["/app/help", "Help & support"],
];
function pageName(path: string): string | null {
  const p = path.split(/[?#]/)[0].replace(/\/+$/, "");
  if (p === "/app") return "Overview";
  return PAGE_NAMES.find(([k]) => p === k || p.startsWith(`${k}/`))?.[1] ?? null;
}
/** The tab a /app/rules#limits (or #section=limits) link asks for, if it is one. */
function tabOf(hash: string): string | null {
  const raw = hash.replace(/^#/, "").toLowerCase();
  if (!raw) return null;
  const id0 = new URLSearchParams(raw).get("section") ?? raw.split("&")[0];
  const id = TAB_ALIAS[id0] ?? id0;
  return TABS.some(([k]) => k === id) ? id : null;
}
/** #scope=device:12 (or department:developer) in a link opens the rules of that PC / department. */
function scopeOfHash(hash: string): RulesScope {
  return parseScope(new URLSearchParams(hash.replace(/^#/, "")).get("scope"));
}

/** A loaded scope's protection rules and sample extras, tagged with the scope they're for. */
interface LoadedPolicy {
  scope: RulesScope;
  at: PolicyAtScope;
  extras: RulesExtras;
}

/**
 * Rules (boards DashRules, DashRulesHours): every protection in one place, one tab at a time — work hours, websites,
 * USB & files, share limits, remote tools (plus software where samples are on). "These rules apply to" picks who:
 * everyone at the company, one department (the Team page tag) or one PC; rules flow company ← department ← PC, and a
 * department / PC with its own rules can be reset. Protection changes are drafted and go out together with "Save and
 * send to PCs" (only the blocks that changed, at the picked scope). Work hours save at once. Leaving with unsaved
 * changes asks first (links, Back, reload), and so does picking another scope. Links: /app/rules#limits (or
 * #section=limits) opens that tab; #scope=device:<id> opens that PC's rules.
 */
export default function RulesPage(): ReactElement {
  usePageMeta({ title: "Rules — Zinwe", description: "Every protection in one place." });
  const { account } = useAuth();
  const companyName = account?.company?.name || "your company";
  const { members } = useShell();
  const { has } = useEntitlements();
  const tip = useTip();
  const { hash } = useLocation();

  const loadDevices = useCallback((signal: AbortSignal) => listDevices(signal), []);
  const devices = useResource(loadDevices);
  const opts = useMemo(() => scopeOptions(members, devices.data), [members, devices.data]);
  const [scope, setScope] = useState<RulesScope>(() => scopeOfHash(hash));
  const parent = parentScope(scope, opts);
  const kind = scopeKind(scope);

  const loadPolicy = useCallback(
    async (signal: AbortSignal): Promise<LoadedPolicy> => {
      const [at, extras] = await Promise.all([loadPolicyAt(scope, parent, signal), getRulesExtras(signal, scope)]);
      return { scope, at, extras };
    },
    [scope, parent],
  );
  const policy = useResource(loadPolicy);
  const fresh = policy.data?.scope === scope ? policy.data : undefined;

  // A PC that follows its department: does the department have its own rules (the line then names it)?
  const loadParentOwn = useCallback(
    async (signal: AbortSignal) => {
      if (kind !== "device" || !parent || parent === "company") return { policy: false, hours: false };
      const [pol, hrs] = await Promise.all([loadPolicyAt(parent, "company", signal), loadWorkHours(parent, "company", signal).catch(() => null)]);
      return { policy: Boolean(pol.own), hours: Boolean(hrs?.own) };
    },
    [kind, parent],
  );
  const parentOwn = useResource(loadParentOwn);

  const [toast, setToast] = useState<{ text: string; tone: ToastTone } | null>(null);
  const say = useCallback((text: string, tone: ToastTone = "success") => setToast({ text, tone }), []);
  const clearToast = useCallback(() => setToast(null), []);
  const deptScopes = useMemo(() => opts.depts.map((x) => x.scope), [opts.depts]);
  const wh = useWorkHours(scope, parent, deptScopes, say, reachLine(scope));

  const [base, setBase] = useState<LoadedPolicy | null>(null);
  const [saved, setSaved] = useState<RulesDraft | null>(null);
  const [d, setD] = useState<RulesDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [askScope, setAskScope] = useState<RulesScope | null>(null);
  const [tab, setTab] = useState(() => tabOf(hash) ?? "web");
  const [toolName, setToolName] = useState("");
  const [toolExe, setToolExe] = useState("");
  const [toolErr, setToolErr] = useState({ name: "", exe: "" });
  const [advOpen, setAdvOpen] = useState(false);
  const [rToast, setRToast] = useState("");

  // A new answer for the picked scope (first load, another scope, a save or a reset): the draft starts from it.
  if (fresh && fresh !== base) {
    setBase(fresh);
    const first = draftFrom(fresh.at.policy, fresh.extras);
    setSaved(first);
    setD(first);
  }

  useEffect(() => {
    if (!rToast) return;
    const id = window.setTimeout(() => setRToast(""), 6000);
    return () => window.clearTimeout(id);
  }, [rToast]);

  const changes = saved && d ? changedKeys(saved, d).length : 0;
  const changeWord = changes === 1 ? "change" : "changes";
  const guard = useLeaveGuard(changes > 0);

  // A link to /app/rules#limits (or #scope=…), on arrival or while already here.
  const [seenHash, setSeenHash] = useState(hash);
  if (seenHash !== hash) {
    setSeenHash(hash);
    const next = tabOf(hash);
    if (next) setTab(next);
    const sc = scopeOfHash(hash);
    if (sc !== "company" && changes === 0) setScope(sc);
  }

  /** Show a tab. The address follows without a navigation, so the leave guard's history entry stays as it is. */
  const pick = (id: string, focus = false) => {
    setTab(id);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${id}`);
    if (focus) window.setTimeout(() => document.getElementById(`tab-${id}`)?.focus(), 0);
    document.getElementById(`tab-${id}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const set = (patch: Partial<RulesDraft>) => {
    setJustSaved(false);
    setSaveErr(null);
    setD((cur) => (cur ? { ...cur, ...patch } : cur));
  };

  const save = async (): Promise<boolean> => {
    if (!saved || !d || !fresh || saving) return false;
    setSaving(true);
    setSaveErr(null);
    try {
      const patch = policyPatch(fresh.at.policy, saved, d);
      const at = Object.keys(patch).length ? await savePolicyAt(scope, parent, patch) : fresh.at;
      const extras = await saveRulesExtras(extrasFrom(d), scope);
      // The answer becomes the new base: the draft is rebuilt from it on the next render.
      policy.setData({ scope, at, extras });
      setJustSaved(true);
      return true;
    } catch (err) {
      setSaveErr(errorMessage(err));
      return false;
    } finally {
      setSaving(false);
    }
  };
  const discard = () => {
    if (saved) setD(saved);
    setSaveErr(null);
  };

  const goScope = (next: RulesScope) => {
    setAskScope(null);
    setScope(next);
    setJustSaved(false);
    setSaveErr(null);
  };
  /** Pick another scope; with unsaved protection changes, ask first. */
  const pickScope = (next: RulesScope) => {
    if (next === scope) return;
    if (changes > 0) setAskScope(next);
    else goScope(next);
  };

  const tabOwn = tab === "hours" ? Boolean(wh.at.data?.own) : Boolean(fresh?.at.own);
  const parentHas = tab === "hours" ? Boolean(parentOwn.data?.hours) : Boolean(parentOwn.data?.policy);
  const line = scopeLine(scope, tabOwn, opts, tab === "hours" ? "hours" : "protection", parentHas);
  const reset = async () => {
    if (scope === "company") return;
    if (tab === "hours") return void wh.reset(scope, resetLine(scope, opts));
    setResetting(true);
    try {
      await dropPolicyAt(scope);
      say(resetLine(scope, opts));
      setJustSaved(false);
      policy.reload();
    } catch (err) {
      say(errorMessage(err), "error");
    } finally {
      setResetting(false);
    }
  };
  const savedLine =
    kind === "company"
      ? "Saved. Every PC gets it within about a minute; a PC that's offline gets it when it's back online."
      : kind === "department"
        ? `Saved. Every ${scopeName(scope, opts)} PC gets it within about a minute; a PC that's offline gets it when it's back online.`
        : "Saved. That PC gets it within about a minute, or when it's back online.";

  if (!d || !saved || !base) {
    const err = policy.error;
    return (
      <div className="zp-rules" style={{ display: "contents" }}>
        <PageHead title="Rules" lede={LEDE} />
        {err && !policy.pending ? (
          <ErrorBlock title="We couldn't load your rules" message={errorMessage(err)} onRetry={policy.reload} />
        ) : (
          <div role="status" aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <span className="z-sr">Loading your rules…</span>
            <Sk w={420} h={34} style={{ borderRadius: 999, maxWidth: "100%" }} />
            {[0, 1, 2].map((i) => (
              <div key={i} className="z-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
                <Sk w={140} h={18} />
                <Sk w="60%" h={12} />
                <Sk h={64} style={{ borderRadius: 12 }} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const p = base.at.policy;
  // Another scope is loading (or failed to load): the rules on screen are the last scope's, so they wait.
  const stale = !fresh;

  // ---- Remote tools
  const removedSeeds = REMOTE_SEED.filter((s) => !d.tools.some((t) => t.id === s.id));
  const nOf = (m: ToolMode) => d.tools.filter((t) => t.mode === m).length;
  const setMode = (id: string, mode: ToolMode) => set({ tools: d.tools.map((x) => (x.id === id ? { ...x, mode } : x)) });
  const addTool = () => {
    const name = toolName.trim().replace(/\s+/g, " ");
    const exe = toolExe.trim();
    const err = { name: "", exe: "" };
    const lname = name.toLowerCase();
    if (!name) err.name = "Type the tool’s name.";
    else if (name.length > 40) err.name = "Keep the name under 40 characters.";
    else if (d.tools.some((t) => t.name.toLowerCase() === lname || t.agent.toLowerCase() === agentName(name).toLowerCase()))
      err.name = `${name} is already in the list.`;
    else if (removedSeeds.some((t) => t.name.toLowerCase() === lname || t.agent.toLowerCase() === agentName(name).toLowerCase()))
      err.name = `${name} is a tool Zinwe already knows. Use “Add back” above.`;
    if (exe && !EXE_RE.test(exe)) err.exe = "Use the app’s file name ending in .exe, like tool.exe (no folders).";
    else if (exe) {
      const dup = d.tools.find((t) => t.exe && t.exe.toLowerCase() === exe.toLowerCase());
      if (dup) err.exe = `${exe} is already in the list, as ${dup.name}.`;
    }
    if (err.name || err.exe) {
      setToolErr(err);
      if (!err.name && err.exe) setAdvOpen(true);
      window.setTimeout(() => document.getElementById(err.name ? "toolName" : "toolExe")?.focus(), 30);
      return;
    }
    setToolName("");
    setToolExe("");
    setToolErr({ name: "", exe: "" });
    set({ tools: [...d.tools, { id: toolId(exe || name), name, agent: agentName(name), what: "Added by you.", exe, custom: true, mode: "block" }] });
    setRToast(`${name} added as Block. Save to send it to every PC.`);
  };
  const toolKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTool();
    }
  };

  const nBlocked = nOf("block");
  const pills: Record<string, { state: string; accent: boolean }> = {
    hours: !has("work_time") ? { state: "Locked", accent: false } : { state: wh.at.data ? hoursPill(wh.at.data.effective) : "…", accent: true },
    web: !has("web") ? { state: "Locked", accent: false } : { state: WEB_STATES[d.web], accent: d.web === "block" },
    usb: { state: USB_MODES[d.usb], accent: d.usb !== "allow" },
    limits: !has("data_transfer") ? { state: "Locked", accent: false } : { state: `${Number((d.emailBytes / MB).toFixed(1))} MB email`, accent: false },
    remote: !has("remote_access") ? { state: "Locked", accent: false } : { state: `${nBlocked} blocked`, accent: nBlocked > 0 },
    software: !has("software_installs") ? { state: "Locked", accent: false } : { state: d.soft ? "On" : "Off", accent: d.soft },
  };
  const tabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.findIndex(([k]) => k === tab);
    const next = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i - 1 + TABS.length) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    pick(TABS[next][0], true);
  };

  const leaving = guard.target !== null;
  const leaveName = guard.target?.kind === "link" && pageName(guard.target.to) ? `leave for ${pageName(guard.target.to)}` : "leave this page";

  return (
    <div className={`zp-rules${changes > 0 ? " has-bar" : ""}`} style={{ display: "contents" }}>
      <PageHead title="Rules" lede={LEDE} />

      {changes > 0 ? (
        <div role="status" className="rl-savebar">
          <span>
            <b>{changes}</b> {changeWord} not saved yet{saveErr ? <span className="rl-bar-err"> · {saveErr}</span> : null}
          </span>
          <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="z-btn sm rl-ghost-dark" disabled={saving} onClick={discard}>
              Discard
            </button>
            <button type="button" className="z-btn sm pri" disabled={saving || stale} onClick={() => void save()}>
              {saving ? "Saving…" : "Save and send to PCs"}
            </button>
          </span>
        </div>
      ) : null}
      {justSaved && changes === 0 ? (
        <div role="status" className="rl-saved">
          {savedLine}
        </div>
      ) : null}

      <div className="rl-tabs" role="tablist" aria-label="Rules">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            id={`tab-${id}`}
            role="tab"
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={tab === id ? "rl-tab on" : "rl-tab"}
            onClick={() => pick(id)}
            onKeyDown={tabKey}
          >
            {label}
            <span className={pills[id].accent ? "rl-pill accent" : "rl-pill"}>{pills[id].state}</span>
          </button>
        ))}
      </div>

      <ScopeBar
        company={companyName}
        scope={scope}
        opts={opts}
        own={tabOwn}
        line={line}
        busy={resetting || saving || (tab !== "hours" && stale)}
        onScope={pickScope}
        onReset={() => void reset()}
      />

      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="rl-panel" aria-busy={tab !== "hours" && stale}>
        {tab !== "hours" && stale && policy.error && !policy.pending ? (
          <ErrorBlock title="We couldn't load these rules" message={errorMessage(policy.error)} onRetry={policy.reload} />
        ) : null}

        {tab === "hours" ? (
          has("work_time") ? (
            <WorkHoursTab scope={scope} opts={opts} wh={wh} say={say} />
          ) : (
            <Card title="Work hours" sub="From the Start day, Take a break and End day buttons in each person's Zinwe window.">
              <PlanNote module="work_time">See when each person starts, takes breaks and ends their day, and OK long breaks.</PlanNote>
            </Card>
          )
        ) : null}

        {tab === "web" ? (
          has("web") ? (
            <WebsitesTab key={base.scope} d={d} initialSites={p.web.allow_sites ?? []} set={set} />
          ) : (
            <Card title="How Zinwe treats websites" sub="Site names only, never full addresses, page contents or searches.">
              <PlanNote module="web">Block risky website categories or any site you choose.</PlanNote>
            </Card>
          )
        ) : null}

        {tab === "usb" ? (
          <>
            <Card title="USB drives" sub="Pen drives, external disks and phones. Keyboards, mice and chargers are never affected.">
              {has("usb_control") ? (
                <div role="radiogroup" aria-label="USB drives" className="rl-opts">
                  {(
                    [
                      ["allow", "Allow", "USB works normally. Every copy is noted."],
                      ["read_only", "Read-only", "Open files from a drive, but nothing can be copied onto it."],
                      ["block", "Block", "Drives don’t open. Each try shows in Alerts."],
                    ] as const
                  ).map(([k, label, desc]) => (
                    <OptCard key={k} on={d.usb === k} label={label} desc={desc} onPick={() => set({ usb: k as UsbMode })} />
                  ))}
                </div>
              ) : (
                <PlanNote module="usb_control">Make pen drives read-only or block them on every PC.</PlanNote>
              )}
            </Card>
            {has("data_transfer") ? (
              <Card title="USB copy limit" sub="Zinwe notes every copy. It alerts you only when one copy is over this size.">
                <div style={{ maxWidth: 240 }}>
                  <SizeField id="usbLimit" label="USB copies, over" bytes={d.usbBytes} unit="MB" unitBytes={MB} min={1} onChange={(b) => set({ usbBytes: b })} />
                </div>
                {d.usbBytes < 50 * MB ? <span className="rl-warn">A USB limit under 50 MB alerts on almost every copy, even photos.</span> : null}
                <SwitchRow
                  divided
                  title="Switch that PC to read-only when a copy goes over the limit"
                  sub="Stops further copies straight away. Restore USB from the alert or the person's card."
                  on={d.usbLock}
                  label="Switch to read-only over the limit"
                  onChange={() => set({ usbLock: !d.usbLock })}
                />
              </Card>
            ) : (
              <Card title="USB copy limit" sub="Zinwe notes every copy. It alerts you only when one copy is over this size.">
                <PlanNote module="data_transfer">Get an alert when a big copy leaves by USB, a shared folder, email or upload.</PlanNote>
              </Card>
            )}
            <div className="z-card rl-card">
              <SwitchRow
                title="Include file names and email subjects in alerts"
                sub="Off protects privacy. Turn on only if your team knows and your policy allows it; each person is asked to agree again."
                on={d.names}
                label="Include file names"
                onChange={() => set({ names: !d.names })}
              />
            </div>
          </>
        ) : null}

        {tab === "limits" ? (
          <Card title="Share limits" sub="Zinwe notes every transfer by size. It alerts you only when one goes over these limits. The USB limit is under USB & files.">
            {has("data_transfer") ? (
              <>
                <div className="rl-lim">
                  <SizeField id="emailLimit" label="Email attachments, over" bytes={d.emailBytes} unit="MB" unitBytes={MB} min={1} onChange={(b) => set({ emailBytes: b })} />
                  <SizeField id="netLimit" label="Shared folders, over" bytes={d.lanBytes} unit="GB" unitBytes={GB} min={0.01} onChange={(b) => set({ lanBytes: b })} />
                  <SizeField id="upLimit" label="Website uploads, over" bytes={d.upBytes} unit="GB" unitBytes={GB} min={0.01} onChange={(b) => set({ upBytes: b })} />
                </div>
                {d.emailBytes < 5 * MB ? <span className="rl-warn">An email limit under 5 MB alerts on most PDFs and photos.</span> : null}
                <span className="rl-k">
                  Website uploads counts what a browser or mail app sends to one site within an hour. Zinwe sees sizes, not files, so a long video call can count too. Programs like Google Drive for desktop aren't counted.
                </span>
                {d.web === "off" ? <span className="rl-warn">Websites is off, so uploads aren't measured. Turn on Watch only or Block &amp; watch under Websites.</span> : null}
              </>
            ) : (
              <PlanNote module="data_transfer">Get an alert when a big copy leaves by USB, a shared folder, email or upload.</PlanNote>
            )}
          </Card>
        ) : null}

        {tab === "remote" ? (
          <Card
            title="Remote tools"
            sub={`Remote-control apps. Choose ${SAMPLES_ON ? "Block, Watch or Allow" : "Block or Watch"} for each one. Zinwe sees that a session runs, never what happens inside it.`}
          >
      {has("remote_access") ? (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <b id="rt-l">Known tools · {d.tools.length}</b>
            <span className="rl-k">
              {nOf("block")} blocked · {nOf("watch")} watched{SAMPLES_ON ? ` · ${nOf("allow")} allowed` : ""}
            </span>
          </div>
          <div className="rl-rt-wrap">
            <table className="rl-rt" aria-labelledby="rt-l">
              <thead>
                <tr>
                  <th scope="col">Tool</th>
                  <th scope="col">What it is</th>
                  <th scope="col">
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      How it’s spotted
                      <Def tip={tip} id="spotted" aria="How Zinwe spots a tool">
                        Zinwe looks for the app by its name and by the network port it connects on. It never sees inside the session.
                      </Def>
                    </span>
                  </th>
                  <th scope="col">
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {SAMPLES_ON ? "Block, watch or allow" : "Block or watch"}
                      <Def tip={tip} id="rstatus" aria={SAMPLES_ON ? "What Block, Watch and Allow mean" : "What Block and Watch mean"}>
                        <b>Block</b> closes it the moment it starts. The try shows in Alerts.
                        <br />
                        <b>Watch</b> lets it run. Every session shows in Alerts.
                        {SAMPLES_ON ? (
                          <>
                            <br />
                            <b>Allow</b> lets it run with no alert. Sessions are still listed on Apps &amp; remote.
                          </>
                        ) : null}
                      </Def>
                    </span>
                  </th>
                  <th scope="col">
                    <span className="z-sr">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.tools.map((t) => {
                  const ix = MODES.findIndex(([k]) => k === t.mode);
                  return (
                    <tr key={t.id}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <b>{t.name}</b>
                        {t.custom ? <span className="rl-ctag">Custom</span> : null}
                      </td>
                      <td data-l="What it is" style={{ color: "#404040" }}>
                        {t.what}
                      </td>
                      <td data-l="How it’s spotted" style={{ color: "#404040" }}>
                        {t.custom ? (t.exe ? `By app file ${t.exe}` : "By app name") : "By app name and network port"}
                      </td>
                      <td className="rl-act">
                        <span
                          role="radiogroup"
                          className="rl-s3g"
                          aria-label={`${t.name}: ${SAMPLES_ON ? "block, watch or allow" : "block or watch"}`}
                          onKeyDown={(e) => {
                            const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
                            if (!step) return;
                            e.preventDefault();
                            const next = MODES[(ix + step + MODES.length) % MODES.length][0];
                            setMode(t.id, next);
                            window.setTimeout(() => document.getElementById(`rm-${t.id}-${next}`)?.focus(), 30);
                          }}
                        >
                          {MODES.map(([k, label]) => (
                            <button
                              key={k}
                              type="button"
                              role="radio"
                              id={`rm-${t.id}-${k}`}
                              className={`rl-s3 ${k}${t.mode === k ? " on" : ""}`}
                              aria-checked={t.mode === k}
                              tabIndex={t.mode === k ? 0 : -1}
                              onClick={() => setMode(t.id, k)}
                            >
                              {label}
                            </button>
                          ))}
                        </span>
                      </td>
                      <td className="rl-act">
                        {/* Taking a built-in tool off the list is sample-only; your own tools can always go. */}
                        {SAMPLES_ON || t.custom ? (
                          <button type="button" className="z-btn sm" aria-label={`Remove ${t.name} from the list`} onClick={() => set({ tools: d.tools.filter((x) => x.id !== t.id) })}>
                            Remove
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {removedSeeds.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <span className="rl-k">Add back:</span>
              {removedSeeds.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="rl-chip"
                  onClick={() => {
                    // Added back in its usual place, with the mode it had when saved, so remove + add back leaves no change.
                    const was = saved.tools.find((x) => x.id === s.id);
                    const row = was ?? { ...s, mode: "watch" as ToolMode, custom: false, exe: "" };
                    const order = REMOTE_SEED.map((x) => x.id);
                    const seeds = [...d.tools.filter((x) => !x.custom && order.includes(x.id)), row].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
                    set({ tools: [...seeds, ...d.tools.filter((x) => x.custom || !order.includes(x.id))] });
                  }}
                >
                  + {s.name}
                </button>
              ))}
            </div>
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid #F5F5F5", paddingTop: 14 }}>
            <b>Add a tool</b>
            <span className="rl-k">For a remote-control app that isn’t listed. Its name is enough. New tools start as Block.</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label htmlFor="toolName" style={{ fontSize: 13, fontWeight: 600 }}>
                  Tool name
                </label>
                <input
                  id="toolName"
                  className="rl-inp"
                  style={{ width: 220, maxWidth: "100%" }}
                  placeholder="e.g. RemotePC"
                  value={toolName}
                  aria-invalid={Boolean(toolErr.name)}
                  aria-describedby="toolName-err"
                  onChange={(e) => {
                    setToolName(e.target.value);
                    setToolErr((x) => ({ ...x, name: "" }));
                  }}
                  onKeyDown={toolKey}
                />
              </span>
              <button type="button" className="z-btn sm" onClick={addTool}>
                Add tool
              </button>
            </div>
            {toolErr.name ? (
              <span id="toolName-err" role="alert" className="rl-err">
                {toolErr.name}
              </span>
            ) : null}
            <button type="button" className="rl-adv" aria-expanded={advOpen} onClick={() => setAdvOpen(!advOpen)}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                style={{ transition: "transform .15s", transform: `rotate(${advOpen ? 90 : 0}deg)` }}
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
              Advanced
            </button>
            {advOpen ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 20 }}>
                <label htmlFor="toolExe" style={{ fontSize: 13, fontWeight: 600 }}>
                  App file name{" "}
                  <span className="rl-k" style={{ fontWeight: 400 }}>
                    (optional)
                  </span>
                </label>
                <input
                  id="toolExe"
                  className="rl-inp rl-mono"
                  style={{ width: 220, maxWidth: "100%" }}
                  placeholder="tool.exe"
                  value={toolExe}
                  aria-invalid={Boolean(toolErr.exe)}
                  aria-describedby="toolExe-help toolExe-err"
                  onChange={(e) => {
                    setToolExe(e.target.value);
                    setToolErr((x) => ({ ...x, exe: "" }));
                  }}
                  onKeyDown={toolKey}
                />
                <span id="toolExe-help" className="rl-k">
                  Add it if the tool often runs under another name, like a portable copy.
                </span>
                {toolErr.exe ? (
                  <span id="toolExe-err" role="alert" className="rl-err">
                    {toolErr.exe}
                  </span>
                ) : null}
              </div>
            ) : null}
            <div role="status" aria-live="polite" className={rToast ? "rl-toast on" : "rl-toast"}>
              {rToast}
            </div>
          </div>
        </>
      ) : (
        <PlanNote module="remote_access">Spot and block remote-control tools like AnyDesk, and see new software installs.</PlanNote>
      )}
          </Card>
        ) : null}

        {tab === "software" ? (
          <Card title="Software" sub="Program names and versions only, never what's done in them.">
            {has("software_installs") ? (
              <SwitchRow
                title="New-software alerts"
                sub="An alert the day a program is installed. It shows as Worth a look."
                on={d.soft}
                label="New-software alerts"
                onChange={() => set({ soft: !d.soft })}
              />
            ) : (
              <PlanNote module="software_installs">Get an alert the day a program is installed on any PC.</PlanNote>
            )}
          </Card>
        ) : null}
      </div>

      <Sheet open={leaving} title="You have unsaved changes" sub={`${changes} ${changeWord} to ${leaveName}`} onClose={guard.stay}>
        <div data-leave-guard className="zn-sheet-acts">
          <button type="button" className="z-btn" onClick={guard.stay}>
            Stay
          </button>
          <button
            type="button"
            className="z-btn"
            onClick={() => {
              discard();
              guard.proceed();
            }}
          >
            Discard
          </button>
          <button
            type="button"
            className="z-btn pri"
            disabled={saving}
            onClick={() => {
              guard.hold();
              void save().then((ok) => {
                if (ok) guard.proceed();
                else guard.stay();
              });
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        {saveErr ? (
          <p className="z-err" role="alert" style={{ margin: 0 }}>
            {saveErr}
          </p>
        ) : null}
      </Sheet>
      <Sheet
        open={askScope !== null}
        title="You have unsaved changes"
        sub={`${changes} ${changeWord} for ${scope === "company" ? "everyone" : scopeName(scope, opts)}`}
        onClose={() => setAskScope(null)}
      >
        <div className="zn-sheet-acts">
          <button type="button" className="z-btn" onClick={() => setAskScope(null)}>
            Stay
          </button>
          <button
            type="button"
            className="z-btn"
            onClick={() => {
              discard();
              if (askScope) goScope(askScope);
            }}
          >
            Discard
          </button>
          <button
            type="button"
            className="z-btn pri"
            disabled={saving}
            onClick={() => {
              const next = askScope;
              void save().then((ok) => {
                if (ok && next) goScope(next);
              });
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        {saveErr ? (
          <p className="z-err" role="alert" style={{ margin: 0 }}>
            {saveErr}
          </p>
        ) : null}
      </Sheet>
      <Toast message={toast?.text ?? null} tone={toast?.tone} ms={toast?.tone === "error" ? 0 : 2600} onDone={clearToast} />
      {tip.node}
    </div>
  );
}
