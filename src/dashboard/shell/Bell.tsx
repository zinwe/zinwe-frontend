import { useEffect, useRef, useState, type ReactElement } from "react";
import { Link, useLocation } from "react-router-dom";
import { formatDateTime, formatRelative, useNow } from "../time";
import { ZIcon, type IconName } from "../ui/ZIcon";
import type { BellKind } from "./bellFeed";
import { useShell } from "./shellContext";

const KIND_ICON: Record<BellKind, IconName> = {
  alert: "alerts",
  chat: "chat",
  approval: "break",
  task: "tasks",
  news: "news",
};

/** How many, on the bell: a small orange count (99+ past that). */
function BellCount({ n }: { n: number }): ReactElement | null {
  if (!n) return null;
  return (
    <span className="zn-bell__count" aria-hidden="true">
      {n > 99 ? "99+" : n}
    </span>
  );
}

/**
 * The phone top bar's bell (6 Nov 2026, board nav-v2): Alerts left the bottom bar, so the bell opens the Alerts page
 * and counts the open "Needs you" alerts (server count critical_unhandled, the number the Alerts tab used to show).
 * Chats, tasks and news keep their own badges in the bottom bar and the More sheet.
 */
function AlertsBell(): ReactElement {
  const { alerts } = useShell();
  const { pathname } = useLocation();
  const here = pathname.replace(/\/+$/, "") === "/app/alerts";
  const label = alerts ? `Notifications, ${alerts} new` : "Notifications, nothing new";
  return (
    <div className="zn-tb zn-tb-nav">
      <Link to="/app/alerts" className="zn-bell" aria-label={label} title={label} aria-current={here ? "page" : undefined}>
        <span className="zn-bell__ico" aria-hidden="true">
          <ZIcon name="bell" size={20} />
          <BellCount n={alerts} />
        </span>
      </Link>
    </div>
  );
}

/**
 * DashTopBar: the bell and its panel. Pages put it LAST in their header row (PageHead does that);
 * placement="nav" is the bell in the phone top bar, which opens Alerts (AlertsBell; CSS shows one of the two).
 * The panel's items are real (shell/bellFeed.ts): alerts that need you, unread chats, requests and tasks waiting for
 * your OK, news. The button shows how many are unread as a small count; the panel says it too. Escape, a tap outside
 * or picking an item closes it, and focus goes back to the bell.
 */
export function Bell({ placement = "page" }: { placement?: "page" | "nav" }): ReactElement {
  return placement === "nav" ? <AlertsBell /> : <BellPanel />;
}

function BellPanel(): ReactElement {
  const { bell } = useShell();
  const { items, unread, failed, markRead, reload } = bell;
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = "zn-bell-panel-page";
  const titleId = `${panelId}-title`;
  const now = useNow(60_000);
  const list = items ?? [];
  const shown = list.filter((n) => filter === "all" || !n.read);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const label = unread ? `Notifications, ${unread} new` : "Notifications, nothing new";

  return (
    <div className="zn-tb zn-tb-page">
      <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
        <button
          ref={button}
          type="button"
          className={`zn-bell${open ? " open" : ""}`}
          aria-label={label}
          title={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="zn-bell__ico" aria-hidden="true">
            <ZIcon name="bell" size={20} />
            <BellCount n={unread} />
          </span>
        </button>

        {open ? (
          <>
            <button type="button" tabIndex={-1} className="zn-closer" style={{ zIndex: 90 }} aria-label="Close notifications" onClick={() => close()} />
            <div ref={panel} id={panelId} role="dialog" aria-labelledby={titleId} tabIndex={-1} className="zn-bell-panel">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "14px 14px 10px" }}>
                <b id={titleId} style={{ fontSize: 16 }}>
                  Notifications{unread ? <span style={{ fontWeight: 500, color: "#6B6B6B" }}> · {unread} new</span> : null}
                </b>
                <button
                  type="button"
                  onClick={() => markRead("all")}
                  disabled={unread === 0}
                  style={{
                    border: 0,
                    background: "none",
                    padding: "4px 2px",
                    minHeight: 32,
                    fontSize: 13,
                    fontWeight: 600,
                    textDecoration: "underline",
                    cursor: unread ? "pointer" : "default",
                    color: unread ? "#A84505" : "#6B6B6B",
                  }}
                >
                  Mark all as read
                </button>
              </div>
              <div role="group" aria-label="Show" className="z-segs" style={{ margin: "0 14px 10px", alignSelf: "flex-start" }}>
                <button type="button" className="z-seg" aria-pressed={filter === "all"} onClick={() => setFilter("all")} style={{ minHeight: 30 }}>
                  All · {list.length}
                </button>
                <button type="button" className="z-seg" aria-pressed={filter === "unread"} onClick={() => setFilter("unread")} style={{ minHeight: 30 }}>
                  Unread · {unread}
                </button>
              </div>
              <div className="zn-tb-list">
                {shown.map((n) => (
                  <Link
                    key={n.id}
                    to={n.href}
                    className="zn-note"
                    data-kind={n.kind}
                    onClick={() => {
                      markRead([n.id]);
                      close(false);
                    }}
                  >
                    <span className="zn-note__ico" aria-hidden="true">
                      <ZIcon name={KIND_ICON[n.kind]} size={15} stroke={2} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2, lineHeight: 1.35 }}>
                      <span style={{ fontSize: 14, color: "#141210", fontWeight: n.read ? 500 : 700, overflowWrap: "anywhere" }}>
                        {!n.read ? <span className="z-sr">Unread: </span> : null}
                        {n.title}
                      </span>
                      {n.body ? <span style={{ fontSize: 13, color: "#404040", overflowWrap: "anywhere" }}>{n.body}</span> : null}
                      <span style={{ fontSize: 12, color: "#6B6B6B" }}>
                        <time dateTime={n.at} title={formatDateTime(n.at)}>
                          {formatRelative(n.at, now, "")}
                        </time>{" "}
                        · Opens {n.opens}
                      </span>
                    </span>
                    {!n.read ? (
                      <span aria-hidden="true" style={{ flex: "none", width: 9, height: 9, marginTop: 6, borderRadius: "50%", background: "#F26A0A" }} />
                    ) : null}
                  </Link>
                ))}
                {items === undefined ? (
                  <p role="status" style={{ margin: 0, padding: "28px 14px", textAlign: "center", color: "#404040" }}>
                    Loading…
                  </p>
                ) : failed && list.length === 0 ? (
                  <p role="alert" style={{ margin: 0, padding: "24px 14px", textAlign: "center", color: "#404040" }}>
                    We couldn't load your notifications.{" "}
                    <button type="button" className="z-btn sm" onClick={reload} style={{ marginTop: 8 }}>
                      Try again
                    </button>
                  </p>
                ) : shown.length === 0 ? (
                  <p style={{ margin: 0, padding: "28px 14px", textAlign: "center", color: "#404040" }}>
                    {filter === "unread" && list.length ? "Nothing unread." : "You're all caught up."}
                  </p>
                ) : null}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 14px 12px", background: "#FAFAFA", fontSize: 12, color: "#404040" }}>
                <span>Alerts that need you, unread chats, requests waiting for your OK and news. Read marks are kept on this browser.</span>
                <Link to="/app/settings/notifications" style={{ color: "#A84505", fontWeight: 600 }} onClick={() => close(false)}>
                  Notification settings
                </Link>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
