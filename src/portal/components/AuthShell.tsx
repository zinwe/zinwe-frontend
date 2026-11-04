import type { ReactElement, ReactNode } from "react";
import { AnnouncementBar } from "../../components/ui/AnnouncementBar";
import { Brand } from "../../components/ui/Brand";
import { useAuthFonts } from "../v13/authFonts";
import "../../styles/dashboard.css";
import "../../styles/portal.css";
import "../../styles/dash13.css";
import "../../styles/dash13/auth.css";

interface AuthShellProps {
  /** Under the form, e.g. "New to Zinwe? Create an account". */
  footer?: ReactNode;
  children: ReactNode;
}

const POINTS = [
  "Alerts when files go to a pen drive or a remote-control app starts",
  "Set up in an afternoon, no IT team needed",
  "Each person agrees on their own PC first",
] as const;

/**
 * Sign up / log in / reset (AuthFlow board, v1.3): the dark brand panel and the form column side by side.
 * On phones (F-07) it feels like an app: no dark panel, a small logo row, then the title and the form.
 * `.za` gives the v1.3 tokens; `.zau` scopes this board's styles.
 */
export function AuthShell({ footer, children }: AuthShellProps): ReactElement {
  useAuthFonts();
  return (
    <div className="za zau" data-clarity-mask="true">
      <AnnouncementBar className="abar--flush" />
      <div className="zau-shell">
        <aside className="zau-side">
          <Brand to="/" ariaLabel="Zinwe home" tone="light" height={30} className="zau-brand" />
          <div className="zau-side__body">
            <h2 className="zau-side__title">Know what's happening to your data. In plain English.</h2>
            <ul className="zau-side__list">
              {POINTS.map((point) => (
                <li key={point}>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#F26A0A"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <span className="zau-side__small">For teams of 5–50 in India and the US.</span>
        </aside>

        <main className="zau-main">
          <div className="zau-col">
            <Brand to="/" ariaLabel="Zinwe home" height={26} className="zau-phonebrand" zingle="website" />
            {children}
            {footer ? <p className="zau-alt">{footer}</p> : null}
          </div>
        </main>
      </div>
    </div>
  );
}
