import { Fragment, useEffect, useRef, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { Brand } from "../../components/ui/Brand";
import type { PlanModule } from "../../lib/api";
import { ZIcon, type IconName } from "../ui/ZIcon";
import type { NavKey } from "./shellContext";

/**
 * DashNav (desktop, 248 px): 7 rows, no group labels (owner decision, 28 Oct). Team and Protection list their
 * pages as indented sub-rows; Chat and Tasks are separate rows. Badges: Alerts = open "Needs you" alerts (red),
 * Chat = chats with something unread (dark, v1.4), Tasks = waiting for you (soft). Settings, Help & support and Log out sit in the
 * account menu under the profile button (What's new lives in Help), with Send feedback and Report an issue. Above the
 * profile sits one Upgrade button (only when a higher plan exists); a Feedback icon sits on the profile's right (F-03).
 * Team and Protection fold (owner note p_nav, 5 Nov): the row opens its page, the chevron on its right folds or opens
 * the sub-rows. Folded with the current page inside, the group row keeps the orange tint. Folding is remembered on
 * this browser; everything starts open.
 */

type GroupKey = "team" | "protection";
const FOLD_KEY = "zinwe.nav.folded";

function readFolded(): ReadonlySet<GroupKey> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(FOLD_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((k): k is GroupKey => k === "team" || k === "protection") : []);
  } catch {
    return new Set();
  }
}

function saveFolded(folded: ReadonlySet<GroupKey>): void {
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify([...folded]));
  } catch {
    /* storage blocked: the fold lasts until reload */
  }
}

const GROUP: Partial<Record<NavKey, NavKey | "protection">> = { activity: "team", websites: "protection", data: "protection", apps: "protection" };

interface Row {
  key: NavKey | "protection";
  label: string;
  to: string;
  icon?: IconName;
  badge?: number;
  tone?: "red" | "dark" | "soft";
  parent?: boolean;
  sub?: boolean;
  module?: PlanModule;
  tour?: string;
}

export interface DashNavProps {
  active: NavKey;
  alerts: number;
  unread: number;
  tasksWaiting: number;
  name: string;
  email: string;
  company: string;
  initials: string;
  isLocked: (m: PlanModule) => boolean;
  onLogout: () => void;
  leaving: boolean;
  /** A higher plan exists (useUpgrade().canUpgrade): shows the Upgrade link above the profile. */
  canUpgrade?: boolean;
  onUpgrade?: () => void;
  onFeedback?: () => void;
  onReportIssue?: () => void;
  /** Show every group open whatever was folded (the tour points at rows inside them). */
  unfoldAll?: boolean;
}

function navRows(alerts: number, unread: number, tasksWaiting: number): Row[] {
  const rows: Row[] = [
    { key: "overview", label: "Overview", to: "/app", icon: "overview", tour: "overview" },
    { key: "alerts", label: "Alerts", to: "/app/alerts", icon: "alerts", badge: alerts, tone: "red", tour: "alerts" },
    { key: "team", label: "Team", to: "/app/team", icon: "team", parent: true, tour: "team" },
    { key: "team", label: "People & PCs", to: "/app/team", sub: true },
    { key: "activity", label: "Today's activity", to: "/app/activity", sub: true, module: "work_time", tour: "activity" },
    { key: "protection", label: "Protection", to: "/app/internet", icon: "protection", parent: true, tour: "protection" },
    { key: "websites", label: "Internet usage", to: "/app/internet", sub: true, module: "web" },
    { key: "data", label: "Data safety", to: "/app/data", sub: true },
    { key: "apps", label: "Apps & remote tools", to: "/app/remote", sub: true, module: "remote_access" },
    { key: "chat", label: "Chat", to: "/app/chat", icon: "chat", badge: unread, tone: "dark", module: "team_chat", tour: "chat" },
    { key: "tasks", label: "Tasks", to: "/app/tasks", icon: "tasks", badge: tasksWaiting, tone: "soft" },
    { key: "reports", label: "Reports", to: "/app/reports", icon: "reports" },
    { key: "rules", label: "Rules", to: "/app/rules", icon: "rules" },
  ];
  // Tasks run on the FR-20 API (v1.3.1): shown in every build.
  return rows;
}

