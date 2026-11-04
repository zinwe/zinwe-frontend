import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/authContext";
import { usePageMeta } from "../../hooks/usePageMeta";
import {
  EVENTS_MAX_LIMIT,
  getPolicy,
  getReportSchedules,
  getWorkLog,
  listDevices,
  listEvents,
  type DeviceEvent,
} from "../../lib/api";
import { levelOf, makePersonFor, viewOf, type AlertView } from "../alerts/alertModel";
import { markMany, useAsks } from "../alerts/useAsks";
import { GetProtected } from "../components/GetProtected";
import { PlanLock } from "../components/PlanLock";
import { groupAlerts } from "../features/alertGroups";
import { browserNotifyOn } from "../features/browserNotify";
import { useEntitlements } from "../features/entitlements";
import { alertsOnly, isHandled } from "../features/events";
import { useEventCounts } from "../features/useEventCounts";
import { consentOf, presenceOf } from "../features/memberStatus";
import { NeedsCard } from "../overview/NeedsCard";
import { needsBreakdown, needsCounts } from "../overview/needs";
import { SetupCard } from "../overview/SetupCard";
import { TeamToday } from "../overview/TeamToday";
import { PageHead } from "../shell/PageHead";
import { useTasks } from "../tasks/useTasks";
import { PhoneTasksCard } from "../overview/PhoneTasksCard";
import { useShell } from "../shell/shellContext";
import { formatRelative, useNow } from "../time";
import { SkTiles } from "../ui/States";
import { TipBody } from "../ui/Tooltip";
import { useTip } from "../ui/useTip";
import { ZIcon } from "../ui/ZIcon";
import { useResource } from "../useResource";
import "../../styles/dash13/overview.css";

/** Short definitions shown in the tile tooltips (label first, in bold). The tile's own sub line keeps the facts. */
const TILE_DEF: Record<string, string> = {
  "Needs you": "requests waiting for your OK, Needs you alerts not yet marked as fine, and tasks that need help or your OK.",
  "Working now": "pressed Start day in the Zinwe app and not on a break right now.",
  "On a break": "pressed Take a break. Breaks over 45 minutes ask for your OK.",
  "PCs offline": "switched off or not connected to Zinwe right now.",
};

