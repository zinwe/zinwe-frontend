import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/authContext";
import { usePageMeta } from "../../hooks/usePageMeta";
import { downloadReport, errorMessage, getReport, sendReport } from "../../lib/api";
import { useEntitlements } from "../features/entitlements";
import { SAMPLES_ON } from "../fixtures";
import { withSampleAttendance } from "../fixtures/dayStatus";
import { parseEmails, badEmail } from "../features/reportFormat";
import { dStr, dDM, periodFor, PERIODS, rangeText, shiftDay, isoDay, type Period } from "../reports/dates";
import { colorMap, personKey } from "../reports/model";
import { PerformanceTab } from "../reports/PerformanceTab";
import { RangePicker } from "../reports/RangePicker";
import { ReportBody } from "../reports/ReportBody";
import { SchedulesTab } from "../reports/SchedulesTab";
import { SentTab } from "../reports/SentTab";
import { PlanNote } from "../rules/PlanNote";
import { PageHead } from "../shell/PageHead";
import { useShell } from "../shell/shellContext";
import { useNow } from "../time";
import { ErrorBlock, Sheet, Sk } from "../ui/States";
import { useTip } from "../ui/useTip";
import { useResource } from "../useResource";
import "../../styles/dash13/reports.css";

type Tab = "report" | "perf" | "sched" | "sent";

const ALL_TABS: ReadonlyArray<[Tab, string, string]> = [
  ["report", "Report", "report"],
  ["perf", "Performance", "performance"],
  ["sched", "Scheduled", "scheduled"],
  ["sent", "Sent", "sent"],
];
/** Performance runs on sample task numbers until FR-34 (fixtures/performance.ts): no tab in production builds. */
const TABS = SAMPLES_ON ? ALL_TABS : ALL_TABS.filter(([k]) => k !== "perf");
/** #tab=<value> (and the old ?view=) names, so links can open a tab directly. */
const TAB_HASH: Record<string, Tab> = { report: "report", performance: "perf", perf: "perf", scheduled: "sched", sched: "sched", schedules: "sched", sent: "sent" };

