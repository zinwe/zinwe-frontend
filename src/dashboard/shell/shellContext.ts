import { createContext, useContext } from "react";
import type { ChatGroup, Member } from "../../lib/api";
import type { Decision } from "../features/requests";
import { EMPTY_BELL, type BellState } from "./bellFeed";

/** What the shell (DashNav, bell, phone bars) knows and pages may read: counts, members, notes, a few actions. */
export interface ShellState {
  /** Open "Needs you" alerts (server: critical_unhandled). */
  alerts: number;
  /** Unread member messages (sum of members[].unread). */
  unread: number;
  /** Tasks waiting for your OK or help (sample until FR-20). */
  tasksWaiting: number;
  /** The one team list the shell keeps: the Chat tab count and the Chat page's tiles both read it. */
  members: Member[] | undefined;
  /** Why the last load of `members` failed; cleared by the next success. */
  membersError: unknown;
  reloadMembers: () => void;
  /** The Chat page says whose conversation is on screen: that person shows no unread count (they're being read). */
  setOpenChat: (memberId: number | null) => void;
  /** v1.4: the team chat groups (with the owner's unread counts); undefined while loading or without Chat. */
  groups: ChatGroup[] | undefined;
  reloadGroups: () => void;
  /** The Chat page says which group is on screen: it shows no unread count. */
  setOpenGroup: (groupId: number | null) => void;
  /** v1.4: chats with something unread (people and groups, plus chats marked as unread): the Chat badge. */
  unreadChats: number;
  /** The bell: real items that need the owner + news, with read state on this browser (shell/bellFeed.ts). */
  bell: BellState;
  /**
   * F-02: break / early End day requests decided on this visit (work-log id → decision), wherever it was made. Overview,
   * Today's activity and the bell hide these at once, before the server or the next poll catches up.
   */
  decided: Readonly<Record<number, Decision>>;
  /** Record a decision (null = undone). */
  markDecided: (id: number, decision: Decision | null) => void;
  /** Opens the feedback dialog on its "Share feedback" tab, or on "Report an issue". */
  openFeedback: (tab?: "feedback" | "issue") => void;
  /** True inside the dashboard shell; false for pages that borrow dashboard parts (onboarding, plans). */
  inShell?: boolean;
  /** Reload everything on the page (remounts the outlet). */
  refreshAll: () => void;
  refreshing: boolean;
}

const noop = () => {};

export const ShellContext = createContext<ShellState>({
  alerts: 0,
  unread: 0,
  tasksWaiting: 0,
  members: undefined,
  membersError: undefined,
  reloadMembers: noop,
  setOpenChat: noop,
  groups: undefined,
  reloadGroups: noop,
  setOpenGroup: noop,
  unreadChats: 0,
  bell: EMPTY_BELL,
  decided: {},
  markDecided: noop,
  openFeedback: noop,
  inShell: false,
  refreshAll: noop,
  refreshing: false,
});

export function useShell(): ShellState {
  return useContext(ShellContext);
}

/** Which menu row a dashboard path belongs to (DashNav `active`). */
export type NavKey =
  | "overview"
  | "alerts"
  | "team"
  | "activity"
  | "websites"
  | "data"
  | "apps"
  | "chat"
  | "tasks"
  | "reports"
  | "rules"
  | "settings"
  | "help";

export function activeFor(pathname: string): NavKey {
  const p = pathname.replace(/\/+$/, "");
  const starts = (x: string) => p === x || p.startsWith(`${x}/`);
  if (p === "/app" || p === "") return "overview";
  if (starts("/app/alerts")) return "alerts";
  if (starts("/app/activity")) return "activity";
  if (starts("/app/team")) return "team";
  if (starts("/app/internet")) return "websites";
  if (starts("/app/data")) return "data";
  if (starts("/app/remote")) return "apps";
  if (starts("/app/chat")) return "chat";
  if (starts("/app/tasks")) return "tasks";
  if (starts("/app/reports")) return "reports";
  if (starts("/app/rules") || starts("/app/setup")) return "rules";
  if (starts("/app/settings") || starts("/app/invoice")) return "settings";
  return "help";
}

export const NAV_TITLE: Record<NavKey, string> = {
  overview: "Overview",
  alerts: "Alerts",
  team: "Team",
  activity: "Today's activity",
  websites: "Internet usage",
  data: "Data safety",
  apps: "Apps & remote",
  chat: "Chat",
  tasks: "Tasks",
  reports: "Reports",
  rules: "Rules",
  settings: "Settings",
  help: "Help & support",
};
