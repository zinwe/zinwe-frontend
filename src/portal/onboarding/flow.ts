import { createContext, useContext, useLayoutEffect } from "react";

/** Where the owner is in choosing and paying: the onboarding header's stepper shows it. */
export interface PlanFlow {
  /** On a plan already (upgrading or renewing): Choose plan, Pay, Done. Otherwise the four registering steps. */
  upgrade: boolean;
  stage: "choose" | "pay" | "done";
  /** The plan page's own top bar on a phone (PlanTopBar), in place of the header; null keeps the header. */
  bar?: PlanBar | null;
}

/** The phone plan screen's top bar: Back, a title with a small line under it, Skip while registering. */
export interface PlanBar {
  title: string;
  sub: string;
  backTo: string;
  backLabel: string;
  /** Skip to the dashboard (registering only). */
  skipTo?: string | null;
}

export const PlanFlowContext = createContext<(flow: PlanFlow | null) => void>(() => undefined);

/**
 * Tells the header's stepper where this page is. A page says so itself because the account's step can't: paying
 * for a first plan moves the step to `complete` while the Done screen is still on show.
 */
export function usePlanFlow(upgrade: boolean, stage: PlanFlow["stage"], bar: PlanBar | null = null): void {
  const setFlow = useContext(PlanFlowContext);
  const { title = "", sub = "", backTo = "", backLabel = "", skipTo = null } = bar ?? {};
  const hasBar = bar !== null;
  useLayoutEffect(() => {
    setFlow({ upgrade, stage, bar: hasBar ? { title, sub, backTo, backLabel, skipTo } : null });
    return () => setFlow(null);
  }, [setFlow, upgrade, stage, hasBar, title, sub, backTo, backLabel, skipTo]);
}
