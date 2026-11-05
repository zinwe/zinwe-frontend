import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/authContext";
import { paymentInCheck } from "../../auth/steps";
import { usePageMeta } from "../../hooks/usePageMeta";
import {
  errorMessage,
  getMemberTags,
  getReport,
  getWorkLog,
  listDevices,
  listMembers,
  type Device,
  type Member,
  type MemberTag,
} from "../../lib/api";
import { useEntitlements } from "../features/entitlements";
import { summarizeDay, isoDay, shiftDay, type PersonDay } from "../features/workDay";
import { keepBoth, removeSecondPc, secondPcsNow } from "../fixtures/pcs";
import { roleColour } from "../roleColour";
import { PageHead } from "../shell/PageHead";
import { useShell } from "../shell/shellContext";
import { AddPerson } from "../team/AddPerson";
import { FilterSheet } from "../team/FilterSheet";
import { firstName } from "../team/format";
import { useMemberTodos } from "../tasks/useMemberTodos";
import { PersonCard } from "../team/PersonCard";
import { bestTagKey, cardStatus, FILTERS, inFilter, statusRows, systemFull, weekOf, type TeamFilter } from "../team/teamData";
import { formatRelative, useNow } from "../time";
import { EmptyBlock, ErrorBlock, Sk, ZToast } from "../ui/States";
import { useTip } from "../ui/useTip";
import { ZIcon } from "../ui/ZIcon";
import { useResource } from "../useResource";
import "../../styles/dash13/team.css";

