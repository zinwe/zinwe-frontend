import type { ReactElement, ReactNode } from "react";
import { useShell } from "../shell/shellContext";
import { DashIcon, type DashIconName } from "./DashIcon";

/** Skeleton rows while a list loads for the first time. */
export function LoadingState({ label, rows = 3 }: { label: string; rows?: number }): ReactElement {
  return (
    <div className="dash-state dash-state--loading" role="status" aria-live="polite">
      <span className="dash-sr">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div className="dash-skel" key={i} aria-hidden="true">
          <span className="dash-skel__a" />
          <span className="dash-skel__b" />
        </div>
      ))}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
}

/** Full-block error with a retry button (nothing to show yet). */
export function ErrorState({
  title = "We couldn't load this",
  message,
  onRetry,
  retrying = false,
}: ErrorStateProps): ReactElement {
  const { openFeedback, inShell } = useShell();
  return (
    <div className="dash-state dash-state--error" role="alert">
      <span className="dash-state__mark">
        <DashIcon name="alert" />
      </span>
      <h3 className="dash-state__title">{title}</h3>
      <p className="dash-state__body">{message}</p>
      {onRetry ? (
        <button type="button" className="btn btn--ink dash-btn-sm" onClick={onRetry} disabled={retrying}>
          <DashIcon name="refresh" />
          {retrying ? "Trying again…" : "Try again"}
        </button>
      ) : null}
      {inShell ? (
        <button type="button" className="dash-link" onClick={() => openFeedback("issue")}>
          Still not working? Report it
        </button>
      ) : null}
    </div>
  );
}

/** Thin banner when a refresh fails but older data is still on screen. */
export function StaleBanner({ message, onRetry }: { message: string; onRetry: () => void }): ReactElement {
  return (
    <div className="dash-banner dash-banner--warn" role="status">
      <DashIcon name="alert" />
      <span>Showing the last update we got. {message}</span>
      <button type="button" className="dash-link" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

interface EmptyStateProps {
  icon: DashIconName;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon, title, children, action }: EmptyStateProps): ReactElement {
  return (
    <div className="dash-state dash-state--empty">
      <span className="dash-state__mark">
        <DashIcon name={icon} />
      </span>
      <h3 className="dash-state__title">{title}</h3>
      <div className="dash-state__body">{children}</div>
      {action ?? null}
    </div>
  );
}

interface PageHeaderProps {
  title: string;
  lede: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, lede, actions }: PageHeaderProps): ReactElement {
  return (
    <header className="dash-head">
      <div>
        <h1 className="dash-head__title">{title}</h1>
        <p className="dash-head__lede">{lede}</p>
      </div>
      {actions ? <div className="dash-head__actions">{actions}</div> : null}
    </header>
  );
}

/** Small "Refresh" button that spins while a request runs. */
export function RefreshButton({ onClick, pending }: { onClick: () => void; pending: boolean }): ReactElement {
  return (
    <button
      type="button"
      className={`btn btn--ghost dash-btn-sm${pending ? " is-spinning" : ""}`}
      onClick={onClick}
      disabled={pending}
    >
      <DashIcon name="refresh" />
      {pending ? "Checking…" : "Refresh"}
    </button>
  );
}