/** The tab a link asks for; Performance falls back to Report when it is hidden (production). */
function tabFromLink(name: string): Tab {
  const t = TAB_HASH[name.toLowerCase()] ?? "report";
  return TABS.some(([k]) => k === t) ? t : "report";
}
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function hashParams(hash: string): URLSearchParams {
  return new URLSearchParams(hash.replace(/^#/, ""));
}

/**
 * Reports (board DashReports; FR-17, FR-22, FR-34): the team, or one person, for any period. Tabs: Report
 * (totals, who worked when, by person, top apps / sites / data), Performance (score and rank — sample task
 * numbers), Scheduled (report schedules) and Sent (reports that went out). Download as PDF (reports_pro) or
 * CSV, or email it now (reports_pro).
 *
 * Links: #tab=performance|scheduled|sent opens a tab; #m=<first name> highlights that person;
 * ?member=<id> opens their report; ?from=&to= (report emails) opens that period.
 */
export default function ReportsPage(): ReactElement {
  usePageMeta({ title: "Reports — Zinwe", description: "Your team's work, breaks and alerts for any period." });
  const { user } = useAuth();
  const ownerEmail = user?.email ?? "";
  const { has, historyDays } = useEntitlements();
  const pro = has("reports_pro");
  const { members } = useShell();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const [params, setParams] = useSearchParams();
  const today = isoDay(new Date(useNow(60_000)));
  const tip = useTip();

  const [tab, setTab] = useState<Tab>(() => tabFromLink(hashParams(hash).get("tab") ?? params.get("view") ?? ""));
  // A link to a hidden tab (#tab=performance in production) lands on Report: drop the tab from the address too
  // (also when only the hash changes while Reports is open).
  useEffect(() => {
    const p = hashParams(hash);
    const want = TAB_HASH[(p.get("tab") ?? "").toLowerCase()];
    if (!want || TABS.some(([k]) => k === want)) return;
    p.delete("tab");
    const h = p.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${h ? `#${h}` : ""}`);
  }, [hash]);
  const memberParam = Number(params.get("member"));
  const memberId = Number.isInteger(memberParam) && memberParam > 0 ? memberParam : null;
  const linked: [string, string] | null =
    ISO.test(params.get("from") ?? "") && ISO.test(params.get("to") ?? "") ? [params.get("from")!, params.get("to")!] : null;
  const [period, setPeriod] = useState<Period>(linked ? "custom" : "week");
  const [custom, setCustom] = useState<[string, string]>(() => linked ?? periodFor("week", today));
  const [from, to] = period === "custom" ? custom : periodFor(period, today);
  const [picking, setPicking] = useState(false);

  const [pin, setPin] = useState<string | null>(null);
  const [perfSel, setPerfSel] = useState<number | null | "none">(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(0);
  const say = useCallback((text: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = window.setTimeout(() => setToast(""), 3400);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const [dlOpen, setDlOpen] = useState(false);
  const [downloading, setDownloading] = useState<"pdf" | "csv" | null>(null);
  const [emailing, setEmailing] = useState(false);
  const [emailTo, setEmailTo] = useState(ownerEmail);
  const [sending, setSending] = useState(false);
  const [locked, setLocked] = useState(false);
  const [sentKey, setSentKey] = useState(0);

  // #m=<first name>: that person is highlighted (chart, By person, Performance).
  const hashM = hashParams(hash).get("m")?.toLowerCase() ?? "";
  const [resolvedM, setResolvedM] = useState("");
  if (hashM && members && resolvedM !== hashM) {
    setResolvedM(hashM);
    const m = members.find((x) => x.name.split(/\s+/)[0].toLowerCase() === hashM || String(x.id) === hashM);
    if (m) {
      setPin(personKey(m.id, m.name));
      setPerfSel(m.id);
    }
  }

  const pickTab = (next: Tab) => {
    setTab(next);
    setPicking(false);
    tip.hide();
    const p = hashParams(window.location.hash);
    if (next === "report") p.delete("tab");
    else p.set("tab", TABS.find(([k]) => k === next)![2]);
    const h = p.toString();
    // The tab lives in the hash for links; replaceState keeps the scroll where it is.
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${h ? `#${h}` : ""}`);
  };

  const setMember = (id: number | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set("member", String(id));
    else p.delete("member");
    p.delete("view");
    setParams(p);
    setPerfSel(null);
    if (tab === "report") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const load = useCallback((signal: AbortSignal) => getReport(from, to, signal, memberId), [from, to, memberId]);
  const report = useResource(load, { resetKey: `${from}|${to}|${memberId ?? ""}` });
  // v1.4 day status: the server's; on a backend without it, a sample one where samples are on (fixtures/dayStatus.ts).
  const r = useMemo(() => (report.data ? withSampleAttendance(report.data, today) : undefined), [report.data, today]);
  // Performance ranks everyone, so with one person picked above it reads the team report too.
  const needTeam = tab === "perf" && memberId !== null;
  const loadTeam = useCallback(
    (signal: AbortSignal) => (needTeam ? getReport(from, to, signal, null) : Promise.resolve(undefined)),
    [from, to, needTeam],
  );
  const team = useResource(loadTeam, { resetKey: `${from}|${to}|${needTeam}` });
  const teamReport = memberId === null ? r : team.data;

  const colorOf = useMemo(() => colorMap(members, r), [members, r]);
  const activeMembers = (members ?? []).filter((m) => m.is_active);
  const minDay = shiftDay(today, -(historyDays > 0 ? historyDays : 365));
  const slug = from === to ? dDM(from) : `${dDM(from)}-to-${dDM(to)}`;

  const download = async (format: "pdf" | "csv") => {
    setDlOpen(false);
    if (format === "pdf" && !pro) return setLocked(true);
    setDownloading(format);
    try {
      await downloadReport(from, to, memberId, format);
      say(`Downloaded zinwe-report-${slug.toLowerCase().replace(/ /g, "-")}.${format}`);
    } catch (err) {
      say(errorMessage(err));
    } finally {
      setDownloading(null);
    }
  };

  const openEmail = () => {
    setDlOpen(false);
    if (!pro) return setLocked(true);
    if (!emailTo) setEmailTo(ownerEmail);
    setEmailing(true);
    window.setTimeout(() => document.getElementById("rp-to")?.focus(), 30);
  };

  const sendEmail = async () => {
    const list = parseEmails(emailTo);
    const bad = badEmail(list);
    if (!list.length) return say("Add an email to send to.");
    if (bad) return say("Check that email address.");
    const owner = ownerEmail.toLowerCase();
    const others = list.filter((e) => e !== owner);
    if (others.length > 5) return say("Add up to 5 other addresses.");
    setSending(true);
    try {
      const d = await sendReport({
        from: r?.from ?? from,
        to: r?.to ?? to,
        member: memberId,
        send_to_owner: list.includes(owner),
        send_to_members: false,
        emails: others,
        include_csv: false,
      });
      setEmailing(false);
      setSentKey((k) => k + 1);
      say(d.status === "skipped" || d.status === "failed" ? d.detail : `Report sent to ${list.join(", ")}.`);
    } catch (err) {
      say(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const tabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex(([k]) => k === tab);
    const n =
      e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i + TABS.length - 1) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : -1;
    if (n < 0) return;
    e.preventDefault();
    pickTab(TABS[n][0]);
    window.setTimeout(() => document.getElementById(`rtab-${TABS[n][0]}`)?.focus(), 0);
  };

  const perfSelected = perfSel === "none" ? null : (perfSel ?? memberId);
  const showFilters = tab === "report" || tab === "perf";
  const rangeLine = r ? rangeText(r.from, r.to) + (r.from !== from ? " (your plan keeps history from this day)" : "") : rangeText(from, to);

  return (
    <div className="zp-reports" style={{ display: "contents" }}>
      <PageHead
        title="Reports"
        lede="Your team's work, breaks and alerts for any period."
        actions={
          <>
            <button type="button" className="z-btn sm pri rp-ph-hide" onClick={openEmail} disabled={!r && pro}>
              Email report
            </button>
            <div
              className="rp-dlwrap"
              onKeyDown={(e) => {
                if (e.key !== "Escape" || !dlOpen) return;
                e.stopPropagation();
                setDlOpen(false);
                document.getElementById("dl-btn")?.focus();
              }}
            >
              <button
                type="button"
                id="dl-btn"
                className="z-btn sm"
                aria-haspopup="true"
                aria-expanded={dlOpen}
                aria-controls="dl-menu"
                disabled={downloading !== null}
                onClick={() => setDlOpen(!dlOpen)}
              >
                {downloading ? "Preparing…" : "Download"}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {dlOpen ? (
                <div id="dl-menu" className="rp-dlmenu" role="group" aria-label="Download this report">
                  <button type="button" onClick={() => void download("pdf")}>
                    PDF<span>{pro ? "To read or print" : "On plans with PDF reports"}</span>
                  </button>
                  <button type="button" onClick={() => void download("csv")}>
                    CSV<span>For Excel or Google Sheets</span>
                  </button>
                </div>
              ) : null}
            </div>
          </>
        }
      />

      {toast ? (
        <div role="status" style={{ background: "#141210", color: "#fff", borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>
          {toast}
        </div>
      ) : null}

      {emailing ? (
        <section
          className="z-card rp-esheet"
          role="dialog"
          aria-label="Email this report"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setEmailing(false);
            }
          }}
          style={{ padding: 16, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end", border: "2px solid #141210" }}
        >
          <label className="rp-fl" style={{ flex: "1 1 280px" }}>
            Send this report to
            <input
              id="rp-to"
              type="email"
              multiple
              className="rp-sel"
              style={{ width: "100%", fontWeight: 400 }}
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void sendEmail();
                }
              }}
            />
          </label>
          <button type="button" className="z-btn" onClick={() => setEmailing(false)}>
            Cancel
          </button>
          <button type="button" className="z-btn pri" disabled={sending} onClick={() => void sendEmail()}>
            {sending ? "Sending…" : "Send PDF"}
          </button>
        </section>
      ) : null}

      <div role="tablist" aria-label="Reports" className="rp-tabs" onKeyDown={tabKey}>
        {TABS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`rtab-${k}`}
            className={`rp-tab${tab === k ? " on" : ""}`}
            aria-selected={tab === k}
            tabIndex={tab === k ? 0 : -1}
            onClick={() => pickTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {showFilters ? (
        <div className="z-card" style={{ padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: "10px 12px", alignItems: "center" }}>
          <label htmlFor="about" style={{ fontSize: 13, color: "#404040" }}>
            Report about
          </label>
          <select id="about" className="rp-sel" value={memberId ?? ""} onChange={(e) => setMember(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Everyone</option>
            {activeMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
            {memberId && !activeMembers.some((m) => m.id === memberId) && r?.member ? <option value={memberId}>{r.member.name}</option> : null}
          </select>
          <label htmlFor="period" style={{ fontSize: 13, color: "#404040", marginLeft: 4 }}>
            Period
          </label>
          <select
            id="period"
            className="rp-sel"
            value={period}
            onChange={(e) => {
              const v = e.target.value as Period;
              if (v === "custom") {
                setCustom([from, to]);
                setPeriod("custom");
                setPicking(true);
              } else {
                setPeriod(v);
                setPicking(false);
                setPerfSel(null);
              }
            }}
          >
            {PERIODS.map((p) => (
              <option key={p.v} value={p.v}>
                {p.label}
              </option>
            ))}
          </select>
          <div style={{ position: "relative" }}>
            <button type="button" className={`rp-icbtn${picking ? " on" : ""}`} aria-label="Pick dates" aria-expanded={picking} onClick={() => setPicking(!picking)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M3 10h18M8 3v4M16 3v4" />
              </svg>
            </button>
            {picking ? (
              <RangePicker
                from={from}
                to={to}
                min={minDay}
                max={today}
                onClose={() => setPicking(false)}
                onApply={(a, b) => {
                  setCustom([a, b]);
                  setPeriod("custom");
                  setPicking(false);
                  setPerfSel(null);
                }}
              />
            ) : null}
          </div>
          <span className="rp-mono rp-num" style={{ marginLeft: "auto", fontSize: 12, color: "#404040" }}>
            {rangeLine}
          </span>
        </div>
      ) : null}

      {tab === "report" ? (
        r === undefined ? (
          report.error ? (
            <ErrorBlock title="We couldn't prepare the report" message={errorMessage(report.error)} onRetry={report.reload} />
          ) : (
            <ReportSkeleton />
          )
        ) : (
          <ReportBody
            report={r}
            colorOf={colorOf}
            pin={pin}
            onPin={(k) => {
              setPin(k);
              const id = k && k.startsWith("m") ? Number(k.slice(1)) : null;
              setPerfSel(id);
            }}
            onPerson={(id) => setMember(id)}
            onShowAll={() => setMember(null)}
            onDay={(date) => r.member && navigate(`/app/activity?member=${r.member.id}&date=${date}`)}
            tip={tip}
          />
        )
      ) : null}

      {tab === "perf" && SAMPLES_ON ? (
        <PerformanceTab
          report={teamReport}
          pending={memberId === null ? report.pending : team.pending}
          error={memberId === null ? report.error : team.error}
          onRetry={memberId === null ? report.reload : team.reload}
          selected={perfSelected}
          onSelect={(id) => {
            setPerfSel(id ?? "none");
            const m = id ? (members ?? []).find((x) => x.id === id) : null;
            setPin(m ? personKey(m.id, m.name) : null);
          }}
          tip={tip}
        />
      ) : null}

      {tab === "sched" ? (
        <SchedulesTab
          members={members ?? []}
          ownerEmail={ownerEmail}
          pro={pro}
          today={today}
          onToast={say}
          onSent={() => setSentKey((k) => k + 1)}
        />
      ) : null}

      {tab === "sent" ? (
        <SentTab refreshKey={sentKey} members={members ?? []} pro={pro} today={today} onLocked={() => setLocked(true)} onToast={say} />
      ) : null}

      {/* Phone only: the main action stays in reach, just above the bottom tab bar. */}
      <div className="rp-sticky rp-ph-only">
        <button type="button" className="z-btn pri" onClick={openEmail}>
          Email report
        </button>
      </div>

      <Sheet open={locked} title="PDF, emailed and scheduled reports" onClose={() => setLocked(false)}>
        <PlanNote module="reports_pro">
          Download reports as a PDF, email them to yourself, a manager or each person, and have Zinwe send them every day, week or month.
        </PlanNote>
      </Sheet>
      {tip.node}
      <span className="z-sr" aria-live="polite">
        {r ? `${r.member ? r.member.name : "Everyone"}, ${dStr(r.from)} to ${dStr(r.to)}` : ""}
      </span>
    </div>
  );
}

function ReportSkeleton(): ReactElement {
  return (
    <div role="status" aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <span className="z-sr">Preparing the report…</span>
      <div className="rp-tiles">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="rp-tile" style={{ gap: 8 }}>
            <Sk w="45%" h={26} />
            <Sk w="60%" h={12} />
          </div>
        ))}
      </div>
      <div className="z-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
        <Sk w={160} h={16} />
        <Sk h={240} style={{ borderRadius: 10 }} />
      </div>
      <div className="z-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <Sk w={120} h={16} />
        {Array.from({ length: 4 }, (_, i) => (
          <Sk key={i} h={14} w={`${90 - i * 8}%`} />
        ))}
      </div>
    </div>
  );
}