/** Active members first, then deactivated; each group newest first. */
function sortMembers(members: Member[]): Member[] {
  return [...members].sort(
    (a, b) =>
      Number(b.is_active) - Number(a.is_active) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

function hashParams(hash: string): URLSearchParams {
  return new URLSearchParams(hash.replace(/^#/, ""));
}

/**
 * Team & PCs (DashTeam): everyone Zinwe protects, as cards. Add a person (inline; a full-screen sheet on a phone)
 * gives their Member ID; they install Zinwe and agree on their own PC. `#add=1` (and the tour's `?add=1`) opens
 * Add a person; `#m=<first>` outlines that person's card.
 */
export default function TeamPage(): ReactElement {
  usePageMeta({
    title: "Team & PCs — Zinwe",
    description: "Everyone Zinwe protects. Add a person to get their Member ID; they install Zinwe and agree on their own PC.",
  });

  const { account, refresh } = useAuth();
  const { maxDevices, planName, upgradeFor, has } = useEntitlements();
  const upgradeInCheck = paymentInCheck(account?.subscription);
  const shell = useShell();
  const tip = useTip();
  const now = useNow(60_000);
  const today = isoDay(new Date(now));
  const weekFrom = shiftDay(today, -6);
  const dates = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDay(weekFrom, i)), [weekFrom]);

  // Someone added but not connected yet: check every 10 s so their card flips by itself (J5-10).
  const [waiting, setWaiting] = useState(false);
  const pollMs = waiting ? 10_000 : 60_000;
  const loadMembers = useCallback((signal: AbortSignal) => listMembers(signal), []);
  const members = useResource(loadMembers, { pollMs });
  const loadDevices = useCallback((signal: AbortSignal) => listDevices(signal), []);
  const devices = useResource(loadDevices, { pollMs });
  // FR-19: playful tags from each person's week (a nice-to-have: failures just hide them).
  const loadTags = useCallback((signal: AbortSignal) => getMemberTags(signal), []);
  const tags = useResource(loadTags);
  // Today's work log: the status tooltip's "Day started 9:32 AM" (the same times Activity shows).
  const loadToday = useCallback((signal: AbortSignal) => getWorkLog({ date: today }, signal), [today]);
  const todayLog = useResource(loadToday, { pollMs: 60_000 });
  // Last 7 days per person (active time, worked, internet data): one team report.
  const loadWeek = useCallback((signal: AbortSignal) => getReport(weekFrom, today, signal), [weekFrom, today]);
  const week = useResource(loadWeek, { pollMs: 5 * 60_000 });
  const [pcsTick, setPcsTick] = useState(0);

  const someoneWaiting = (members.data ?? []).some((m) => m.is_active && !m.device);
  if (someoneWaiting !== waiting) setWaiting(someoneWaiting);

  // #add=1 (phone "+" sheet, Overview "Add a person") and the tour's ?add=1 open Add a person.
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(() => params.get("add") === "1" || hashParams(location.hash).get("add") === "1");
  const [addKey, setAddKey] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const openAdd = useCallback(() => {
    setAdding(true);
    setAddKey((k) => k + 1);
    setSheetOpen(false);
    window.setTimeout(() => document.getElementById("add-sheet")?.scrollIntoView({ block: "nearest" }), 30);
  }, []);
  useEffect(() => {
    if (params.get("add") === "1") {
      const next = new URLSearchParams(params);
      next.delete("add");
      setParams(next, { replace: true });
    }
  }, [params, setParams]);
  const hash = hashParams(location.hash);
  // #add=1 opens it once per navigation (Cancel keeps it closed until the next link).
  const [seenAddKey, setSeenAddKey] = useState<string | null>(null);
  if (hash.get("add") === "1" && seenAddKey !== location.key) {
    setSeenAddKey(location.key);
    if (!adding) {
      setAdding(true);
      setAddKey((k) => k + 1);
    }
  }
  const linkedFirst = (hash.get("m") ?? "").toLowerCase();

  const [filter, setFilter] = useState<TeamFilter>("all");
  const [q, setQ] = useState("");
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const [toast, setToast] = useState<string | null>(null);
  const clearToast = useCallback(() => setToast(null), []);

  const list = members.data ? sortMembers(members.data) : [];
  const active = list.filter((m) => m.is_active);
  const removed = list.filter((m) => !m.is_active);
  // GET /devices/ leaves removed PCs out by default (FIX-005), so every PC here is one in use.
  const live = devices.data ?? [];
  const deviceOf = (member: Member): Device | undefined =>
    live.find((d) =>
      d.member_id != null ? d.member_id === member.id : d.member_name === member.name && d.hostname === member.device?.hostname,
    );
  // PCs connected before per-person IDs existed have no member; keep them visible.
  const unassigned = live.filter((d) => !d.member_id && !d.member_name);

  // Plan enforcement: a new PC is refused once every slot on the plan is taken (existing PCs keep working).
  const pcsUsed = live.length;
  const free = Math.max(0, maxDevices - pcsUsed);
  const pcsFull = maxDevices > 0 && devices.data !== undefined && pcsUsed >= maxDevices;
  const biggerPlan = upgradeFor("work_time") ?? upgradeFor("usb_control");
  const capacity =
    devices.data === undefined
      ? ""
      : maxDevices > 0
        ? `${pcsUsed} of ${maxDevices} PCs · ${free} free ${free === 1 ? "slot" : "slots"}`
        : `${pcsUsed} ${pcsUsed === 1 ? "PC" : "PCs"}`;
  const slotLine =
    maxDevices <= 0
      ? ""
      : free > 0
        ? `Uses 1 of your ${free} free PC ${free === 1 ? "slot" : "slots"} (${planName ?? "current"} plan, ${maxDevices} PCs).`
        : `All ${maxDevices} PCs on your ${planName ?? "current"} plan are in use; their PC connects once a slot is free.`;

  const todayByMember = useMemo(() => {
    const map = new Map<number, PersonDay>();
    if (todayLog.data) for (const p of summarizeDay(todayLog.data, true, now)) if (p.memberId != null) map.set(p.memberId, p);
    return map;
  }, [todayLog.data, now]);

  const tagCounts = new Map<string, number>();
  for (const m of active) for (const t of tags.data?.[String(m.id)] ?? []) tagCounts.set(t.key, (tagCounts.get(t.key) ?? 0) + 1);
  const tagOf = (m: Member): MemberTag | null => {
    const mine = tags.data?.[String(m.id)] ?? [];
    const key = bestTagKey(mine, tagCounts);
    return mine.find((t) => t.key === key) ?? null;
  };

  const todos = useMemberTodos({ enabled: has("team_chat") });

  // pcsTick: Keep both / Remove on the sample second PC (FR-36).
  const seconds = useMemo(() => (pcsTick >= 0 ? secondPcsNow(members.data) : []), [members.data, pcsTick]);

  const needle = q.trim().toLowerCase();
  const matches = (m: Member) => {
    if (!inFilter(m, filter)) return false;
    if (!needle) return true;
    const extra = seconds.find((s) => s.memberId === m.id)?.name ?? "";
    return `${m.name} ${m.device?.hostname ?? ""} ${extra} ${m.member_id} ${m.email}`.toLowerCase().includes(needle);
  };
  const shown = active.filter(matches);
  // One hue per role: the roles the team uses, A-Z, take the palette in order (the same colours as Tasks and Chat).
  const teamRoles = active.map((m) => m.role ?? "");

  const onCreated = (member: Member) => {
    members.setData([member, ...(members.data ?? []).filter((m) => m.id !== member.id)]);
    shell.reloadMembers();
  };
  const onUpdated = (member: Member) => {
    members.setData((members.data ?? []).map((m) => (m.id === member.id ? member : m)));
    shell.reloadMembers();
  };
  // Removed: the PC count and the plan's free slots update at once, with a short confirmation (J5-17).
  const onRemoved = (member: Member) => {
    onUpdated(member);
    devices.reload();
    void refresh();
    const slots = maxDevices > 0 && member.device ? Math.max(0, maxDevices - (pcsUsed - 1)) : null;
    const first = firstName(member.name);
    setToast(slots !== null ? `${first} removed. ${slots} PC ${slots === 1 ? "slot" : "slots"} free.` : `${first} removed from your team.`);
  };

  const filterBtnLabel = filter === "all" ? "Filters" : "Filters · 1";
  const counts = (k: TeamFilter) => active.filter((m) => inFilter(m, k)).length;

  return (
    <div className="zp-team">
      <PageHead
        title="Team & PCs"
        lede="Everyone Zinwe protects. Add a person to get their Member ID; they install Zinwe and agree on their own PC."
        actions={
          <>
            <a className="z-btn sm" href="/download" target="_blank" rel="noopener">
              Download Zinwe
            </a>
            <button type="button" className="z-btn sm pri" onClick={openAdd}>
              Add a person
            </button>
          </>
        }
      />

      {adding ? (
        <AddPerson
          key={addKey}
          slotLine={slotLine}
          onCreated={onCreated}
          onClose={() => {
            setAdding(false);
          }}
        />
      ) : null}

      {pcsFull ? (
        <div className="zn-banner info" role="status">
          <ZIcon name="pc" />
          {upgradeInCheck ? (
            <span>
              <b>All {maxDevices} PCs on your {planName ?? "current"} plan are in use.</b> Your upgrade to {upgradeInCheck.planName} is
              being checked; new PCs connect as soon as it’s confirmed.
            </span>
          ) : (
            <span>
              <b>All {maxDevices} PCs on your {planName ?? "current"} plan are in use.</b> A new PC won’t connect until you upgrade or
              remove one. PCs already connected keep working.{" "}
              <Link className="zn-banner__more" to={biggerPlan ? `/app/upgrade?plan=${encodeURIComponent(biggerPlan.code)}` : "/app/upgrade"}>
                Upgrade
              </Link>
            </span>
          )}
        </div>
      ) : null}

      <div className="zt-filterrow">
        <div className="z-segs zt-fseg" role="group" aria-label="Filter">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" className="z-seg" aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {label} <span className="z-num" style={{ opacity: 0.6 }}>{members.data ? counts(k) : ""}</span>
            </button>
          ))}
        </div>
        <div className="zt-fbar">
          <span className="zt-cap">{capacity}</span>
          <label className="zt-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B6B6B" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <span className="z-sr">Search people</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, PC or ID" />
          </label>
          {/* Phone: the filter chips move into a bottom sheet behind this button. */}
          <button
            type="button"
            id="team-filters-btn"
            className="z-btn sm zt-fbtn"
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            onClick={() => {
              tip.hide();
              setSheetOpen(true);
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
            {filterBtnLabel}
          </button>
        </div>
      </div>
      <FilterSheet id="team-filters" title="Show" open={sheetOpen} onClose={closeSheet} returnTo="team-filters-btn">
        {FILTERS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            className="zt-opt"
            aria-pressed={filter === k}
            onClick={() => {
              setFilter(k);
              closeSheet();
            }}
          >
            <span>{label}</span>
            <span className="z-num" style={{ color: "#6B6B6B" }}>
              {counts(k)}
            </span>
          </button>
        ))}
      </FilterSheet>

      {members.data === undefined ? (
        members.error ? (
          <section className="z-card">
            <ErrorBlock title="We couldn't load your team" message={errorMessage(members.error)} onRetry={members.reload} />
          </section>
        ) : (
          <section className="zt-cards" role="status" aria-busy="true">
            <span className="z-sr">Loading your team…</span>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="z-card zt-card" aria-hidden="true">
                <div className="zt-top">
                  <Sk w={44} h={44} round />
                  <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                    <Sk w="60%" h={14} />
                    <Sk w="80%" h={10} />
                  </span>
                  <Sk w={64} h={22} style={{ borderRadius: 999 }} />
                </div>
                <Sk w="45%" h={28} />
                <Sk h={56} />
                <Sk h={56} />
                <Sk w="70%" h={12} />
              </div>
            ))}
          </section>
        )
      ) : active.length === 0 ? (
        <section className="z-card">
          <EmptyBlock
            icon="team"
            title="Add your first person"
            action={
              <button type="button" className="z-btn sm pri" onClick={openAdd}>
                Add a person
              </button>
            }
          >
            Each person gets their own Member ID. They install Zinwe on their PC, agree on screen, and show up here within about a
            minute.
          </EmptyBlock>
        </section>
      ) : (
        <>
          {members.error ? (
            <div className="zn-banner warn" role="status">
              <ZIcon name="alerts" />
              <span>
                Showing what we had a moment ago. {errorMessage(members.error)}{" "}
                <button type="button" className="zt-linkbtn" onClick={members.reload}>
                  Try again
                </button>
              </span>
            </div>
          ) : null}
          <section className="zt-cards" aria-label="Your team">
            {shown.map((member) => {
              const today = todayByMember.get(member.id);
              const status = cardStatus(member, today);
              return (
                <PersonCard
                  key={member.id}
                  member={member}
                  device={deviceOf(member)}
                  status={status}
                  statusRows={statusRows(member, status, today, now)}
                  tag={tagOf(member)}
                  week={weekOf(week.data, member.id, dates)}
                  weekFailed={week.data === undefined && Boolean(week.error)}
                  today={dates[6]}
                  now={now}
                  second={seconds.find((s) => s.memberId === member.id)}
                  chatOn={has("team_chat")}
                  todos={todos.data?.filter((t) => t.member_id === member.id)}
                  todosFailed={Boolean(todos.error)}
                  tip={tip}
                  roleLine={roleColour(member.role ?? "", teamRoles)}
                  linked={linkedFirst !== "" && firstName(member.name).toLowerCase() === linkedFirst}
                  onUpdated={onUpdated}
                  onRemoved={onRemoved}
                  onDeviceChanged={devices.reload}
                  onKeepBoth={() => {
                    keepBoth(members.data);
                    setPcsTick((t) => t + 1);
                  }}
                  onRemoveSecond={() => {
                    removeSecondPc(members.data);
                    setPcsTick((t) => t + 1);
                  }}
                />
              );
            })}
          </section>
          {shown.length === 0 ? (
            <p className="zt-nomatch">{needle ? `Nobody matches "${q.trim()}".` : "Nobody here with this filter."}</p>
          ) : null}
        </>
      )}

      {unassigned.length > 0 ? (
        <section className="z-card zt-other" aria-labelledby="other-pcs-title">
          <h2 id="other-pcs-title">Other PCs</h2>
          <p className="zt-hint">Connected before per-person IDs. They stay protected.</p>
          <ul>
            {unassigned.map((d) => (
              <li key={d.id}>
                <span className="zt-dot" style={{ background: d.is_online ? "#17663F" : "#6B6B6B" }} aria-hidden="true" />
                <b className="z-mono">{d.hostname || "Unnamed PC"}</b>
                <span className="zt-hint">
                  {[systemFull(d), `last seen ${formatRelative(d.last_seen_at, now, "never")}`].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {removed.length > 0 ? (
        <details className="z-card zt-removed">
          <summary>Removed people ({removed.length})</summary>
          <ul>
            {removed.map((m) => (
              <li key={m.id}>
                {m.name} · {m.email} · their Member ID no longer works
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {toast ? <ZToast text={toast} onDone={clearToast} /> : null}
      {tip.node}
    </div>
  );
}