function greeting(now: number): string {
  const h = new Date(now).getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function OverviewPage(): ReactElement {
  usePageMeta({ title: "Overview — Zinwe", description: "What needs you, who's working and your PCs, at a glance." });
  const { account } = useAuth();
  const { members, refreshAll, refreshing } = useShell();
  const { has, maxDevices } = useEntitlements();
  const workOn = has("work_time");
  const now = useNow(60_000);
  const tip = useTip();

  const loadDevices = useCallback((signal: AbortSignal) => listDevices(signal, { includeRemoved: true }), []);
  const devices = useResource(loadDevices, { pollMs: 60_000 });
  // Not-handled alerts only, filtered on the server (FIX-013), with the time they arrived ("Updated …").
  const loadEvents = useCallback(
    (signal: AbortSignal) =>
      listEvents({ kind: "alert", handled: false, limit: EVENTS_MAX_LIMIT }, signal).then((list) => ({ list, at: Date.now() })),
    [],
  );
  const events = useResource(loadEvents, { pollMs: 60_000 });
  const totals = useEventCounts();
  const loadPolicy = useCallback((signal: AbortSignal) => getPolicy(signal), []);
  const policy = useResource(loadPolicy);
  // Today's Start day / break / End day changes: requests waiting for your OK, and when each person started.
  const loadLog = useCallback((signal: AbortSignal) => getWorkLog({}, signal), []);
  const workLog = useResource(loadLog, { pollMs: 60_000 });
  const loadSchedules = useCallback(
    (signal: AbortSignal) => getReportSchedules(signal).catch(() => []),
    [],
  );
  const schedules = useResource(loadSchedules);
  const asks = useAsks();
  // Tasks (FR-20, plan module team_chat): any change on Tasks / Chat / here reloads them.
  const chatOn = has("team_chat");
  const tasks = useTasks({ enabled: chatOn, pollMs: 60_000 });

  // Marked as fine here: off the list at once, before the next poll.
  const [changed, setChanged] = useState<Record<number, DeviceEvent>>({});

  const firstName = account?.user.full_name.trim().split(/\s+/)[0];
  const active = useMemo(() => (members ?? []).filter((m) => m.is_active), [members]);
  const loaded = members !== undefined;
  const noTeam = loaded && active.length === 0;
  // First run: until someone has agreed on their PC, Overview leads with the four setup steps (J5-06).
  const firstRun = loaded && !active.some((m) => consentOf(m.device) === "given");

  const personFor = useMemo(() => makePersonFor(members, devices.data), [members, devices.data]);
  const open = useMemo(
    () => alertsOnly(events.data?.list).map((e) => changed[e.id] ?? e),
    [events.data, changed],
  );
  const needAlerts: AlertView[] | undefined = useMemo(() => {
    if (!events.data) return undefined;
    const needs = open.filter((e) => !isHandled(e) && levelOf(e) === "needs");
    return groupAlerts(needs).map((g) => viewOf(g, { now, personFor, devices: devices.data, policy: policy.data, asks: asks.data }));
  }, [events.data, open, now, personFor, devices.data, policy.data, asks.data]);
  const worth = open.filter((e) => !isHandled(e) && levelOf(e) === "worth").length;
  const worthMore = (events.data?.list.length ?? 0) >= EVENTS_MAX_LIMIT;
  const worthText = events.data
    ? worth
      ? `${worth.toLocaleString()}${worthMore ? "+" : ""} more ${worth === 1 && !worthMore ? "alert is" : "alerts are"} worth a look`
      : "Nothing else on Alerts"
    : null;

  // Breaks and early End days need the work-hours module; without it nothing waits for an OK.
  const requests = workOn ? workLog.data?.entries : [];
  const counts = needsCounts(requests, needAlerts, tasks.data);
  const needsLoaded = needAlerts !== undefined && tasks.data !== undefined;

  const presence = active.map((m) => presenceOf(m.device));
  const working = presence.filter((p) => p === "working").length;
  const onBreak = presence.filter((p) => p === "break").length;
  const pendingBreaks = (requests ?? []).filter((r) => r.approval === "pending" && r.state === "on_break");
  const pcs = (devices.data ?? []).filter((d) => !d.is_revoked);
  const offline = pcs.filter((d) => !d.is_online);
  const offlineNames = offline.map((d) => {
    const p = personFor(d.id);
    const f = p?.name.trim().split(/\s+/)[0];
    return f ? `${f}’s PC` : d.hostname;
  });

  const mark = async (view: AlertView, handled: boolean) => {
    const before = open.filter((e) => view.ids.includes(e.id));
    const at = new Date().toISOString();
    const apply = (list: DeviceEvent[]) => setChanged((c) => ({ ...c, ...Object.fromEntries(list.map((e) => [e.id, e])) }));
    apply(before.map((e) => ({ ...e, handled_at: handled ? at : null })));
    try {
      apply(await markMany(view.ids, handled));
      totals.reload();
    } catch (err) {
      apply(before);
      throw err;
    }
  };

  const today = new Date(now);
  const dateLabel = `${today.toLocaleDateString("en-GB", { weekday: "long" })}, ${today.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`;

  const tiles = [
    {
      label: "Needs you",
      value: needsLoaded ? String(counts.total) : "–",
      sub: counts.total ? needsBreakdown(counts.req, counts.alerts, counts.tasks) : "Nothing waiting",
      to: "#needs",
      color: counts.total ? "#C0331C" : "#141210",
    },
    {
      label: "Working now",
      value: workOn ? `${working} of ${active.length}` : "–",
      sub: workOn ? "Pressed Start day, not on a break" : "Work hours aren’t on your plan",
      to: workOn ? "/app/activity" : "/app/upgrade",
      color: "#141210",
    },
    {
      label: "On a break",
      value: workOn ? String(onBreak) : "–",
      sub: !workOn
        ? "Work hours aren’t on your plan"
        : pendingBreaks.length
          ? `${pendingBreaks.map((r) => (r.member_name ?? "").split(" ")[0]).join(", ")} · waiting for your OK`
          : "None waiting for your OK",
      to: !workOn
        ? "/app/upgrade"
        : pendingBreaks[0]?.member_name
          ? `/app/activity#m=${pendingBreaks[0].member_name.split(" ")[0].toLowerCase()}`
          : "/app/activity",
      color: "#A84505",
    },
    {
      label: "PCs offline",
      value: devices.data ? `${offline.length} of ${pcs.length}` : "–",
      sub: offline.length
        ? `${offlineNames.slice(0, 2).join(", ")}${offlineNames.length > 2 ? ` and ${offlineNames.length - 2} more` : ""}`
        : pcs.length
          ? "All online"
          : "No PCs connected yet",
      to: "/app/team",
      color: "#141210",
    },
  ];

  const steps = [
    { label: "Add your team", done: active.length > 0 },
    { label: "Install Zinwe on their PCs", done: active.length > 0 && active.every((m) => m.device) },
    { label: "Set your rules", done: (policy.data?.version ?? 1) > 1 },
    { label: "Turn on notifications", done: browserNotifyOn() },
    { label: "Schedule a weekly report", done: (schedules.data ?? []).some((s) => s.is_active) },
  ];
  const setupReady = loaded && policy.data !== undefined && schedules.data !== undefined;

  return (
    <div className="zp-overview">
      <PageHead
        label={dateLabel}
        title={firstName ? `${greeting(now)}, ${firstName}` : greeting(now)}
        actions={
          <>
            <span className="zn-updated">Updated {events.data ? formatRelative(new Date(events.data.at).toISOString(), now) : "…"}</span>
            <button type="button" className="z-btn sm" onClick={refreshAll} disabled={refreshing}>
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            {chatOn ? (
              <Link className="z-btn sm zn-desk-only" to="/app/tasks#new=1">
                New task
              </Link>
            ) : null}
            <Link className="z-btn sm dark zn-desk-only" to="/app/team#add=1">
              Add a person
            </Link>
          </>
        }
      />

      {firstRun ? (
        <GetProtected members={active} maxDevices={maxDevices} rulesChanged={(policy.data?.version ?? 1) > 1} />
      ) : setupReady ? (
        <SetupCard steps={steps} />
      ) : null}

      {chatOn ? <PhoneTasksCard tasks={tasks.data} /> : null}

      {noTeam ? null : !loaded ? (
        <SkTiles count={4} label="Loading today in numbers" />
      ) : (
        <section aria-label="Today in numbers" className="zn-tiles" data-tip-bound="tiles">
          {tiles.map((t) => {
            const body = (
              <>
                <span data-tip-at="1" className="zn-tile-l">
                  {t.label}
                  <ZIcon name="info" size={13} stroke={2} style={{ color: "#6B6B6B" }} />
                </span>
                <b className="z-num" style={{ color: t.color }}>
                  {t.value}
                </b>
                <span className="zn-tile-sub">{t.sub}</span>
              </>
            );
            const anchor = tip.anchor(`tile-${t.label}`, <TipBody text={<><b>{t.label}</b> — {TILE_DEF[t.label]}</>} />);
            return (
              <div key={t.label} style={{ display: "flex", minWidth: 0 }}>
                {t.to.startsWith("#") ? (
                  <a className="zn-tile" href={t.to} {...anchor}>
                    {body}
                  </a>
                ) : (
                  <Link className="zn-tile" to={t.to} {...anchor}>
                    {body}
                  </Link>
                )}
              </div>
            );
          })}
        </section>
      )}

      <div className="zn-cards">
        <NeedsCard
          requests={requests}
          alerts={needAlerts}
          tasks={tasks.data}
          worthText={worthText}
          canAsk={has("team_chat")}
          now={now}
          tip={tip}
          onMark={mark}
          onRequestsChanged={workLog.reload}
        />
        {workOn || noTeam ? (
          <TeamToday members={members} log={workLog.data?.entries} now={now} tip={tip} />
        ) : (
          <PlanLock module="work_time" compact title="Team today">
            See who's working, who's on a break and why, and when each person started and finished their day.
          </PlanLock>
        )}
      </div>

      {tip.node}
    </div>
  );
}
