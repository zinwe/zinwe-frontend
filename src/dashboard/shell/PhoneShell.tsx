import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { Brand } from "../../components/ui/Brand";
import { BrandMark } from "../../components/ui/BrandMark";
import { ZIcon, type IconName } from "../ui/ZIcon";
import { Bell } from "./Bell";
import { NAV_TITLE, type NavKey } from "./shellContext";

/**
 * DashNav under 760 px: an app shell. Top bar (logo, page title, bell, "+"), a fixed bottom tab bar
 * Home · Team · Chat · Tasks · More (6 Nov 2026: Alerts left the bar, the bell opens them and counts the new ones),
 * and bottom sheets for More and Create (Tasks is not repeated in More: it has its own tab). Chat counts unread messages; Tasks counts the tasks waiting on you or late.
 * On Chat the bar shows no title (the page's own heading says it), and an open chat hides the tab bar (chat.css).
 * No tab is lit on Alerts: the bell is how you get there.
 */

type SheetKind = "" | "more" | "create";

const TAB_OF: Partial<Record<NavKey, string>> = { overview: "home", alerts: "", team: "team", activity: "team", chat: "chat", tasks: "tasks" };

/** The Tasks tab: a ticked box (board nav-v2), not the desktop menu's square-with-tick. */
const TASKS_TAB_ICON = "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11";

