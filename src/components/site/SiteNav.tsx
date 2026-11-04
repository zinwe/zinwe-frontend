import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/authContext";
import { NAV_LINKS, RESOURCE_LINKS, WHATS_NEW_BAR } from "../../content/site/shell";
import { cx } from "../../lib/cx";
import { Brand } from "../ui/Brand";
import { ResourceArt } from "./ResourceArt";

/** The active header item for a path (the prototype's `active` prop). */
function activeKey(pathname: string): string {
  if (pathname === "/product") return "product";
  if (pathname === "/plans") return "plans";
  if (pathname === "/download") return "download";
  if (pathname === "/contact") return "contact";
  if (pathname === "/blog" || pathname.startsWith("/blog/") || pathname === "/whats-new") return "resources";
  return "none";
}

/** The Resources page this path is on (the longest matching link), for aria-current inside the menu. */
function activeResource(pathname: string): string | null {
  const hits = RESOURCE_LINKS.filter((r) => pathname === r.to || pathname.startsWith(`${r.to}/`));
  return hits.length ? hits.reduce((a, b) => (b.to.length > a.to.length ? b : a)).to : null;
}

/**
 * Website header v3 (board SiteNav): white bar, warm hairline, the five links and Log in / Start free
 * (signed in: Dashboard). The dark "what's new" strip above it is off until 1.3 ships (WHATS_NEW_BAR.on).
 * Under 860 px the links fold into a menu button that opens a full-width list; Escape or a link closes it.
 * v1.3.2: "Resources" is a disclosure menu (Notion style, owner 31 Oct): three drawn cards (Blog · Newsletter · Free
 * resources) and a New release strip along the bottom. A click, Enter or Space opens it, the arrow keys move between its links, Escape closes it and puts focus back on the button, and
 * clicking outside or tabbing away closes it. On phones the same four links are a Resources section of the list.
 */
