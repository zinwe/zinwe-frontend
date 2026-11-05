import { Suspense, useEffect, useState, type ReactElement } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/authContext";
import { canUseApp } from "../../auth/steps";
import { AnnouncementBar } from "../../components/ui/AnnouncementBar";
import { Brand } from "../../components/ui/Brand";
import { useIsPhone } from "../../hooks/useIsPhone";
import { PlanTopBar } from "../components/PlanSwipe";
import { useAuthFonts } from "../v13/authFonts";
import { PlanFlowContext, type PlanFlow } from "./flow";
import "../../styles/dashboard.css";
import "../../styles/portal.css";
import "../../styles/dash13.css";
import "../../styles/dash13/auth.css";
import "../../styles/dash13/plans.css";

const REGISTER_STEPS = ["Your company", "Choose plan", "Pay", "Done"] as const;
const UPGRADE_STEPS = ["Choose plan", "Pay", "Done"] as const;
const STAGE_LABEL: Record<PlanFlow["stage"], (typeof UPGRADE_STEPS)[number]> = { choose: "Choose plan", pay: "Pay", done: "Done" };

/**
 * Onboarding (AuthFlow board, v1.3): a white header with the logo, the stepper (Your company, Choose plan, Pay, Done
 * when registering; Choose plan, Pay, Done on a plan) and, once the dashboard is open, "Skip to dashboard" (new
 * owners) or "Back to dashboard" (upgrades). A new owner who can't use the dashboard yet (company step) sees their
 * account with Log out instead: their only way out.
 * On a phone the plan page draws its own top bar here instead (Back, "Choose a plan · Step 2 of 4", Skip; flow.ts `bar`).
 */
export default function OnboardingLayout(): ReactElement {
  useAuthFonts();
  const { user, onboarding, signOut } = useAuth();
  const { pathname } = useLocation();
  const [leaving, setLeaving] = useState(false);
  const [flow, setFlow] = useState<PlanFlow | null>(null);
  // A phone on the plan page: the page's own top bar (Back, title, Skip) replaces the header (PhonePlanApp board).
  const phone = useIsPhone();
  const bar = phone ? (flow?.bar ?? null) : null;
  const step = onboarding?.step;
  const inApp = Boolean(step && canUseApp(step));
  // The plan pages say where they are (flow.ts); the others go by the address and the account's step.
  const steps: readonly string[] = (flow?.upgrade ?? step === "complete") ? UPGRADE_STEPS : REGISTER_STEPS;
  const here = pathname.endsWith("/company") ? "Your company" : STAGE_LABEL[flow?.stage ?? (step === "payment_review" ? "done" : "choose")];
  const stepIdx = steps.indexOf(here);

  // Block body on purpose: an effect must return nothing or a cleanup function. A concise
  // `() => window.scrollTo(0, 0)` returns scrollTo's result, and browser extensions that
  // patch scrollTo make that a non-function -> "destroy is not a function" on navigation.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className={bar ? "za zau zau-onb zau-onb--bar" : "za zau zau-onb"} data-clarity-mask="true">
      <AnnouncementBar />
      {bar ? (
        <header className="zau-onb__top">
          <PlanTopBar bar={bar} />
        </header>
      ) : (
        <header className="zau-onb__top">
          <div className="zau-onb__bar">
            <Brand to={inApp ? "/app" : "/"} ariaLabel={inApp ? "Zinwe, back to your dashboard" : "Zinwe home"} height={26} className="zau-brand zau-brand--sm" />
            <ol className="zau-stepper" aria-label="Your progress">
              {steps.map((label, i) => {
                const done = i < stepIdx;
                const cur = i === stepIdx;
                return (
                  <li key={label} className={done ? "done" : cur ? "cur" : undefined} aria-current={cur ? "step" : undefined}>
                    <span className="zau-stepper__dot" aria-hidden="true">
                      {done ? "✓" : i + 1}
                    </span>
                    {label}
                    {done ? <span className="z-sr"> (done)</span> : null}
                  </li>
                );
              })}
            </ol>
            {inApp ? (
              <Link className="zau-onb__skip" to="/app">
                {step === "complete" ? "Back to dashboard" : "Skip to dashboard"}
              </Link>
            ) : (
              <div className="zau-onb__who">
                {user ? (
                  <span className="zau-onb__acct" title={user.email}>
                    <span className="zau-onb__avatar" aria-hidden="true">
                      {(user.full_name || user.email).trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="zau-onb__email">{user.email}</span>
                  </span>
                ) : null}
                <button
                  type="button"
                  className="zau-btn sm"
                  disabled={leaving}
                  onClick={() => {
                    setLeaving(true);
                    void signOut();
                  }}
                >
                  {leaving ? "Logging out…" : "Log out"}
                </button>
              </div>
            )}
          </div>
        </header>
      )}

      <main className="zau-onb__main" id="onb-main">
        <Suspense
          fallback={
            <div className="zau-boot" role="status" aria-live="polite">
              <span className="zau-spin" aria-hidden="true" />
              Loading…
            </div>
          }
        >
          <PlanFlowContext.Provider value={setFlow}>
            <Outlet />
          </PlanFlowContext.Provider>
        </Suspense>
      </main>
    </div>
  );
}