export function PhoneShell({
  active,
  title,
  unread,
  tasksBadge = 0,
  tasksLate = 0,
  name,
  company,
  onLogout,
}: {
  active: NavKey;
  title?: string;
  unread: number;
  /** Open tasks waiting on the owner or past their due time, each counted once: the Tasks tab badge. */
  tasksBadge?: number;
  /** Of those, how many are late (only for the badge's spoken words). */
  tasksLate?: number;
  name: string;
  company: string;
  onLogout: () => void;
}): ReactElement {
  const [sheet, setSheet] = useState<SheetKind>("");
  const opener = useRef<HTMLElement | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const tabOn = TAB_OF[active] ?? "more";

  const openSheet = (kind: SheetKind, from: HTMLElement) => {
    opener.current = from;
    setSheet(kind);
  };
  const closeSheet = () => {
    setSheet("");
    opener.current?.focus();
  };

  useEffect(() => {
    if (!sheet) return;
    sheetRef.current?.querySelector<HTMLElement>("[data-close]")?.focus();
  }, [sheet]);

  const sheetKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeSheet();
      return;
    }
    if (e.key !== "Tab") return;
    // Keep Tab inside the open sheet.
    const root = sheetRef.current;
    const f = root ? Array.from(root.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")) : [];
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === root)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const tab = (key: string, label: string, to: string, icon: IconName | { d: string }, badge = 0, red = false, words = "") => {
    const on = key === tabOn;
    return (
      <Link
        key={key}
        to={to}
        className={`zn-tab${on ? " on" : ""}`}
        aria-current={on ? "page" : undefined}
        aria-label={label + (badge ? `, ${badge} ${words}` : "")}
      >
        {on ? <span className="zn-tab__bar" aria-hidden="true" /> : null}
        <span aria-hidden="true" style={{ position: "relative", display: "inline-flex" }}>
          {typeof icon === "string" ? <ZIcon name={icon} size={22} /> : <ZIcon d={icon.d} size={22} />}
          {badge ? <span className={`zn-tab__badge${red ? " red" : ""}`}>{badge}</span> : null}
        </span>
        <span aria-hidden="true">{label}</span>
      </Link>
    );
  };

  const row = (on: boolean, label: string, to: string, icon: IconName, isNews = false) => (
    <Link key={label} to={to} className={`zn-srow${on ? " on" : ""}`} aria-current={on ? "page" : undefined} onClick={() => setSheet("")}>
      <ZIcon name={icon} size={20} />
      <span style={{ flex: 1 }}>{label}</span>
      {isNews ? (
        <span className="z-mono" style={{ flex: "none", fontSize: 12, color: "#6B6B6B" }}>
          Zinwe 1.3
        </span>
      ) : null}
    </Link>
  );

  const createLinks: ReadonlyArray<{ label: string; sub: string; to: string; icon: IconName }> = [
    { label: "New task", sub: "Give someone a job and a due day", to: "/app/tasks#new=1", icon: "tasks" },
    { label: "Message someone", sub: "Opens Chat. It goes to their Zinwe app", to: "/app/chat", icon: "chat" },
    { label: "Add a person", sub: "Set up a new member and their PC", to: "/app/team#add=1", icon: "person" },
  ];

  return (
    <>
      <div className="zn-phonebar">
        <Link to="/app" aria-label="Zinwe, go to Overview" style={{ flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 36, height: 44, textDecoration: "none", borderRadius: 10 }}>
          <BrandMark size={28} />
        </Link>
        <span className="zn-phonebar__title">{active === "chat" ? "" : title || NAV_TITLE[active] || "Zinwe"}</span>
        <Bell placement="nav" />
        {/* Tasks has its own "New task" pill (v1.4): no second + here. */}
        {active === "tasks" ? null : (
          <button
            type="button"
            className="z-iconbtn"
            aria-label="Create"
            aria-haspopup="dialog"
            aria-expanded={sheet === "create"}
            aria-controls="zn-create-sheet"
            onClick={(e) => openSheet("create", e.currentTarget)}
          >
            <span className="zn-plus" aria-hidden="true">
              <ZIcon name="plus" size={18} stroke={2.4} />
            </span>
          </button>
        )}
      </div>

      <nav className="zn-tabbar" aria-label="Main">
        {tab("home", "Home", "/app", "home")}
        {tab("team", "Team", "/app/team", "team")}
        {tab("chat", "Chat", "/app/chat", "chat", unread, false, "unread")}
        {tab("tasks", "Tasks", "/app/tasks", { d: TASKS_TAB_ICON }, tasksBadge, false, tasksLate ? "waiting on you or late" : "waiting on you")}
        <button
          type="button"
          className={`zn-tab${tabOn === "more" ? " on" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={sheet === "more"}
          aria-controls="zn-more-sheet"
          onClick={(e) => openSheet("more", e.currentTarget)}
        >
          {tabOn === "more" ? <span className="zn-tab__bar" aria-hidden="true" /> : null}
          <span aria-hidden="true" style={{ position: "relative", display: "inline-flex" }}>
            <ZIcon name="more" size={22} stroke={2.6} />
          </span>
          <span>More</span>
        </button>
      </nav>

      {sheet ? (
        <div className="zn-phoneonly">
          <button type="button" tabIndex={-1} aria-label={sheet === "more" ? "Close More" : "Close Create"} className="zn-psheet-scrim" onClick={closeSheet} />
          <div
            ref={sheetRef}
            id={sheet === "more" ? "zn-more-sheet" : "zn-create-sheet"}
            className="zn-psheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={sheet === "more" ? "zn-more-title" : "zn-create-title"}
            tabIndex={-1}
            onKeyDown={sheetKey}
          >
            <span className="zn-grab" aria-hidden="true" />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "0 2px 4px 8px" }}>
              <b id={sheet === "more" ? "zn-more-title" : "zn-create-title"} style={{ fontSize: 18, letterSpacing: "-0.01em" }}>
                {sheet === "more" ? "More" : "Create"}
              </b>
              <button type="button" className="z-iconbtn" aria-label="Close" data-close onClick={closeSheet}>
                <ZIcon name="close" size={20} stroke={2} />
              </button>
            </div>
            {sheet === "more" ? (
              <>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#6B6B6B", padding: "6px 8px 2px" }}>Protection</span>
                {row(active === "websites", "Internet usage", "/app/internet", "websites")}
                {row(active === "data", "Data safety", "/app/data", "data")}
                {row(active === "apps", "Apps & remote", "/app/remote", "apps")}
                <span className="zn-sdiv" aria-hidden="true" />
                {row(active === "reports", "Reports", "/app/reports", "reports")}
                {row(active === "rules", "Rules", "/app/rules", "rules")}
                {row(active === "settings", "Settings", "/app/settings", "settings")}
                {row(active === "help", "Help & support", "/app/help", "help")}
                {row(false, "What's new", "/app/help#tab=whats-new", "news", true)}
                {/* A full page load: the website is its own pre-rendered page with its own CSS. */}
                <a href="/" className="zn-srow">
                  <ZIcon name="home" size={20} />
                  <span style={{ flex: 1 }}>Back to site</span>
                </a>
                <span className="zn-sdiv" aria-hidden="true" />
                <button type="button" className="zn-srow zn-out" onClick={onLogout}>
                  <ZIcon name="logout" size={20} />
                  <span>Log out</span>
                </button>
                <span style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px 0", fontSize: 12, color: "#6B6B6B" }}>
                  <Brand variant="static" height={18} />
                  <span style={{ minWidth: 0 }}>
                    Signed in as {name} · Owner · {company}
                  </span>
                </span>
              </>
            ) : (
              <>
                {createLinks.map((c) => (
                  <Link key={c.label} to={c.to} className="zn-srow" style={{ minHeight: 56, padding: "6px 10px", color: "#141210" }} onClick={() => setSheet("")}>
                    <span aria-hidden="true" style={{ flex: "none", width: 36, height: 36, borderRadius: 10, background: "#FDEBDC", color: "#8A3A04", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                      <ZIcon name={c.icon} size={18} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1, lineHeight: 1.3 }}>
                      <b style={{ fontSize: 15, fontWeight: 600 }}>{c.label}</b>
                      <span style={{ fontSize: 13, color: "#404040" }}>{c.sub}</span>
                    </span>
                  </Link>
                ))}
                <button type="button" onClick={closeSheet} style={{ marginTop: 8, minHeight: 48, borderRadius: 12, border: "1px solid #D4D4D4", background: "#FFFFFF", color: "#141210", fontWeight: 600 }}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
