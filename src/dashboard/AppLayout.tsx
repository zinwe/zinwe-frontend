import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/authContext";
import { paymentInCheck, rejectedPayment } from "../auth/steps";
import { getAnnouncementFeed, listMembers, type Announcement, type Subscription } from "../lib/api";
import { formatDate, formatMoney } from "../lib/format";
import { FeedbackForm } from "./components/FeedbackForm";
import { IssueForm } from "./components/IssueForm";
import { FeedbackPrompt, MomentPopup } from "./components/Moments";
import { Modal } from "./components/Modal";
import { NotificationBar } from "./components/NotificationBar";
import { NotifyPrompt } from "./components/NotifyPrompt";
import { SupportWidget } from "./components/SupportWidget";
import { ChatBubble } from "./components/ChatBubble";
import { ChatLauncher } from "./components/ChatLauncher";
import { ChatBubbleContext, type ChatBubbleRequest } from "./features/chatBubble";
import { Tour } from "./components/Tour";
import { UpdatedTermsDialog } from "./components/UpdatedTermsDialog";
import { CHAT_POLL_MS, CHAT_READ_EVENT } from "./features/chatEvents";
import { useEntitlements } from "./features/entitlements";
import { useEventCounts } from "./features/useEventCounts";
import type { Decision } from "./features/requests";
import { DASHBOARD_TOUR, syncTourFlag, tourDone, type TourStep } from "./features/tour";
import { higherPlans, isUpgradeDone, UpgradeContext } from "./features/upgrade";
import { useResource } from "./useResource";
import { usePlans } from "../portal/usePlans";
import { useOwnerNotifications } from "./features/useOwnerNotifications";
import { needsOwner } from "./tasks/model";
import { useTasks } from "./tasks/useTasks";
import { useBellFeed } from "./shell/bellFeed";
import { DashNav } from "./shell/DashNav";
import { PhoneShell } from "./shell/PhoneShell";
import { activeFor, ShellContext, type ShellState } from "./shell/shellContext";
import { Busy } from "./ui/States";
import { ZIcon } from "./ui/ZIcon";
import "../styles/dashboard.css";
import "../styles/portal.css";
import "../styles/dash13.css";

/** Geist Mono is only used inside the dashboard: load it with the dashboard chunk (index.html is shared). */
function useDashFonts(): void {
  useEffect(() => {
    const id = "zd-geist-mono";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600&display=swap";
    document.head.appendChild(link);
  }, []);
}

function initials(name: string, email: string): string {
  const source = name.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (name.trim() ? (parts[1]?.[0] ?? "") : "")).toUpperCase() || "?";
}

const DAY_MS = 86_400_000;
/** No "upgrade" nudge this many days after signing up or paying, unless every PC slot is taken (J5-06, J3-13). */
const QUIET_DAYS = 7;

function withinDays(iso: string | null | undefined, days: number, now: number): boolean {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(at) && now - at < days * DAY_MS;
}

/** The PC-limit upgrade bar (backend id "upgrade-limit:…"): a real trigger, unlike "what the next plan adds". */
function isLimitBar(item: Announcement): boolean {
  return item.kind === "upgrade" && item.id.startsWith("upgrade-limit");
}

/**
 * The bars to show. Nothing sells an upgrade while one is being checked (J3-01). In the first week and
 * right after a payment only the PC-limit bar may show. On Team the page has its own PC-limit notice,
 * so the bar isn't shown twice (J3-19, J5-20).
 */
function visibleAnnouncements(
  items: Announcement[],
  { upgradeInCheck, quiet, onTeamPage }: { upgradeInCheck: boolean; quiet: boolean; onTeamPage: boolean },
): Announcement[] {
  return items.filter((item) => {
    if (item.kind !== "upgrade") return true;
    if (upgradeInCheck) return false;
    if (isLimitBar(item)) return !onTeamPage;
    return !quiet;
  });
}

const PLAN_ACTIVE_KEY = "zinwe.planActive.seen";

