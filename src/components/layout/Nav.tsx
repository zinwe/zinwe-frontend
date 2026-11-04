import { useEffect, useRef, useState, type ReactElement } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/authContext";
import { cx } from "../../lib/cx";
import { Brand } from "../ui/Brand";

export function Nav(): ReactElement {
  const { pathname } = useLocation();
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(() => window.scrollY > 8);
  const headerRef = useRef<HTMLElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // The phone menu closes on Escape (focus back on ☰) and on a tap outside it.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      burgerRef.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (headerRef.current && !headerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const close = () => setOpen(false);
  const current = (path: string) => (pathname === path ? "page" : undefined);
  const onBlog = pathname.startsWith("/blog");

  return (
    <header className={cx("nav", scrolled && "is-scrolled")} ref={headerRef}>
      <div className="wrap nav__row">
        <Brand ariaLabel="Zinwe home" zingle="website" />
        <button
          ref={burgerRef}
          className={cx("nav__burger", open && "is-open")}
          type="button"
          aria-label="Menu"
          aria-expanded={open}
          aria-controls="site-menu"
          onClick={() => setOpen((o) => !o)}
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
        {/* In the order a visitor asks: what is it, what does it cost, how do I get it, learn more, talk to us.
            The logo is the way home. */}
        <ul id="site-menu" className={cx("nav__links", open && "is-open")}>
          <li>
            <Link to="/#how" onClick={close}>
              How it works
            </Link>
          </li>
          <li>
            <Link to="/plans" aria-current={current("/plans")} onClick={close}>
              Plans
            </Link>
          </li>
          <li>
            <Link to="/download" aria-current={current("/download")} onClick={close}>
              Download
            </Link>
          </li>
          <li>
            <Link to="/blog" aria-current={onBlog ? "page" : undefined} onClick={close}>
              Blog
            </Link>
          </li>
          <li>
            <Link to="/contact" aria-current={current("/contact")} onClick={close}>
              Contact
            </Link>
          </li>
          {/* One way in for each visitor: sign in, or start free (which is sign-up); signed in = the dashboard. */}
          <li className="nav__cta">
            {token ? (
              <Link className="btn btn--primary" to="/app" onClick={close}>
                Dashboard <span className="arr">→</span>
              </Link>
            ) : (
              <>
                <Link className="btn btn--ghost" to="/login" aria-current={current("/login")} onClick={close}>
                  Log in
                </Link>
                <Link className="btn btn--primary" to="/signup?plan=free" onClick={close}>
                  Start free <span className="arr">→</span>
                </Link>
              </>
            )}
          </li>
        </ul>
      </div>
    </header>
  );
}
