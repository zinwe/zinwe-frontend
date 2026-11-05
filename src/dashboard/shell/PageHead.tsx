import type { ReactElement, ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Bell } from "./Bell";
import { activeFor, type NavKey } from "./shellContext";

/** Pages whose description line is left out on a phone (6 Nov 2026): the heading and the content say enough there. */
const NO_PHONE_LEDE: ReadonlySet<NavKey> = new Set<NavKey>(["team", "alerts", "tasks"]);

/**
 * The header row every board starts with: small label (date / section) + h1 (+ optional lede) on the left,
 * the page's actions, then the bell as the LAST item (no row of its own).
 * On a phone the bell moves to the top bar; actions marked `zn-desk-only` hide (they live in the "+" sheet).
 * `phoneLede={false}` keeps the lede off phones (desktop still shows it); by default that is so on People & PCs,
 * Alerts and Tasks.
 */
export function PageHead({
  label,
  title,
  lede,
  actions,
  id,
  phoneLede,
}: {
  label?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  id?: string;
  /** Show the lede on a phone too (default: yes, except on People & PCs, Alerts and Tasks). */
  phoneLede?: boolean;
}): ReactElement {
  const { pathname } = useLocation();
  const ledeOnPhone = phoneLede ?? !NO_PHONE_LEDE.has(activeFor(pathname));
  return (
    <header className="zn-head">
      <div className="zn-head__text">
        {label ? <span className="z-lbl">{label}</span> : null}
        <h1 id={id} style={label ? undefined : { marginTop: 0 }}>
          {title}
        </h1>
        {lede ? <p className={ledeOnPhone ? undefined : "zn-head__lede--desk"}>{lede}</p> : null}
      </div>
      {actions ? <div className="zn-head__acts">{actions}</div> : null}
      <Bell placement="page" />
    </header>
  );
}