/** What the one-time "your plan is active" banner is for (changes with each new plan or payment), or null. */
function planActiveId(subscription: Subscription | null | undefined, now: number): string | null {
  if (!subscription || subscription.status !== "active") return null;
  const payment = subscription.latest_payment;
  if (payment?.status === "verified" && withinDays(payment.reviewed_at, QUIET_DAYS, now)) return `pay:${payment.id}`;
  if (!payment && !subscription.plan.requires_payment && withinDays(subscription.starts_at ?? subscription.created_at, QUIET_DAYS, now)) {
    return `plan:${subscription.id}:${subscription.plan.code}`;
  }
  return null;
}

function readSeen(): string | null {
  try {
    return localStorage.getItem(PLAN_ACTIVE_KEY);
  } catch {
    return null;
  }
}

function writeSeen(id: string): void {
  try {
    localStorage.setItem(PLAN_ACTIVE_KEY, id);
  } catch {
    /* storage blocked: it shows again next visit, harmless */
  }
}

/** The tour's last step: "Add your first person" for a new owner, a plain "Done" once the team exists. */
function tourSteps(hasTeam: boolean): readonly TourStep[] {
  if (!hasTeam) return DASHBOARD_TOUR;
  return DASHBOARD_TOUR.map((step) =>
    step.cta
      ? {
          ...step,
          title: "Your team",
          body: "Each person has their own ID to connect their PC. Their card shows the PC, consent and a week of use.",
          cta: undefined,
        }
      : step,
  );
}

/**
 * Owner dashboard shell (v1.3, boards DashNav + DashTopBar + DashFloat): the 248 px menu on desktop; under
 * 760 px a top bar, a bottom tab bar and More / Create sheets. Pages render into <Outlet /> and start with
 * <PageHead> (header row + bell).
 */