export function SiteNav(): ReactElement {
  const { pathname } = useLocation();
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [resOpen, setResOpen] = useState(false);
  const headRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const resRef = useRef<HTMLDivElement>(null);
  const resBtnRef = useRef<HTMLButtonElement>(null);
  // Which link to focus once the Resources panel has rendered (arrow keys on the closed button).
  const focusNext = useRef<number | null>(null);
  const active = activeKey(pathname);
  const resActive = activeResource(pathname);

  // A new page closes the menus.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
    setResOpen(false);
  }

  const resItems = (): HTMLAnchorElement[] => Array.from(resRef.current?.querySelectorAll<HTMLAnchorElement>(".zpl2-res__link") ?? []);
  const focusItem = (index: number) => {
    const items = resItems();
    if (items.length) items[((index % items.length) + items.length) % items.length].focus();
  };

  // Resources menu: Escape closes it (focus back on its button); a click outside closes it.
  useEffect(() => {
    if (!resOpen) return;
    if (focusNext.current !== null) {
      focusItem(focusNext.current);
      focusNext.current = null;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setResOpen(false);
      resBtnRef.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (resRef.current && !resRef.current.contains(event.target as Node)) setResOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [resOpen]);

  const onResButtonKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const index = event.key === "ArrowUp" ? -1 : 0;
    if (resOpen) focusItem(index);
    else {
      focusNext.current = index;
      setResOpen(true);
    }
  };
  const onPanelKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const at = resItems().indexOf(document.activeElement as HTMLAnchorElement);
    if (["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(event.key)) {
      event.preventDefault();
      focusItem(at + (event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusItem(event.key === "Home" ? 0 : -1);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      menuRef.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (headRef.current && !headRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const resourcesMenu = (
    <div
      key="resources"
      className="zpl2-res"
      ref={resRef}
      onBlur={(event) => {
        // Tabbing out of the button and its links closes the menu.
        if (resOpen && !event.currentTarget.contains(event.relatedTarget as Node | null)) setResOpen(false);
      }}
    >
      <button
        ref={resBtnRef}
        type="button"
        className={cx("zs-nav__link zpl2-res__btn", active === "resources" && "is-active")}
        aria-expanded={resOpen}
        aria-controls="zpl2-res-panel"
        onClick={() => setResOpen((o) => !o)}
        onKeyDown={onResButtonKey}
      >
        Resources
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div id="zpl2-res-panel" className="zpl2-res__panel" hidden={!resOpen} onKeyDown={onPanelKey}>
        <div className="zpl2-res__cards">
          {RESOURCE_LINKS.filter((r) => r.art).map((r) => (
            <Link key={r.to} className="zpl2-res__link zpl2-res__card" to={r.to} aria-current={r.to === resActive ? "page" : undefined} onClick={() => setResOpen(false)}>
              {r.art ? <ResourceArt k={r.art} /> : null}
              <b>{r.label}</b>
              <span>{r.sub}</span>
            </Link>
          ))}
        </div>
        {RESOURCE_LINKS.filter((r) => !r.art).map((r) => (
          <Link key={r.to} className="zpl2-res__link zpl2-res__new" to={r.to} aria-current={r.to === resActive ? "page" : undefined} onClick={() => setResOpen(false)}>
            <i>New</i>
            <span>{r.sub}</span>
            <b>
              See new releases <span aria-hidden="true">→</span>
            </b>
          </Link>
        ))}
      </div>
    </div>
  );

  const desktopLinks = NAV_LINKS.map((l) =>
    l.key === "resources" ? (
      resourcesMenu
    ) : (
      <Link key={l.key} className="zs-nav__link" to={l.to} aria-current={l.key === active ? "page" : undefined}>
        {l.label}
      </Link>
    ),
  );

  const phoneLinks = NAV_LINKS.map((l) =>
    l.key === "resources" ? (
      <div key="resources" className="zpl2-dres" role="group" aria-labelledby="zpl2-dres-l">
        <span id="zpl2-dres-l" className="zpl2-dres__l">
          Resources
        </span>
        {RESOURCE_LINKS.map((r) => (
          <Link key={r.to} className="zs-drop__link zpl2-dres__link" to={r.to} aria-current={r.to === resActive ? "page" : undefined}>
            {r.label}
          </Link>
        ))}
      </div>
    ) : (
      <Link key={l.key} className="zs-drop__link" to={l.to} aria-current={l.key === active ? "page" : undefined}>
        {l.label}
      </Link>
    ),
  );

  return (
    <div className="zs-head" ref={headRef}>
      {WHATS_NEW_BAR.on ? (
        <div className="zs-bar">
          <div className="zs-bar__in">
            <span className="zs-bar__new">New</span>
            <span>{WHATS_NEW_BAR.text}</span>
            <Link className="zs-bar__more" to={WHATS_NEW_BAR.to}>
              {WHATS_NEW_BAR.link}
            </Link>
          </div>
        </div>
      ) : null}
      <header className="zs-header">
        <div className="zs-header__row">
          <Brand ariaLabel="Zinwe home" height={30} zingle="website" />
          <nav className="zs-nav" aria-label="Main">
            {desktopLinks}
          </nav>
          <div className="zs-header__end">
            {token ? (
              <Link className="zs-hbtn zs-hbtn--pri" to="/app">
                Dashboard
              </Link>
            ) : (
              <>
                <Link className="zs-hbtn zs-hbtn--ghost zs-hbtn--login" to="/login">
                  Log in
                </Link>
                <Link className="zs-hbtn zs-hbtn--pri" to="/signup?plan=free">
                  Start free
                </Link>
              </>
            )}
            <button
              ref={menuRef}
              type="button"
              className="zs-menu"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              aria-controls="zs-drop"
              onClick={() => setOpen((o) => !o)}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d={open ? "M6 6l12 12M18 6 6 18" : "M4 7h16M4 12h16M4 17h16"} />
              </svg>
            </button>
          </div>
        </div>
        {open ? (
          <nav id="zs-drop" className="zs-drop" aria-label="Main">
            {phoneLinks}
            {token ? null : (
              <Link className="zs-hbtn zs-hbtn--ghost" to="/login">
                Log in
              </Link>
            )}
          </nav>
        ) : null}
      </header>
    </div>
  );
}