/** The rows in order, each group row with the sub-rows under it. */
function groupRows(rows: Row[]): { head: Row; subs: Row[] }[] {
  const out: { head: Row; subs: Row[] }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (r.sub && last?.head.parent) last.subs.push(r);
    else out.push({ head: r, subs: [] });
  }
  return out;
}

export function DashNav({
  active,
  alerts,
  unread,
  tasksWaiting,
  name,
  email,
  company,
  initials,
  isLocked,
  onLogout,
  leaving,
  canUpgrade = false,
  onUpgrade,
  onFeedback,
  onReportIssue,
  unfoldAll = false,
}: DashNavProps): ReactElement {
  const group = GROUP[active] ?? active;
  const [folded, setFolded] = useState<ReadonlySet<GroupKey>>(readFolded);
  const toggleFold = (key: GroupKey) => {
    const next = new Set(folded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setFolded(next);
    saveFolded(next);
  };
  const inMenu = active === "settings" || active === "help";
  const [meOpen, setMeOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const meBtn = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  // Escape or a press anywhere outside the menu and its button closes it (F-04). A listener, not a backdrop: a
  // backdrop inside the sticky nav sat under .zn-main, so clicks on the page never reached it.
  useEffect(() => {
    if (!meOpen) return;
    menu.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMeOpen(false);
        meBtn.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (wrap.current && e.target instanceof Node && !wrap.current.contains(e.target)) setMeOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [meOpen]);

  // One menu row. `foldedHere`: a folded group's row while the current page is inside it (orange tint, aria-current).
  const renderRow = (r: Row, foldedHere = false): ReactElement => {
    const on = r.sub ? r.key === active : !r.parent && r.key === active;
    const open = r.parent && r.key === group;
    const cls = `zn-mrow${r.sub ? " sub" : ""}${on ? " on" : ""}${open ? " open" : ""}${foldedHere ? " folded-here" : ""}`;
    const locked = r.module ? isLocked(r.module) : false;
    return (
      <Link
        key={`${r.key}-${r.label}`}
        to={r.to}
        className={cls}
        aria-current={on ? "page" : foldedHere ? "true" : undefined}
        data-tour={r.tour}
      >
        {r.icon ? <ZIcon name={r.icon} /> : null}
        <span className="zn-label">{r.label}</span>
        {locked ? (
          <span className="zn-lock" aria-label="Not on your plan" title="Not on your plan">
            <ZIcon name="lock" size={14} />
          </span>
        ) : null}
        {r.badge ? (
          <span className={`zn-badge${r.tone === "red" ? " red" : r.tone === "soft" ? " soft" : ""}`} aria-label={`${r.badge} ${r.key === "chat" ? "unread chats" : r.key === "alerts" ? "need you" : "waiting for you"}`}>
            {r.badge}
          </span>
        ) : null}
      </Link>
    );
  };

  return (
    <nav className="zn-nav" aria-label="Dashboard">
      <Brand to="/app" ariaLabel="Zinwe, go to Overview" height={26} className="zn-brand" zingle="dashboard" />
      <div className="zn-items">
        {groupRows(navRows(alerts, unread, tasksWaiting)).map(({ head: r, subs }) => {
          if (!r.parent) return renderRow(r);
          const key = r.key as GroupKey;
          const isFolded = !unfoldAll && folded.has(key);
          const here = r.key === group;
          const subsId = `zn-grp-${key}`;
          return (
            <Fragment key={`${r.key}-${r.label}`}>
              <div className="zn-grp">
                {renderRow(r, isFolded && here)}
                <button
                  type="button"
                  className="zn-grp__chev"
                  aria-expanded={!isFolded}
                  aria-controls={subsId}
                  aria-label={`Show ${r.label} pages`}
                  title={`Fold or open ${r.label}`}
                  onClick={() => toggleFold(key)}
                >
                  <ZIcon name="chevronDown" size={16} stroke={2} />
                </button>
              </div>
              <div id={subsId} className="zn-grp__subs" hidden={isFolded}>
                {subs.map((sub) => renderRow(sub))}
              </div>
            </Fragment>
          );
        })}
      </div>


      <div className="zn-me-wrap" ref={wrap}>
        {canUpgrade && onUpgrade ? (
          <button type="button" className="zn-quick-up" onClick={onUpgrade}>
            <ZIcon name="upgrade" size={14} stroke={2.2} />
            <span>Upgrade</span>
          </button>
        ) : null}
        {meOpen ? (
          <>
            <div ref={menu} id="zn-me-menu" role="menu" aria-label="Account" tabIndex={-1} className="zn-me-menu">
              <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "12px 12px 10px", lineHeight: 1.3, borderBottom: "1px solid #F5F5F5" }}>
                <b style={{ fontSize: 14 }}>{name}</b>
                <span className="z-ell" style={{ fontSize: 12, color: "#404040" }} title={email}>
                  {email}
                </span>
                <span style={{ fontSize: 12, color: "#6B6B6B" }}>Owner · {company}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", padding: 6 }}>
                <Link to="/app/settings" role="menuitem" className={`zn-mi${active === "settings" ? " on" : ""}`} onClick={() => setMeOpen(false)}>
                  <ZIcon name="settings" size={17} />
                  <span style={{ flex: 1 }}>Settings</span>
                </Link>
                <Link to="/app/help" role="menuitem" className={`zn-mi${active === "help" ? " on" : ""}`} onClick={() => setMeOpen(false)}>
                  <ZIcon name="help" size={17} />
                  <span style={{ flex: 1 }}>Help &amp; support</span>
                </Link>
                {onFeedback ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="zn-mi"
                    onClick={() => {
                      setMeOpen(false);
                      onFeedback();
                    }}
                  >
                    <ZIcon name="feedback" size={17} />
                    <span style={{ flex: 1 }}>Send feedback</span>
                  </button>
                ) : null}
                {onReportIssue ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="zn-mi"
                    onClick={() => {
                      setMeOpen(false);
                      onReportIssue();
                    }}
                  >
                    <ZIcon name="issue" size={17} />
                    <span style={{ flex: 1 }}>Report an issue</span>
                  </button>
                ) : null}
                {/* A full page load (not a router link): the website is its own pre-rendered page with its own CSS. */}
                <a href="/" role="menuitem" className="zn-mi">
                  <ZIcon name="home" size={17} />
                  <span style={{ flex: 1 }}>Back to site</span>
                </a>
              </div>
              <div style={{ padding: 6, borderTop: "1px solid #F5F5F5" }}>
                <button type="button" role="menuitem" className="zn-mi zn-out" onClick={onLogout} disabled={leaving}>
                  <ZIcon name="logout" size={17} />
                  <span>{leaving ? "Logging out…" : "Log out"}</span>
                </button>
              </div>
              <div className="z-mono" style={{ padding: "7px 12px 9px", background: "#FAFAFA", fontSize: 11, color: "#6B6B6B" }}>
                Zinwe 1.3
              </div>
            </div>
          </>
        ) : null}

        <div className="zn-me-row">
        <button
          ref={meBtn}
          type="button"
          className={`zn-me${meOpen ? " open" : ""}${inMenu && !meOpen ? " in-menu" : ""}`}
          aria-haspopup="menu"
          aria-expanded={meOpen}
          aria-controls="zn-me-menu"
          aria-label={`Account menu, ${name}`}
          onClick={() => setMeOpen((o) => !o)}
        >
          <span className="zn-avatar">{initials}</span>
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25, minWidth: 0, flex: 1, textAlign: "left" }}>
            <b className="z-ell" style={{ fontSize: 13 }}>
              {name}
            </b>
            <span style={{ fontSize: 12, color: "#6B6B6B" }}>
              {inMenu ? (active === "settings" ? "Owner · Settings" : "Owner · Help & support") : "Owner"}
            </span>
          </span>
          <ZIcon
            name="chevronUp"
            size={16}
            stroke={2}
            style={{ color: "#6B6B6B", transition: "transform .15s", transform: `rotate(${meOpen ? 0 : 180}deg)` }}
          />
        </button>
        {onFeedback ? (
          <button type="button" className="zn-me-fb" onClick={onFeedback} aria-label="Send feedback" title="Send feedback">
            <ZIcon name="feedback" size={18} />
          </button>
        ) : null}
        </div>
      </div>
    </nav>
  );
}