export default function AppLayout(): ReactElement {
  useDashFonts();
  const { account, signOut, refresh } = useAuth();
  const user = account?.user ?? null;
  const companyName = account?.company?.name || user?.email || " ";
  const step = account?.onboarding.step;
  const inReview = step === "payment_review";
  // In the dashboard before paying (2026-10-16): a plan waiting for payment, or no plan chosen yet.
  const awaitingPayment = step === "payment";
  const noPlanYet = step === "plan";
  // Owners who haven't accepted the current Terms (signed up earlier, or the Terms changed) are asked once.
  const terms = user?.terms;
  const needsTerms = terms?.needs_acceptance === true;
  const location = useLocation();
  const { pathname, hash } = location;
  const active = activeFor(pathname);
  const onChatPage = pathname.startsWith("/app/chat");
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  // Which tab of the feedback dialog is open, or null when it is closed.
  const [feedbackOpen, setFeedbackOpen] = useState<null | "feedback" | "issue">(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  // F-11: at most one pop-up a day (the server picks it); closed here for this visit once shown.
  const [popup, setPopup] = useState<Announcement | null>(null);
  const [popupDone, setPopupDone] = useState(false);
  const [promptDone, setPromptDone] = useState(false);
  // Refresh: remounting the page reloads everything it shows.
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // The tour plays once per account, on Overview only (J2-06, J5-25); Help → "Take the tour" replays it anywhere.
  const [tourClosed, setTourClosed] = useState(false);
  const [tourReplay, setTourReplay] = useState(false);
  const touring = tourReplay || (!tourClosed && user !== null && pathname === "/app" && !tourDone(user));
  // The floating chat bubble (one at a time); pages open it with useChatBubble().
  const [bubble, setBubble] = useState<ChatBubbleRequest | null>(null);
  const bubbleApi = useMemo(() => ({ open: (request: ChatBubbleRequest) => setBubble(request) }), []);
  // Opening the Chat page closes the floating bubble (the page shows the same conversation).
  const [wasOnChatPage, setWasOnChatPage] = useState(onChatPage);
  if (onChatPage !== wasOnChatPage) {
    setWasOnChatPage(onChatPage);
    if (onChatPage) setBubble(null);
  }
  const onLogout = () => {
    setLeaving(true);
    void signOut();
  };

  // Notification bar is non-critical: fetch once, ignore failures (keep the dashboard usable).
  useEffect(() => {
    const controller = new AbortController();
    getAnnouncementFeed(controller.signal)
      .then((feed) => {
        setAnnouncements(feed.announcements);
        setPopup(feed.popups[0] ?? null);
      })
      .catch(() => {
        /* offline or endpoint unavailable — show no bar */
      });
    return () => controller.abort();
  }, []);

  const entitlements = useEntitlements();
  const plans = usePlans();
  const subscription = account?.subscription ?? null;
  const currentPlan = subscription?.plan ?? null;
  // An upgrade (or renewal) payment being checked: nothing offers the upgrade again until it's confirmed (J3-01).
  const inCheck = paymentInCheck(subscription);
  const rejected = rejectedPayment(subscription);
  const canUpgrade = inCheck ? false : plans.data ? higherPlans(plans.data, currentPlan?.code, subscription ?? {}).length > 0 : true;
  const [now] = useState(() => Date.now());
  const lastPaidAt = subscription?.latest_payment?.status === "verified" ? subscription.latest_payment.reviewed_at : null;
  const quiet = withinDays(user?.date_joined, QUIET_DAYS, now) || withinDays(lastPaidAt, QUIET_DAYS, now);
  const bars = visibleAnnouncements(announcements, {
    upgradeInCheck: inCheck !== null,
    quiet,
    onTeamPage: pathname.startsWith("/app/team"),
  });

  // Once, after a plan goes active: "Startups is active until 17 Nov" (J3-13, J5-06).
  const activeId = planActiveId(subscription, now);
  const [planActiveShown, setPlanActiveShown] = useState<string | null>(null);
  const [planActiveClosed, setPlanActiveClosed] = useState(false);
  if (activeId && planActiveShown === null && !planActiveClosed && readSeen() !== activeId) setPlanActiveShown(activeId);
  useEffect(() => {
    if (planActiveShown) writeSeen(planActiveShown);
  }, [planActiveShown]);
  const showPlanActive = planActiveShown !== null && !planActiveClosed && subscription?.status === "active";
  const upgrade = useMemo(() => ({ open: () => navigate("/onboarding/plan"), canUpgrade }), [canUpgrade, navigate]);

  // FR-15: browser notifications for replies, alerts and requests (once switched on: the banner, or Settings → Notifications).
  useOwnerNotifications(true);

  // The team, with unread replies, for the Chat badge (non-critical: failures just hide it) and the Chat page's tiles:
  // one list, so the two can't disagree. Quicker on the Chat page. The person the owner is reading counts as read.
  const loadMembers = useCallback((signal: AbortSignal) => listMembers(signal), []);
  const members = useResource(loadMembers, { pollMs: onChatPage ? CHAT_POLL_MS : 60_000 });
  const [openChat, setOpenChat] = useState<number | null>(null);
  const team = useMemo(() => (openChat === null ? members.data : members.data?.map((m) => (m.id === openChat ? { ...m, unread: 0 } : m))), [members.data, openChat]);
  const unread = (team ?? []).reduce((sum, m) => sum + (m.is_active ? (m.unread ?? 0) : 0), 0);
  const hasTeam = (team ?? []).some((m) => m.is_active);
  // Alerts badge: open "Needs attention" alerts, counted on the server.
  const counts = useEventCounts();
  const alertsBadge = counts.data?.critical_unhandled ?? 0;
  // Tasks badge (FR-20): open tasks waiting on you (they asked for help, or finished and wait for your OK).
  const tasks = useTasks({ enabled: entitlements.has("team_chat"), pollMs: 60_000 });
  const tasksWaiting = (tasks.data ?? []).filter(needsOwner).length;
  // F-02: requests decided on this visit, wherever (Overview, Today's activity): every list hides them at once.
  const [decided, setDecided] = useState<Readonly<Record<number, Decision>>>({});
  const markDecided = useCallback((id: number, decision: Decision | null) => {
    setDecided((d) => {
      if (decision === null) {
        if (!(id in d)) return d;
        const next = { ...d };
        delete next[id];
        return next;
      }
      return d[id] === decision ? d : { ...d, [id]: decision };
    });
  }, []);
  // The bell: real items only (alerts that need you, unread chats, requests, tasks, news), see shell/bellFeed.ts.
  const bell = useBellFeed({
    userId: user?.id,
    members: team,
    announcements,
    chat: entitlements.has("team_chat"),
    work: entitlements.has("work_time"),
    decided,
  });
  const reloadBell = bell.reload;

  // Back from the upgrade flow: confirm the payment was sent, once.
  const upgradedTo = isUpgradeDone(location.state) ? location.state.upgradedTo : null;
  const closeUpgraded = () => navigate(pathname, { replace: true, state: null });

  const reloadMembers = members.reload;
  const reloadCounts = counts.reload;
  const reloadTasks = tasks.reload;
  const refreshTimer = useRef<number | undefined>(undefined);
  const refreshAll = useCallback(() => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    reloadMembers();
    reloadCounts();
    reloadTasks();
    reloadBell();
    void refresh();
    window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => setRefreshing(false), 500);
  }, [refresh, reloadMembers, reloadCounts, reloadTasks, reloadBell]);
  useEffect(() => () => window.clearTimeout(refreshTimer.current), []);

  // A chat thread just read a member's reply: refresh the Chat badge now, not on the next poll.
  useEffect(() => {
    window.addEventListener(CHAT_READ_EVENT, reloadMembers);
    return () => window.removeEventListener(CHAT_READ_EVENT, reloadMembers);
  }, [reloadMembers]);

  // Help → "Take the tour" asks for a replay with this event.
  useEffect(() => {
    const start = () => setTourReplay(true);
    window.addEventListener("zinwe:tour", start);
    return () => window.removeEventListener("zinwe:tour", start);
  }, []);

  // Seen on this browser before the account kept the flag: tell the account once.
  const tourSynced = useRef(false);
  useEffect(() => {
    if (tourSynced.current || !user) return;
    tourSynced.current = true;
    syncTourFlag(user);
  }, [user]);
  const closeTour = (goTo?: string) => {
    setTourClosed(true);
    setTourReplay(false);
    if (goTo) navigate(goTo);
  };

  // New page starts at the top; a hash naming an element (e.g. /app/rules#usb) jumps to that section.
  // Board deep links (#m=…, #tab=…, #new=1, #task=…) are read by the pages themselves.
  useEffect(() => {
    const raw = hash ? decodeURIComponent(hash.slice(1)) : "";
    const target = raw && !raw.includes("=") ? document.getElementById(raw) : null;
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [pathname, hash]);

  const shell: ShellState = useMemo(
    () => ({
      alerts: alertsBadge,
      unread,
      tasksWaiting,
      members: team,
      membersError: members.error,
      reloadMembers,
      setOpenChat,
      bell,
      decided,
      markDecided,
      openFeedback: (tab = "feedback") => setFeedbackOpen(tab),
      inShell: true,
      refreshAll,
      refreshing,
    }),
    [alertsBadge, unread, tasksWaiting, team, members.error, reloadMembers, bell, decided, markDecided, refreshAll, refreshing],
  );

  const displayName = user ? user.full_name || user.email : "Your account";
  // Nothing pops up over another dialog: the tour, the Terms, the feedback dialog or "Payment sent".
  const otherDialog = touring || needsTerms || feedbackOpen !== null || upgradedTo !== null || leaving;
  const showPopup = popup !== null && !popupDone && !otherDialog;
  const showPrompt = user?.feedback_prompt_due === true && !promptDone && feedbackOpen === null && !touring;

  return (
    // data-clarity-mask: private screens are masked if Microsoft Clarity ever records here (lib/clarity.ts).
    <ShellContext.Provider value={shell}>
      <div className="zd" data-clarity-mask="true">
        <a className="zd-skip" href="#dash-main">
          Skip to content
        </a>
        <PhoneShell
          active={active}
          alerts={alertsBadge}
          unread={unread}
          tasksWaiting={tasksWaiting}
          name={displayName}
          company={companyName}
          onLogout={onLogout}
        />
        <div className="zn-navcol">
          <DashNav
            active={active}
            alerts={alertsBadge}
            unread={unread}
            tasksWaiting={tasksWaiting}
            name={displayName}
            email={user?.email ?? ""}
            company={companyName}
            initials={user ? initials(user.full_name, user.email) : ""}
            isLocked={(m) => !entitlements.has(m)}
            onLogout={onLogout}
            leaving={leaving}
            canUpgrade={upgrade.canUpgrade}
            onUpgrade={upgrade.open}
            onFeedback={() => setFeedbackOpen("feedback")}
          />
        </div>

        <main className="zn-main" id="dash-main" tabIndex={-1}>
          <NotifyPrompt chat={entitlements.has("team_chat")} />
          <NotificationBar items={bars} />
          {showPrompt ? <FeedbackPrompt page={pathname} onDone={() => setPromptDone(true)} /> : null}
          {showPlanActive && subscription ? (
            <div className="zn-banner ok" role="status">
              <ZIcon name="check" />
              <span>
                <b>
                  {subscription.plan.requires_payment && subscription.ends_at
                    ? `${subscription.plan.name} is active until ${formatDate(subscription.ends_at)}.`
                    : `Your ${subscription.plan.name} plan is active.`}
                </b>{" "}
                <span className="zn-banner__more">
                  {subscription.plan.requires_payment
                    ? "Thank you for your payment."
                    : hasTeam
                      ? "Thank you for choosing Zinwe."
                      : "Add your first person to get protected."}
                </span>
              </span>
              <button type="button" className="z-x" aria-label="Dismiss" onClick={() => setPlanActiveClosed(true)}>
                <ZIcon name="close" size={16} />
              </button>
            </div>
          ) : null}
          {rejected && pathname !== "/app/settings/billing" ? (
            <div className="zn-banner warn" role="alert">
              <ZIcon name="alerts" />
              <span>
                <b>
                  We couldn't confirm your {formatMoney(rejected.amount_inr, rejected.currency)} payment
                  {rejected.rejection_reason ? `: ${rejected.rejection_reason.replace(/\.$/, "")}.` : "."}
                </b>{" "}
                <span className="zn-banner__more">
                  {subscription?.status === "active"
                    ? `Your ${subscription.plan.name} plan keeps working meanwhile.`
                    : "You're on the Free features until it's confirmed."}
                </span>
              </span>
              <Link className="z-btn sm pri" to="/app/settings/billing">
                Send it again
              </Link>
            </div>
          ) : null}
          {inCheck && pathname !== "/app/settings/billing" ? (
            <div className="zn-banner info" role="status">
              <ZIcon name="clock" />
              <span>
                <b>
                  {inCheck.kind === "upgrade"
                    ? `Your upgrade to ${inCheck.planName} is being checked.`
                    : `Your ${inCheck.planName} renewal payment is being checked.`}
                </b>{" "}
                <span className="zn-banner__more">
                  {inCheck.kind === "upgrade"
                    ? "Your current plan keeps working. We'll email you when it switches."
                    : "We'll email you when it's confirmed."}
                </span>
              </span>
              <Link to="/app/settings/billing" style={{ fontWeight: 600 }}>
                Details
              </Link>
            </div>
          ) : null}
          {awaitingPayment && !rejected ? (
            <div className="zn-banner warn" role="status">
              <ZIcon name="payment" />
              <span>
                <b>Your {account?.subscription?.plan.name ?? "new"} plan is waiting for payment.</b>{" "}
                <span className="zn-banner__more">You're on the Free features until it's paid.</span>
              </span>
              <Link className="z-btn sm pri" to="/onboarding/subscribe">
                Pay now
              </Link>
            </div>
          ) : null}
          {noPlanYet ? (
            <div className="zn-banner info" role="status">
              <ZIcon name="protection" />
              <span>
                <b>You're on the Free features.</b> <span className="zn-banner__more">Choose a plan to switch on full protection.</span>
              </span>
              <Link className="z-btn sm pri" to="/onboarding/plan">
                Choose a plan
              </Link>
            </div>
          ) : null}
          {inReview ? (
            <div className="zn-banner info" role="status">
              <ZIcon name="clock" />
              <span>
                <b>Your payment is being checked.</b>{" "}
                <span className="zn-banner__more">You can set things up meanwhile. We'll email you when your plan is active.</span>
              </span>
              {pathname !== "/app/settings/billing" ? (
                <Link to="/app/settings/billing" style={{ fontWeight: 600 }}>
                  Details
                </Link>
              ) : null}
            </div>
          ) : null}
          <Suspense fallback={<Busy label="Loading…" />}>
            <UpgradeContext.Provider value={upgrade}>
              <ChatBubbleContext.Provider value={bubbleApi}>
                <Outlet key={refreshKey} />
              </ChatBubbleContext.Provider>
            </UpgradeContext.Provider>
          </Suspense>
        </main>

        <Modal
          open={feedbackOpen !== null}
          onClose={() => setFeedbackOpen(null)}
          title="Help us improve Zinwe"
          sub={
            feedbackOpen === "issue"
              ? "Tell us what broke. A screenshot helps us fix it faster."
              : "Takes 20 seconds. The Zinwe team reads every response."
          }
        >
          <div className="zi-tabs" role="tablist" aria-label="Feedback or issue">
            {(["feedback", "issue"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={feedbackOpen === t}
                className={`zi-tab${feedbackOpen === t ? " on" : ""}`}
                onClick={() => setFeedbackOpen(t)}
              >
                {t === "feedback" ? "Share feedback" : "Report an issue"}
              </button>
            ))}
          </div>
          {feedbackOpen === "issue" ? (
            <IssueForm page={`modal:${pathname}`.slice(0, 120)} onDone={() => setFeedbackOpen(null)} />
          ) : (
            <FeedbackForm page={`modal:${pathname}`.slice(0, 120)} onDone={() => setFeedbackOpen(null)} />
          )}
          {/* Everything this owner has sent before. */}
          <p className="dash-note acct__history">
            {feedbackOpen === "issue" ? (
              <Link className="dash-link" to="/app/help#tab=issue" onClick={() => setFeedbackOpen(null)}>
                Your reports and their status →
              </Link>
            ) : (
              <Link className="dash-link" to="/app/feedback" onClick={() => setFeedbackOpen(null)}>
                Your past feedback →
              </Link>
            )}
          </p>
        </Modal>

        {/* DashFloat: Chat launcher (desktop; on a phone Chat is a tab) + Support. Not on the Chat page. */}
        {entitlements.has("team_chat") && !onChatPage ? (
          <ChatLauncher
            members={members.data}
            onPick={(m) =>
              setBubble({
                person: { id: m.id, name: m.name, email: m.email, hostname: m.device?.hostname },
                onSent: () => members.reload(),
              })
            }
          />
        ) : null}
        <SupportWidget key={user?.id} userId={user?.id} />
        {bubble && !onChatPage ? (
          <ChatBubble
            key={`${bubble.person.id}-${bubble.event?.id ?? "chat"}-${bubble.tag ?? ""}`}
            request={bubble}
            onClose={() => setBubble(null)}
          />
        ) : null}
        {touring && !needsTerms ? <Tour steps={tourSteps(hasTeam)} onClose={closeTour} /> : null}
        {needsTerms && !leaving ? (
          <UpdatedTermsDialog firstTime={!terms?.version} onAccepted={() => refresh()} onSignOut={onLogout} />
        ) : null}

        {showPopup && popup ? <MomentPopup key={popup.id} item={popup} onClosed={() => setPopupDone(true)} /> : null}

        <Modal
          open={upgradedTo !== null}
          onClose={closeUpgraded}
          size="sm"
          title="Payment sent — thank you!"
          sub={`Your upgrade to ${upgradedTo ?? "your new plan"} is on its way.`}
        >
          <p className="dash-modal__text">
            We're matching your payment with our bank statement. As soon as it's confirmed, your plan switches to{" "}
            <b>{upgradedTo}</b> and we'll email you. Your current plan keeps working until then.
          </p>
          <div className="dash-confirm__actions">
            <button type="button" className="z-btn sm pri" onClick={closeUpgraded}>
              Back to dashboard
            </button>
            <Link className="z-btn sm" to="/app/settings/billing" onClick={closeUpgraded}>
              See billing
            </Link>
          </div>
        </Modal>
      </div>
    </ShellContext.Provider>
  );
}
