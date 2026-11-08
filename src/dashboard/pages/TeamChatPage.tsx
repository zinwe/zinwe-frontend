import { Component, createRef, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/authContext";
import { useIsPhone } from "../../hooks/useIsPhone";
import { usePageMeta } from "../../hooks/usePageMeta";
import { errorMessage, getMemberThread, type ChatGroup, type ChatMessage, type ChatReport, type Message } from "../../lib/api";
import { ChatComposer } from "../chat/ChatComposer";
import { ChatSettingsDialog } from "../chat/ChatSettingsDialog";
import { ChatThread } from "../chat/ChatThread";
import { ConvTasks } from "../chat/ConvTasks";
import { GroupAvatar, ReportsAvatar } from "../chat/GroupAvatar";
import { DeleteGroupDialog } from "../chat/DeleteGroupDialog";
import { GroupDialog } from "../chat/GroupDialog";
import { firstOf, nameList } from "../chat/groupModel";
import { groupsAvailable, loadReports, readAllGroups, readGroup, removeGroupMessage } from "../chat/groupsSource";
import { GroupThread } from "../chat/GroupThread";
import { taskFromMessage } from "../chat/makeTask";
import { clearMarked, forgetChat, MAX_PINS, setMarked, toggleMute, togglePin, useChatPrefs, usePrefsError, type ChatPrefs } from "../chat/prefs";
import { ReportsPane } from "../chat/ReportsPane";
import { TaskThread } from "../chat/TaskThread";
import { approvalLine, askedLine } from "../chat/system";
import { isOpenTeamTask, tasksOfGroup, tasksOfPerson } from "../chat/teamTasks";
import type { ReplyTarget } from "../chat/reply";
import { PlanLock } from "../components/PlanLock";
import { Toast } from "../components/Toast";
import { CHAT_POLL_MS } from "../features/chatEvents";
import { useEntitlements } from "../features/entitlements";
import { roleColour } from "../roleColour";
import { PageHead } from "../shell/PageHead";
import { useShell } from "../shell/shellContext";
import { Avatar } from "../tasks/Avatar";
import { dueLabel, findPerson, isOpenTask, peopleOf, sepLabel, type TaskPerson } from "../tasks/model";
import { isoDay, type TaskView } from "../tasks/types";
import { TaskForm, type TaskFormValues } from "../tasks/TaskForm";
import { todoView, useMemberTodos } from "../tasks/useMemberTodos";
import { taskActions, useTasks } from "../tasks/useTasks";
import { QuickAdd, TaskCard, TaskPanel, useTeamTasks, type OpenOpts, type PanelCard, type PanelTab, type TaskPrefill } from "../tasks2";
import { EmptyBlock, ErrorBlock, SkRows } from "../ui/States";
import { clockTime } from "../ui/time";
import { useResource } from "../useResource";
import "../../styles/dash13/tasks.css";
import "../../styles/dash13/chat.css";

// The tasks2 cards, panel and quick add use tasks2.css (.tv-*). A glob so this page builds before the tasks2 module
// (web-tasks) is merged in, and loads the stylesheet once it is.
import.meta.glob("../tasks2/tasks2.css", { eager: true });

/** How long a tile keeps the "just arrived" class (the highlight's length in chat.css). */
const FRESH_MS = 1400;

const LEDE = "Message your team in their Zinwe window, or send a task they can tick off.";

type ChatPerson = TaskPerson & { memberId: number };
type Filter = "all" | "unread" | "groups";

/**
 * One row of the conversation list (v1.4: people and groups in one list). `key` = "p<memberId>" / "g<groupId>"
 * (the prefs keys); `at` = latest activity; `text` = the line it shows and how ("sys" grey, "none" faint).
 */
type Conv =
  | { kind: "person"; key: string; person: ChatPerson; name: string; at: Date | null; text: string; tone?: "sys" | "none"; unread: number; mentioned: false }
  | { kind: "group"; key: string; group: ChatGroup; name: string; at: Date | null; text: string; tone?: "sys" | "none"; unread: number; mentioned: boolean };

const DOT: Record<TaskPerson["presenceKind"], string> = { working: "#17663F", break: "#A84505", online: "#404040", offline: "#8A8A8A", waiting: "#8A8A8A" };

/** A person's tile: the newest message, or a newer task (unread messages always win the line). */
function personConv(person: ChatPerson, tasks: readonly TaskView[]): Conv {
  const base = { kind: "person" as const, key: `p${person.memberId}`, person, name: person.name, unread: person.member?.unread ?? 0, mentioned: false as const };
  const last = person.member?.last_message;
  const unread = base.unread;
  const lastAt = last ? new Date(last.at) : null;
  const task = tasks.filter((t) => t.memberId === person.memberId).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (task && !unread && (!lastAt || task.createdAt > lastAt.getTime())) return { ...base, at: new Date(task.createdAt), text: `Task: ${task.title}` };
  if (last) {
    // An approval is an event: "✓ Lunch break 2:13 PM approved", in grey.
    const approved = last.sender === "owner" ? approvalLine(last.text) : null;
    if (approved) return { ...base, at: lastAt, text: `✓ ${approved}`, tone: "sys" };
    const asked = last.sender === "owner" ? askedLine(last.text) : null;
    if (asked) return { ...base, at: lastAt, text: asked, tone: "sys" };
    return { ...base, at: lastAt, text: `${last.sender === "owner" ? "You: " : ""}${last.text}` };
  }
  // No line from an older backend, which still counts replies.
  if (unread) return { ...base, at: null, text: `${unread} new ${unread === 1 ? "reply" : "replies"}` };
  // Presence is the dot on the avatar; the line invites a first message.
  return { ...base, at: null, text: last === null ? `Say hi to ${person.first}` : person.presence, tone: last === null ? "none" : undefined };
}

/** A group's tile: "Karan: text", "You: Task: …", a system line in grey, or "Say hi to Design". */
function groupConv(group: ChatGroup, people: readonly ChatPerson[], ownerFirst: string): Conv {
  const base = { kind: "group" as const, key: `g${group.id}`, group, name: group.name, unread: group.unread, mentioned: !!group.mentioned };
  const last = group.last_message;
  const at = group.last_message_at ? new Date(group.last_message_at) : last?.at ? new Date(last.at) : null;
  if (!last) return { ...base, at, text: `Say hi to ${group.name}`, tone: "none" };
  if (last.system) return { ...base, at, text: last.text, tone: "sys" };
  const body = last.task_id != null && !/^task:/i.test(last.text) ? `Task: ${last.text}` : last.text;
  // The server names the writer by first name (the owner's too); the sample says "owner".
  const mine = !last.by || last.by.kind === "owner" || (last.by.member_id == null && last.by.name === ownerFirst);
  const who = mine ? "You" : (people.find((p) => p.memberId === last.by?.member_id)?.first ?? firstOf(last.by?.name ?? ""));
  // The server's line may already read "Karan: …".
  return { ...base, at, text: body.startsWith(`${who}: `) ? body : `${who}: ${body}` };
}

/** Pinned first (in pin order), then unread, then latest activity; never-used chats by name at the end. */
function sortConvs(convs: Conv[], prefs: ChatPrefs): Conv[] {
  const pinAt = (c: Conv) => {
    const i = prefs.pins.indexOf(c.key);
    return i < 0 ? 99 : i;
  };
  const un = (c: Conv) => (c.unread > 0 || prefs.marked.includes(c.key) ? 1 : 0);
  return [...convs].sort(
    (a, b) => pinAt(a) - pinAt(b) || un(b) - un(a) || (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/**
 * The conversation list. A new message moves a tile to the top, and React re-inserts the other tiles to do it, which
 * also drops the browser's scroll anchoring: scrolled down, the rows you're looking at would slide by one. So the
 * row at the top of the view is measured before the update and put back after it. At the very top nothing is held:
 * the new tile just shows. (A class because only getSnapshotBeforeUpdate sees the DOM before the change.)
 */
class TileList extends Component<{ order: string; children: ReactNode }> {
  private box = createRef<HTMLElement>();

  getSnapshotBeforeUpdate(prev: { order: string }): { scroller: Element; row: Element; y: number } | null {
    const list = this.box.current;
    if (!list || prev.order === this.props.order) return null;
    // Phone: the page scrolls, not the list.
    const scroller = list.scrollTop > 0 ? list : window.scrollY > 0 ? document.scrollingElement : null;
    const viewTop = scroller === list ? list.getBoundingClientRect().top : 0;
    const row = scroller && [...list.children].find((tile) => tile.getBoundingClientRect().bottom > viewTop);
    return scroller && row ? { scroller, row, y: row.getBoundingClientRect().top } : null;
  }

  componentDidUpdate(_prev: unknown, _state: unknown, held: { scroller: Element; row: Element; y: number } | null): void {
    if (held) held.scroller.scrollTop += held.row.getBoundingClientRect().top - held.y;
  }

  render(): ReactNode {
    return (
      <aside ref={this.box} className="cv-list" aria-label="Conversations">
        {this.props.children}
      </aside>
    );
  }
}

function tileWhen(at: Date | null): string {
  if (!at) return "";
  if (Date.now() - at.getTime() < 60_000) return "Just now";
  const day = sepLabel(isoDay(at));
  return day === "Today" ? clockTime(at) : day;
}

function Dots({ vertical = true, size = 18 }: { vertical?: boolean; size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {vertical ? (
        <>
          <circle cx="12" cy="5" r="1.9" />
          <circle cx="12" cy="12" r="1.9" />
          <circle cx="12" cy="19" r="1.9" />
        </>
      ) : (
        <>
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </>
      )}
    </svg>
  );
}

const PIN_ICON = "M14.5 2.8 21.2 9.5l-1.4 1.4-1.1-.4-3.4 3.4.2 3.8-1.4 1.4-3.6-3.6-4.8 4.8M8.4 11.2l4.4 4.4";
const MUTE_ICON = "M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6";
const MORE_ITEMS = {
  group: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M22 11h-6",
  read: "M20 6 9 17l-5-5",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z",
};

/**
 * /app/chat, /app/chat/:member, /app/chat/g-<id> (a group) and /app/chat/reports (board DashChat / DashPhoneChat).
 * Plan: team_chat (chat and tasks); without it a lock card shows instead. The page fits the window: the thread
 * scrolls inside, the composer always shows (chat.css). Nothing opens by itself: fetching a thread marks it read,
 * so messages stay unread on their tiles until you open a conversation.
 *
 * v1.4: one list of people and groups (search, ⋮ with New group · Mark all as read · Chat settings, chips
 * All · Unread · Groups, up to 3 pins, hover ⋯ / right-click: Edit group, Pin, Mark as read/unread, Mute), the
 * owner's Reports tile at the bottom, "+ New group" in the page header (desktop). A group opens its thread
 * (chat/GroupThread), its composer (@ to tag), its Tasks tab, and Edit group from its ⋮. Task cards come from
 * tasks2 (TaskCard with the thread footer; a card opens TaskPanel on its Chat tab). + Task and "/task" open
 * QuickAdd above the composer for that person or group (a bottom sheet on a phone).
 *
 * Phone: the list runs full width under "Chat" with a grey search + ⋮ (New group · Mark all as read) and
 * All · Unread · Groups · Role ▾. An open chat hides the bottom tabs; its header is the name, a line, the
 * Chat · Tasks pill and ⋮. #task=<id> opens that task's panel on Chat; #todo=<id> opens their to-do's thread.
 */
export default function TeamChatPage(): ReactElement {
  usePageMeta({ title: "Chat — Zinwe", description: "Message your team and read their replies." });
  const { has } = useEntitlements();
  if (!has("team_chat")) {
    return (
      <div className="zp-chat">
        <PageHead title="Chat" lede={LEDE} />
        <PlanLock module="team_chat">Send a note straight to an employee's PC, get their reply here, and copy it to their email when it matters.</PlanLock>
      </div>
    );
  }
  return <ChatPageContent />;
}

function ChatPageContent(): ReactElement {
  const { members, membersError, reloadMembers, setOpenChat, groups, reloadGroups, setOpenGroup } = useShell();
  const { account } = useAuth();
  const ownerFirst = firstOf(account?.user.full_name ?? "") || "you";
  const tasks = useTasks();
  const todos = useMemberTodos();
  const team = useTeamTasks();
  const params = useParams<{ member?: string }>();
  const [search] = useSearchParams();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const phone = useIsPhone();
  const prefs = useChatPrefs();

  const everyone = useMemo(() => peopleOf(members).filter((p): p is ChatPerson => p.memberId !== null), [members]);
  const allTasks = useMemo(() => tasks.data ?? [], [tasks.data]);
  // v1.4.1: groups deleted on this visit (here, or found gone) leave the list at once, before the next poll.
  const [gone, setGone] = useState<ReadonlySet<number>>(() => new Set());
  const groupList = useMemo(() => (groups ?? []).filter((g) => !gone.has(g.id)), [groups, gone]);
  const convs = useMemo(
    () => sortConvs([...everyone.map((p) => personConv(p, allTasks)), ...groupList.map((g) => groupConv(g, everyone, ownerFirst))], prefs),
    [everyone, allTasks, groupList, prefs, ownerFirst],
  );
  const hashParams = useMemo(() => new URLSearchParams(hash.slice(1)), [hash]);
  const wanted = params.member ?? hashParams.get("m") ?? search.get("member");
  const groupParam = search.get("group");
  const groupMatch = /^g-(\d+)$/.exec(wanted ?? "") ?? (!params.member && groupParam && /^\d+$/.test(groupParam) ? ["", groupParam] : null);
  const selectedGroup = groupMatch ? (groupList.find((g) => g.id === Number(groupMatch[1])) ?? null) : null;
  const isReports = wanted === "reports" && !everyone.some((p) => p.key === "reports");
  const selected = groupMatch || isReports ? null : (findPerson(wanted, everyone) as ChatPerson | null);
  const openKey = selected ? `p${selected.memberId}` : selectedGroup ? `g${selectedGroup.id}` : isReports ? "reports" : null;
  const screen = openKey ? "m-thread" : "m-list";

  const [tab, setTab] = useState<"chat" | "tasks">("chat");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  // Phone: a role filter too (people only).
  const [role, setRole] = useState("");
  const [roleOpen, setRoleOpen] = useState(false);
  // Open menus: "more" (⋮ by the search), "hd" (the conversation's ⋮), or a tile's key (its ⋯ / right-click).
  const [menu, setMenu] = useState<string | null>(null);
  const [threadKey, setThreadKey] = useState(0);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [reply, setReply] = useState<ReplyTarget | null>(null);
  const [edit, setEdit] = useState<{ id: number; text: string } | null>(null);
  const [openCards, setOpenCards] = useState<ReadonlySet<number>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);
  const [form, setForm] = useState<{ who: string; editing: TaskView | null; title?: string } | null>(null);
  // v1.3.5 (F-17): their own to-do whose thread is open beside the chat (id negated). #todo=<id>.
  const [threadOf, setThreadOf] = useState<number | null>(null);
  // v1.4: QuickAdd above the composer, the task panel, the group dialog, chat settings, a toast.
  const [quick, setQuick] = useState(false);
  const [quickText, setQuickText] = useState("");
  const [panel, setPanel] = useState<{ taskId: number | null; tab: PanelTab; card?: PanelCard | null; create?: TaskPrefill | null } | null>(null);
  const [dialog, setDialog] = useState<{ kind: "new" } | { kind: "edit"; group: ChatGroup } | { kind: "delete"; group: ChatGroup } | { kind: "settings" } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // A pin / mute / mark the server refused ("You can pin up to 3 chats."): the list is already back as it was.
  usePrefsError(setToast);
  // Send → the thread goes to the bottom (pin) and shows your line at once (outbox) until the next fetch has it.
  const [pin, setPin] = useState(0);
  const [outbox, setOutbox] = useState<Message[]>([]);
  const [groupOutbox, setGroupOutbox] = useState<ChatMessage[]>([]);
  const flashTimer = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      window.clearTimeout(flashTimer.current);
    },
    [],
  );

  // Esc closes an open menu.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menu]);

  // Reports (owner): what members reported. Loaded with the page and kept fresh like the list.
  const loadReportList = useCallback((signal: AbortSignal) => loadReports(signal), []);
  const reports = useResource(loadReportList, { pollMs: 60_000 });
  // The first groups list decides where chat comes from (server or sample): ask for reports again then.
  const groupsN = groups?.length ?? -1;
  const reloadReports = reports.reload;
  useEffect(() => {
    if (groupsN >= 0) reloadReports();
  }, [groupsN, reloadReports]);
  const [reportEdits, setReportEdits] = useState<Record<number, ChatReport>>({});
  const reportList = (reports.data ?? []).map((r) => reportEdits[r.id] ?? r);
  const reportsOpen = reportList.filter((r) => !r.handled_at).length;
  const showReportsTile = groupsAvailable() || reportList.length > 0;

  // A deep link that isn't the route (#m=<first>, ?member=<id>): settle on /app/chat/<first>.
  useEffect(() => {
    if (params.member || !selected) return;
    const fromHash = hashParams.get("m");
    const fromQuery = search.get("member");
    if (!fromHash && !fromQuery) return;
    const rest = new URLSearchParams(hashParams);
    rest.delete("m");
    const h = rest.toString();
    navigate(`/app/chat/${selected.key}${h ? `#${h}` : ""}`, { replace: true });
  }, [params.member, selected, hashParams, search, navigate]);

  // v1.4.1: the open group dropped out of a fresh list (deleted elsewhere): back to the chat list.
  const [shownGroup, setShownGroup] = useState<{ id: number; name: string } | null>(null);
  if (selectedGroup && (shownGroup?.id !== selectedGroup.id || shownGroup.name !== selectedGroup.name)) setShownGroup({ id: selectedGroup.id, name: selectedGroup.name });
  const openGroupId = groupMatch ? Number(groupMatch[1]) : null;
  const [leftGroup, setLeftGroup] = useState(0);
  if (shownGroup && openGroupId === shownGroup.id && groups !== undefined && !groups.some((g) => g.id === shownGroup.id)) {
    setShownGroup(null);
    setLeftGroup(shownGroup.id);
    setToast(`${shownGroup.name} was deleted.`);
  }
  useEffect(() => {
    if (!leftGroup) return;
    forgetChat(`g${leftGroup}`);
    navigate("/app/chat", { replace: true });
  }, [leftGroup, navigate]);

  // tasks2's "Open chat" for a group task (?group=<id>): settle on /app/chat/g-<id>.
  useEffect(() => {
    if (params.member || !groupParam || !/^\d+$/.test(groupParam)) return;
    navigate(`/app/chat/g-${groupParam}${hash}`, { replace: true });
  }, [params.member, groupParam, hash, navigate]);

  // The list's old #view=tasks (the team's tasks, from before Tasks had its own tab) opens the Tasks page.
  const toTasksPage = !wanted && hashParams.get("view") === "tasks";
  useEffect(() => {
    if (toTasksPage) navigate("/app/tasks", { replace: true });
  }, [toTasksPage, navigate]);
  // #tab=tasks shows their tasks; #new=1 opens a quick task for them; #task=<id> its panel on Chat; #todo=<id> the
  // to-do's thread. Keyed by person too: on a fresh load the team arrives after the first render.
  const linkKey = `${hash}|${openKey ?? "-"}`;
  const [handledHash, setHandledHash] = useState<string | null>(null);
  if ((selected || selectedGroup) && handledHash !== linkKey) {
    setHandledHash(linkKey);
    if (hashParams.get("tab") === "tasks") setTab("tasks");
    if (hashParams.get("new") === "1") {
      if (phone) setPanel({ taskId: null, tab: "overview", create: selectedGroup ? { groupId: selectedGroup.id, memberIds: [...selectedGroup.member_ids] } : { memberIds: selected ? [selected.memberId] : [] } });
      else setQuick(true);
    }
    const taskId = Number.parseInt(hashParams.get("task") ?? "", 10);
    const todoId = Number.parseInt(hashParams.get("todo") ?? "", 10);
    if (taskId > 0) setPanel({ taskId, tab: "chat" });
    else if (todoId > 0 && selected) setThreadOf(-todoId);
  }

  // Keep the open conversation fresh while the tab is visible.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") setThreadKey((k) => k + 1);
    }, CHAT_POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  // Arriving: the shell's lists may be up to a minute old.
  useEffect(() => {
    reloadMembers();
    reloadGroups();
  }, [reloadMembers, reloadGroups]);

  // The conversation on screen is being read, so the shell shows no count for it.
  const readingId = selected && tab === "chat" ? selected.memberId : null;
  useEffect(() => {
    setOpenChat(readingId);
    return () => setOpenChat(null);
  }, [readingId, setOpenChat]);
  const readingGroup = selectedGroup && tab === "chat" ? selectedGroup.id : null;
  useEffect(() => {
    setOpenGroup(readingGroup);
    return () => setOpenGroup(null);
  }, [readingGroup, setOpenGroup]);
  // Opening a chat clears its "Mark as unread".
  useEffect(() => {
    if (openKey && openKey !== "reports") setMarked(openKey, false);
  }, [openKey]);

  // A new message while the page is open: its tile moves up by itself (sortConvs) and gets a short highlight.
  const unreadSig = convs.map((c) => `${c.key}:${c.unread}`).join(" ");
  const [lastSig, setLastSig] = useState(unreadSig);
  if (unreadSig !== lastSig) {
    setLastSig(unreadSig);
    const before = new Map(lastSig.split(" ").map((x) => x.split(":") as [string, string]));
    const rose = convs.filter((c) => before.has(c.key) && c.unread > Number(before.get(c.key) ?? 0)).map((c) => c.key);
    if (rose.length) setFresh(new Set(rose));
  }
  useEffect(() => {
    if (!fresh.size) return;
    const id = window.setTimeout(() => setFresh(new Set()), FRESH_MS);
    return () => window.clearTimeout(id);
  }, [fresh]);

  // A new conversation: start in Chat with no reply or edit, and (a person) their newest task card open.
  const [shownFor, setShownFor] = useState<string | null>(null);
  if ((tasks.data || selectedGroup || isReports) && shownFor !== openKey) {
    setShownFor(openKey);
    setReply(null);
    setEdit(null);
    setMenu(null);
    setOutbox([]);
    setGroupOutbox([]);
    setQuick(hashParams.get("new") === "1" && !phone);
    setQuickText("");
    if (!hashParams.get("todo")) setThreadOf(null);
    if (!hashParams.get("tab")) setTab("chat");
    const mine = selected ? allTasks.filter((t) => t.memberId === selected.memberId && isOpenTask(t)).sort((a, b) => b.createdAt - a.createdAt) : [];
    setOpenCards(new Set(mine.length ? [mine[0].id] : []));
  }

  const tasksOf = (p: ChatPerson) => allTasks.filter((t) => t.memberId === p.memberId);
  const openOf = (p: ChatPerson) => (team.tasks ? tasksOfPerson(team, p.memberId).filter(isOpenTeamTask).length : tasksOf(p).filter(isOpenTask).length);

  const say = (text: string) => setToast(text);
  const flashItem = (key: string) => {
    setFlash(key);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => document.getElementById(`msg-${key}`)?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" }), 60);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1800);
  };
  const routeOf = (c: Conv) => (c.kind === "person" ? `/app/chat/${c.person.key}` : `/app/chat/g-${c.group.id}`);
  const go = (c: Conv) => {
    setMenu(null);
    navigate(routeOf(c));
    setTab("chat");
    // Phone: the thread opens full screen with the newest lines and the composer in view.
    if (window.matchMedia?.("(max-width: 760px)").matches) window.setTimeout(() => document.getElementById("msg")?.scrollIntoView({ block: "end" }), 80);
  };
  const goReports = () => {
    setMenu(null);
    navigate("/app/chat/reports");
  };
  const messagePerson = (memberId: number) => {
    const p = everyone.find((x) => x.memberId === memberId);
    if (p) navigate(`/app/chat/${p.key}`);
  };
  const startReply = (target: ReplyTarget) => {
    setTab("chat");
    setEdit(null);
    setReply(target);
    window.setTimeout(() => document.getElementById("msg")?.focus(), 40);
  };
  // A card in a thread opens its panel on Chat (board DashChat); its button may ask for another tab or an inline card.
  const openTask = (taskId: number, opts?: OpenOpts, tab: PanelTab = "chat") => setPanel({ taskId, tab: opts?.tab ?? tab, card: opts?.card ?? null });
  const cardOf = (taskId: number): ReactNode | null => {
    const t = team.byId(taskId);
    return t ? <TaskCard task={t} team={team} thread onOpen={(id, opts) => openTask(id, opts)} say={say} /> : null;
  };

  // ---- List actions ----
  const pinConv = (c: Conv) => {
    setMenu(null);
    if (!togglePin(c.key)) say(`You can pin up to ${MAX_PINS} chats.`);
  };
  const markRead = async (c: Conv) => {
    setMarked(c.key, false);
    try {
      if (c.kind === "group") {
        await readGroup(c.group.id);
        reloadGroups();
      } else if (c.unread) {
        // Fetching their thread marks their replies read.
        await getMemberThread(c.person.memberId);
        reloadMembers();
      }
    } catch (e) {
      say(errorMessage(e));
    }
  };
  const markAllRead = async () => {
    setMenu(null);
    clearMarked();
    try {
      const groupIds = convs.filter((c) => c.kind === "group" && c.unread > 0).map((c) => (c.kind === "group" ? c.group.id : 0));
      await Promise.all([
        ...(groupIds.length ? [readAllGroups(groupIds)] : []),
        ...convs.filter((c) => c.kind === "person" && c.unread > 0).map((c) => (c.kind === "person" ? getMemberThread(c.person.memberId) : null)),
      ]);
      say("All chats marked as read.");
    } catch (e) {
      say(errorMessage(e));
    }
    reloadGroups();
    reloadMembers();
  };
  // ---- v1.4.1: a group that is gone (deleted here or elsewhere) ----
  const dropGroup = (g: ChatGroup, text: string) => {
    setDialog(null);
    setGone((s) => new Set(s).add(g.id));
    forgetChat(`g${g.id}`);
    if (openKey === `g${g.id}`) navigate("/app/chat", { replace: true });
    say(text);
    reloadGroups();
    team.reload();
  };
  // "Make a task" from a line: the task form, filled in from it (on Send its card shows in this chat).
  const makeTaskFrom = (text: string, memberId: number | null) => {
    const { title, details } = taskFromMessage(text);
    setMenu(null);
    if (selectedGroup) {
      // A member's line: for them, the card posted here. Your own line: for the group.
      const create =
        memberId != null
          ? { title, details, memberIds: [memberId], postIn: selectedGroup.id }
          : { title, details, groupId: selectedGroup.id, memberIds: [...selectedGroup.member_ids] };
      setPanel({ taskId: null, tab: "overview", create });
    } else if (selected) {
      setPanel({ taskId: null, tab: "overview", create: { title, details, memberIds: [selected.memberId] } });
    }
  };

  const convMenu = (c: Conv, where: "row" | "hd"): Array<{ label: string; go: () => void; sub?: string; danger?: boolean }> => {
    const items: Array<{ label: string; go: () => void; sub?: string; danger?: boolean }> = [];
    const unread = c.unread > 0 || prefs.marked.includes(c.key);
    if (c.kind === "group" && where === "hd" && phone) items.push({ label: "Group tasks", sub: `${tasksOfGroup(team, c.group).filter(isOpenTeamTask).length} open`, go: () => (setMenu(null), setTab("tasks")) });
    if (c.kind === "person" && where === "hd" && phone) items.push({ label: "Their tasks", sub: `${openOf(c.person)} open`, go: () => (setMenu(null), setTab("tasks")) });
    if (c.kind === "group" && groupsAvailable()) items.push({ label: "Edit group", go: () => (setMenu(null), setDialog({ kind: "edit", group: c.group })) });
    items.push({ label: prefs.pins.includes(c.key) ? "Unpin chat" : "Pin chat", go: () => pinConv(c) });
    items.push({
      label: unread ? "Mark as read" : "Mark as unread",
      go: () => {
        setMenu(null);
        if (unread) void markRead(c);
        else {
          setMarked(c.key, true);
          // Marking the open chat unread closes it, so the mark stays.
          if (openKey === c.key) navigate("/app/chat");
        }
      },
    });
    items.push({ label: prefs.muted.includes(c.key) ? "Unmute" : "Mute", go: () => (setMenu(null), toggleMute(c.key)) });
    if (c.kind === "person" && where === "hd" && phone) items.push({ label: "Open on Team", go: () => (setMenu(null), navigate(`/app/team#m=${c.person.key}`)) });
    if (where === "hd" && !phone) items.push({ label: "Chat settings", go: () => (setMenu(null), setDialog({ kind: "settings" })) });
    if (c.kind === "group" && where === "hd" && groupsAvailable()) items.push({ label: "Delete group", danger: true, go: () => (setMenu(null), setDialog({ kind: "delete", group: c.group })) });
    return items;
  };
  const moreItems = [
    ...(groupsAvailable() ? [{ label: "New group", icon: MORE_ITEMS.group, go: () => (setMenu(null), setDialog({ kind: "new" })) }] : []),
    { label: "Mark all as read", icon: MORE_ITEMS.read, go: () => void markAllRead() },
    ...(!phone && groupsAvailable() ? [{ label: "Chat settings", icon: MORE_ITEMS.settings, go: () => (setMenu(null), setDialog({ kind: "settings" })) }] : []),
  ];

  const submitTask = async (v: TaskFormValues, editing: TaskView | null) => {
    await taskActions.submit(v, editing);
    setForm(null);
    setThreadKey((k) => k + 1);
    team.reload();
    reloadMembers();
  };
  const startTask = (title?: string) => {
    const fixed = selectedGroup ? { groupId: selectedGroup.id, memberIds: [...selectedGroup.member_ids] } : { memberIds: selected ? [selected.memberId] : [] };
    if (phone) {
      setPanel({ taskId: null, tab: "overview", create: { ...fixed, title: title ?? "" } });
      return;
    }
    setQuickText(title ?? "");
    setQuick(true);
  };
  const afterTaskChange = () => {
    setThreadKey((k) => k + 1);
    setPin((n) => n + 1);
    tasks.reload();
    reloadMembers();
    reloadGroups();
  };
  const afterQuick = () => {
    setQuick(false);
    setReply(null);
    setTab("chat");
    setThreadKey((k) => k + 1);
    setPin((n) => n + 1);
    tasks.reload();
    team.reload();
    reloadMembers();
    reloadGroups();
  };

  if (members === undefined) {
    return (
      <div className="zp-chat m-list">
        <PageHead title="Chat" lede={LEDE} />
        <div className="cv-box">
          {membersError ? (
            <div style={{ flex: 1 }}>
              <ErrorBlock message={errorMessage(membersError)} onRetry={reloadMembers} />
            </div>
          ) : (
            <div className="cv-list" style={{ padding: 0 }}>
              <SkRows label="Loading your team" rows={6} />
            </div>
          )}
        </div>
      </div>
    );
  }
  if (!everyone.length) {
    return (
      <div className="zp-chat m-list">
        <PageHead title="Chat" lede={LEDE} />
        <div className="z-card">
          <EmptyBlock
            icon="chat"
            title="No one to chat with yet"
            action={
              <Link className="z-btn sm pri" to="/app/team#add=1">
                Add a person
              </Link>
            }
          >
            Add your team first. Once Zinwe is on their PC, you can message them here.
          </EmptyBlock>
        </div>
      </div>
    );
  }

  const roles = [...new Set(everyone.map((p) => p.role))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  // Role colours as on People & PCs and Tasks: the stored role among the active members' roles; none stays grey.
  const storedRoles = everyone.map((p) => p.member?.role ?? "");
  const roleDot = (label: string) => roleColour(everyone.find((p) => p.role === label)?.member?.role ?? "", storedRoles);
  const q = query.trim().toLowerCase();
  const unreadOf = (c: Conv) => (c.unread > 0 ? c.unread : prefs.marked.includes(c.key) ? 1 : 0);
  const unreadChats = convs.filter((c) => unreadOf(c) > 0).length;
  const shownConvs = convs.filter((c) => {
    if (filter === "unread" && !unreadOf(c)) return false;
    if (filter === "groups" && c.kind !== "group") return false;
    if (role && (c.kind !== "person" || c.person.role !== role)) return false;
    if (!q) return true;
    const hay =
      c.kind === "person"
        ? `${c.name} ${c.person.role}`
        : `${c.name} ${everyone
            .filter((p) => c.group.member_ids.includes(p.memberId))
            .map((p) => p.name)
            .join(" ")}`;
    return hay.toLowerCase().includes(q);
  });
  const reportsTile = showReportsTile && !q && filter !== "groups" && !role && (filter !== "unread" || reportsOpen > 0);
  const route = selected ? `/app/chat/${selected.key}` : selectedGroup ? `/app/chat/g-${selectedGroup.id}` : "/app/chat";
  // Their own to-dos too (v1.3.5): a thread can be about one, and a line about one names it.
  const selTasks = selected ? tasksOf(selected).sort((a, b) => b.createdAt - a.createdAt) : [];
  const selOpen = selTasks.filter(isOpenTask);
  const selTodos = selected ? (todos.data ?? []).filter((d) => d.member_id === selected.memberId).map(todoView) : [];
  const threadTask = threadOf != null && selected ? (selTodos.find((t) => t.id === threadOf) ?? null) : null;
  const openThread = (t: TaskView) => {
    setTab("chat");
    if (t.own) setThreadOf(t.id);
    else openTask(t.id);
  };
  const closeThread = () => {
    setThreadOf(null);
    if (hashParams.get("todo")) navigate(route, { replace: true });
  };
  const closePanel = () => {
    setPanel(null);
    if (hashParams.get("task")) navigate(route, { replace: true });
  };
  const presenceLine = selected?.member?.device ? `${selected.pc} · ${selected.role} · ${selected.presence}` : `${selected?.role} · Zinwe isn't on their PC yet: chat waits until it is, email arrives now`;
  const openConv = convs.find((c) => c.key === openKey) ?? null;
  const groupPeople = selectedGroup ? everyone.filter((p) => selectedGroup.member_ids.includes(p.memberId)) : [];
  const groupFirsts = groupPeople.map((p) => p.first);
  const groupLine = selectedGroup
    ? `${groupFirsts.length > 3 ? `${groupFirsts.slice(0, 3).join(", ")} and ${groupFirsts.length - 3} more` : groupFirsts.join(", ")} and you · ${groupFirsts.length + 1} people`
    : "";
  const groupLinePhone = selectedGroup ? `${nameList(groupFirsts.slice(0, 3))}${groupFirsts.length > 3 ? ` and ${groupFirsts.length - 3} more` : ""}, you` : "";
  const convTasks = selectedGroup ? tasksOfGroup(team, selectedGroup) : selected ? tasksOfPerson(team, selected.memberId) : [];
  const convOpen = team.tasks ? convTasks.filter(isOpenTeamTask).length : selected ? openOf(selected) : 0;
  const convLabel = selectedGroup ? `the ${selectedGroup.name} group` : (selected?.first ?? "");
  const hdMenu = openConv ? convMenu(openConv, "hd") : [];
  const qaHead = selectedGroup ? `NEW TASK · FOR THE ${selectedGroup.name.toUpperCase()} GROUP · THE CARD IS POSTED HERE` : selected ? `NEW TASK · FOR ${selected.name.toUpperCase()}` : "";

  // ---- The list's head: search, ⋮ (New group · Mark all as read · Chat settings), chips ----
  const moreMenu = (
    <div className="cv-more">
      <button type="button" className="cv-more__btn" aria-label="More chat options" aria-haspopup="menu" aria-expanded={menu === "more"} onClick={() => setMenu(menu === "more" ? null : "more")}>
        <Dots />
      </button>
      {menu === "more" ? (
        <>
          <button type="button" tabIndex={-1} aria-label="Close menu" className="cv-scrim" onClick={() => setMenu(null)} />
          <div className="cv-menu end cv-more__menu" role="menu" aria-label="Chat options">
            {moreItems.map((it) => (
              <button key={it.label} type="button" role="menuitem" onClick={it.go}>
                <span className="cv-more__item">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={it.icon} />
                  </svg>
                  {it.label}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
  const chips = (
    <div className="cv-fchips" role="group" aria-label="Filter chats">
      {(
        [
          ["all", "All"],
          ["unread", "Unread"],
          ["groups", "Groups"],
        ] as const
      ).map(([k, label]) => (
        <button
          key={k}
          type="button"
          className={filter === k && !role ? "on" : ""}
          aria-pressed={filter === k && !role}
          onClick={() => {
            setFilter(k);
            setRole("");
            setRoleOpen(false);
          }}
        >
          {label}
          {k === "unread" && unreadChats > 0 ? <small>{unreadChats}</small> : null}
        </button>
      ))}
      {phone ? (
        <span style={{ position: "relative" }}>
          <button
            type="button"
            className={role ? "on" : ""}
            aria-haspopup="menu"
            aria-expanded={roleOpen}
            onClick={() => (role ? setRole("") : setRoleOpen((o) => !o))}
            aria-label={role ? `Role: ${role}. Clear` : "Filter by role"}
          >
            {role ? <i className="cv-rdot" style={{ background: roleDot(role) }} aria-hidden="true" /> : null}
            {role || "Role"}
            {role ? (
              <span aria-hidden="true">✕</span>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            )}
          </button>
          {roleOpen ? (
            <>
              <button type="button" tabIndex={-1} aria-label="Close" className="cv-scrim" onClick={() => setRoleOpen(false)} />
              <span className="cv-menu end" role="menu" aria-label="Role">
                {roles.map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="menuitemradio"
                    aria-checked={r === role}
                    onClick={() => {
                      setRole(r);
                      setFilter("all");
                      setRoleOpen(false);
                    }}
                  >
                    <span className="cv-rname">
                      <i className="cv-rdot" style={{ background: roleDot(r) }} aria-hidden="true" />
                      {r}
                    </span>
                    <small>{everyone.filter((p) => p.role === r).length}</small>
                  </button>
                ))}
              </span>
            </>
          ) : null}
        </span>
      ) : null}
    </div>
  );
  const findBlock = (
    <div className="cv-find">
      <div className="cv-srow">
        <label className="cv-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4-4" />
          </svg>
          <span className="z-sr">Search your team</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your team" />
        </label>
        {moreMenu}
      </div>
      {chips}
    </div>
  );

  const tile = (c: Conv) => {
    const on = c.key === openKey;
    const unread = unreadOf(c);
    const muted = prefs.muted.includes(c.key);
    const pinned = prefs.pins.includes(c.key);
    const open = c.kind === "person" ? openOf(c.person) : 0;
    const cls = ["conv", on && "on", unread > 0 && "un", fresh.has(c.key) && "new"].filter(Boolean).join(" ");
    const items = convMenu(c, "row");
    const onCtx = (e: MouseEvent) => {
      e.preventDefault();
      setMenu(c.key);
    };
    return (
      <div key={c.key} className="cv-row" onContextMenu={onCtx}>
        <button type="button" className={cls} aria-pressed={on} aria-label={`${c.name}${unread ? `, ${unread} unread` : ""}${pinned ? ", pinned" : ""}`} onClick={() => go(c)}>
          <span className="conv-av">
            {c.kind === "person" ? (
              <>
                <Avatar person={c.person} size={38} />
                <span className="conv-dot" style={{ background: DOT[c.person.presenceKind] }} />
              </>
            ) : (
              <GroupAvatar group={c.group} size={38} />
            )}
          </span>
          <span className="conv-text">
            <span className="conv-line">
              <b className="conv-name">{c.name}</b>
              <span className="conv-when">
                {muted ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-label="Muted" role="img">
                    <path d={MUTE_ICON} />
                  </svg>
                ) : null}
                {pinned ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-label="Pinned" role="img">
                    <path d={PIN_ICON} />
                  </svg>
                ) : null}
                {tileWhen(c.at)}
              </span>
            </span>
            <span className="conv-line">
              <span className={`conv-last${c.tone ? ` ${c.tone}` : ""}`}>{c.text}</span>
              {c.mentioned && unread > 0 ? (
                <span className="conv-at" aria-label="You were mentioned">
                  @
                </span>
              ) : null}
              {unread > 0 ? <span className={`conv-unread${muted ? " muted" : ""}`}>{unread}</span> : null}
            </span>
          </span>
          {open > 0 ? (
            <span className="cv-pill" style={{ background: "#FDEBDC", color: "#8A3A04", fontSize: 11 }}>
              {open === 1 ? "1 task" : `${open} tasks`}
            </span>
          ) : null}
        </button>
        <button type="button" className="cv-row__more" aria-label={`More for ${c.name}`} aria-haspopup="menu" aria-expanded={menu === c.key} onClick={() => setMenu(menu === c.key ? null : c.key)}>
          <Dots vertical={false} size={16} />
        </button>
        {menu === c.key ? (
          <>
            <button type="button" tabIndex={-1} aria-label="Close" className="cv-scrim" onClick={() => setMenu(null)} />
            <div className="cv-row__menu">
              <div className="cv-menu end" role="menu" aria-label={c.name}>
                {items.map((it) => (
                  <button key={it.label} type="button" role="menuitem" className={it.danger ? "danger" : undefined} onClick={it.go}>
                    {it.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>
    );
  };

  const headActions = groupsAvailable() ? (
    <button type="button" className="z-btn sm pri zn-desk-only cv-newg" onClick={() => setDialog({ kind: "new" })}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
      New group
    </button>
  ) : undefined;

  const hasConv = !!(selected || selectedGroup || isReports);
  const hdMenuEl =
    openConv && hdMenu.length ? (
      <span style={{ position: "relative" }}>
        <button type="button" className="cv-dots" aria-label={`More for ${openConv.name}`} title="More" aria-haspopup="menu" aria-expanded={menu === "hd"} onClick={() => setMenu(menu === "hd" ? null : "hd")}>
          <Dots size={phone ? 20 : 16} />
        </button>
        {menu === "hd" ? (
          <>
            <button type="button" tabIndex={-1} aria-label="Close" className="cv-scrim" onClick={() => setMenu(null)} />
            <span className="cv-menu end" role="menu" aria-label={`More for ${openConv.name}`}>
              {hdMenu.map((it) => (
                <button key={it.label} type="button" role="menuitem" className={it.danger ? "danger" : undefined} onClick={it.go}>
                  {it.label}
                  {it.sub ? <small>{it.sub}</small> : null}
                </button>
              ))}
            </span>
          </>
        ) : null}
      </span>
    ) : null;
  const segs =
    selected || selectedGroup ? (
      <div role="group" aria-label="Show" className="z-segs cv-hsegs" style={{ flexWrap: "nowrap" }}>
        <button type="button" className={tab === "chat" ? "z-seg on" : "z-seg"} aria-pressed={tab === "chat"} onClick={() => setTab("chat")}>
          Chat
        </button>
        <button type="button" className={tab === "tasks" ? "z-seg on" : "z-seg"} aria-pressed={tab === "tasks"} onClick={() => setTab("tasks")}>
          <span className="zk-d-only">Tasks · {convOpen} open</span>
          <span className="zk-m-only" aria-label={`Tasks, ${convOpen} open`}>
            Tasks <em className={convOpen > 0 ? "hot" : ""}>{convOpen}</em>
          </span>
        </button>
      </div>
    ) : null;

  const quickAdd =
    quick && (selected || selectedGroup) ? (
      <div className="cv-chatqa">
        <div className="cv-chatqa__h">
          <span>{qaHead}</span>
          <button type="button" aria-label="Close the new task" onClick={() => setQuick(false)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <QuickAdd
          key={`${openKey ?? ""}|${quickText}`}
          team={team}
          fixed={selectedGroup ? { groupId: selectedGroup.id, memberIds: [...selectedGroup.member_ids] } : { memberIds: selected ? [selected.memberId] : [] }}
          initialText={quickText}
          autoFocus
          onSent={afterQuick}
          onOpenFull={(prefill) => {
            setQuick(false);
            setPanel({ taskId: null, tab: "overview", create: prefill });
          }}
          onCancel={() => setQuick(false)}
          say={say}
        />
      </div>
    ) : null;

  return (
    <div className={`zp-chat ${screen}${threadTask ? " m-tpanel" : ""}`}>
      <div className="cv-top">
        <PageHead title="Chat" lede={LEDE} actions={headActions} />
        {phone ? findBlock : null}
      </div>

      <div className="cv-box">
        <TileList order={shownConvs.map((c) => c.key).join(" ")}>
          {phone ? null : findBlock}
          {shownConvs.length === 0 ? (
            <p className="cv-tempty">
              {q ? `Nobody matches “${query.trim()}”` : filter === "unread" ? "No unread chats" : filter === "groups" ? "No groups yet" : "No one"}
              {role ? ` in ${role}` : ""}.
            </p>
          ) : null}
          {shownConvs.map(tile)}
          {reportsTile ? (
            <div className="cv-row cv-row--rep">
              <button type="button" className={["conv", isReports && "on", reportsOpen > 0 && "un"].filter(Boolean).join(" ")} aria-pressed={isReports} aria-label={`Reports${reportsOpen ? `, ${reportsOpen} new` : ""}`} onClick={goReports}>
                <span className="conv-av">
                  <ReportsAvatar size={38} />
                </span>
                <span className="conv-text">
                  <span className="conv-line">
                    <b className="conv-name">Reports</b>
                    <span className="conv-when">{reportList[0] ? tileWhen(new Date(reportList[0].created_at)) : ""}</span>
                  </span>
                  <span className="conv-line">
                    <span className="conv-last">
                      {reportsOpen
                        ? `${firstOf(reportList.find((r) => !r.handled_at)?.reporter?.name ?? "Someone")} reported a message${reportList.find((r) => !r.handled_at)?.message?.by?.name ? ` from ${firstOf(reportList.find((r) => !r.handled_at)!.message!.by!.name)}` : ""}`
                        : "Nothing new"}
                    </span>
                    {reportsOpen > 0 ? <span className="conv-unread">{reportsOpen}</span> : null}
                  </span>
                </span>
              </button>
            </div>
          ) : null}
        </TileList>

        <section aria-label="Conversation" className="cv-pane">
          {hasConv ? (
            <>
              <div className="cv-head">
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  <Link className="zk-ic zk-m-only cv-back" aria-label="Back to all chats" to="/app/chat">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M15 18 9 12l6-6" />
                    </svg>
                  </Link>
                  <span className="cv-hav">{selected ? <Avatar person={selected} size={40} /> : selectedGroup ? <GroupAvatar group={selectedGroup} size={40} /> : <ReportsAvatar size={40} />}</span>
                  <div className="cv-who" style={{ minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.35 }}>
                    <b style={{ fontSize: 16 }}>{selected ? selected.name : selectedGroup ? selectedGroup.name : "Reports"}</b>
                    <span className="cv-whosub" style={{ fontSize: 12, color: "#6B6B6B" }}>
                      {selected ? (
                        <>
                          <i className="cv-hdot" style={{ background: DOT[selected.presenceKind] }} aria-hidden="true" />
                          {selected.member?.device ? (
                            <>
                              <span className="cv-hpc">
                                <span className="z-mono">{selected.pc}</span> ·{" "}
                              </span>
                              {selected.role} · {selected.presence}
                            </>
                          ) : (
                            <>
                              <span className="zk-d-only">{presenceLine}</span>
                              <span className="zk-m-only">{selected.role} · No PC yet</span>
                            </>
                          )}
                        </>
                      ) : selectedGroup ? (
                        <>
                          <span className="zk-d-only">{groupLine}</span>
                          <span className="zk-m-only">{groupLinePhone}</span>
                        </>
                      ) : (
                        "Messages your team reported to you"
                      )}
                    </span>
                  </div>
                </div>
                <div className="cv-hacts" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  {phone ? segs : hdMenuEl}
                  {phone ? hdMenuEl : segs}
                </div>
              </div>
              {selected && tab === "chat" && selOpen.length ? (
                <button type="button" className="cv-pin zk-m-only" onClick={() => setTab("tasks")}>
                  <i aria-hidden="true" />
                  <span>
                    <b>{selOpen.length === 1 ? "1 open task" : `${selOpen.length} open tasks`}:</b> {selOpen[0].title} · {dueLabel(selOpen[0])}
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
              ) : null}

              {isReports ? (
                <ReportsPane
                  reports={reportList}
                  loading={reports.pending && !reports.data}
                  error={reports.error && !reports.data ? errorMessage(reports.error) : null}
                  onRetry={reports.reload}
                  onChanged={(r) => setReportEdits((m) => ({ ...m, [r.id]: r }))}
                  onMessage={messagePerson}
                  people={everyone}
                />
              ) : tab === "tasks" ? (
                <ConvTasks label={convLabel} team={team} tasks={convTasks} onOpen={(id, opts) => openTask(id, opts, "overview")} say={say} />
              ) : selectedGroup ? (
                <GroupThread
                  key={`g-${selectedGroup.id}`}
                  group={selectedGroup}
                  people={everyone}
                  ownerFirst={ownerFirst}
                  reloadKey={`${threadKey}:${selectedGroup.last_message_at ?? ""}`}
                  pin={pin}
                  outbox={groupOutbox}
                  flash={flash}
                  renderTask={cardOf}
                  onReply={startReply}
                  onEdit={(m) => {
                    setReply(null);
                    setEdit({ id: m.id, text: m.body });
                    window.setTimeout(() => document.getElementById("msg")?.focus(), 40);
                  }}
                  onDelete={async (m) => {
                    try {
                      await removeGroupMessage(selectedGroup.id, m.id);
                      if (edit?.id === m.id) setEdit(null);
                      say("Deleted for everyone.");
                      setThreadKey((k) => k + 1);
                      reloadGroups();
                    } catch (e) {
                      say(errorMessage(e));
                    }
                  }}
                  onJump={flashItem}
                  onMakeTask={(m) => makeTaskFrom(m.body, m.by?.kind === "member" ? m.by.member_id : null)}
                  onGone={() => dropGroup(selectedGroup, `${selectedGroup.name} was deleted.`)}
                  onRead={() => {
                    void readGroup(selectedGroup.id)
                      .then(reloadGroups)
                      .catch(() => {});
                  }}
                />
              ) : selected ? (
                <ChatThread
                  key={`thread-${selected.memberId}`}
                  person={selected}
                  tasks={tasks.data ? [...selTasks, ...selTodos] : []}
                  reloadKey={`${threadKey}:${selected.member?.last_message?.at ?? ""}`}
                  pin={pin}
                  outbox={outbox}
                  openCards={openCards}
                  flash={flash}
                  onToggleCard={(id) =>
                    setOpenCards((s) => {
                      const next = new Set(s);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                  onReply={startReply}
                  onEditTask={(t) => setForm({ who: selected.key, editing: t })}
                  onJump={flashItem}
                  onOpenThread={openThread}
                  renderTask={cardOf}
                  onMakeTask={(m) => makeTaskFrom(m.body || m.title || "", null)}
                />
              ) : null}

              {isReports ? null : (
                <>
                  {quickAdd}
                  {quickAdd ? null : selectedGroup ? (
                    <ChatComposer
                      key={`compose-g-${selectedGroup.id}`}
                      group={{ group: selectedGroup, people: everyone }}
                      edit={edit}
                      onCancelEdit={() => setEdit(null)}
                      reply={reply}
                      onCancelReply={() => setReply(null)}
                      onJumpReply={() => reply && flashItem(reply.key)}
                      onTask={startTask}
                      onGroupSent={(line, edited) => {
                        setReply(null);
                        setEdit(null);
                        if (!edited) setGroupOutbox((o) => [...o, line]);
                        setPin((n) => n + 1);
                        setThreadKey((k) => k + 1);
                        reloadGroups();
                      }}
                    />
                  ) : selected ? (
                    <ChatComposer
                      key={`compose-${selected.memberId}`}
                      person={selected}
                      reply={reply}
                      onCancelReply={() => setReply(null)}
                      onJumpReply={() => reply && flashItem(reply.key)}
                      onTask={startTask}
                      onSent={(_delivery, message) => {
                        setReply(null);
                        if (message) setOutbox((o) => [...o, message]);
                        setPin((n) => n + 1);
                        setThreadKey((k) => k + 1);
                        reloadMembers();
                      }}
                    />
                  ) : null}
                </>
              )}
            </>
          ) : (
            <div className="cv-none">
              <p style={{ margin: 0 }}>
                <b>Pick a conversation</b>
                <br />
                Messages stay unread until you open them.
              </p>
            </div>
          )}
        </section>
        {selected && threadTask ? (
          <TaskThread
            key={`tpanel-${selected.memberId}-${threadTask.id}`}
            person={selected}
            task={threadTask}
            reloadKey={`${threadKey}:${selected.member?.last_message?.at ?? ""}`}
            outbox={outbox}
            onSent={(message) => {
              setOutbox((o) => [...o, message]);
              setPin((n) => n + 1);
              setThreadKey((k) => k + 1);
              reloadMembers();
            }}
            onClose={closeThread}
          />
        ) : null}
      </div>

      {panel ? (
        <TaskPanel
          key={`${panel.taskId ?? "new"}-${panel.tab}-${panel.card ?? ""}`}
          team={team}
          taskId={panel.taskId}
          create={panel.create ?? null}
          tab={panel.tab}
          card={panel.card ?? null}
          onClose={closePanel}
          onOpen={(id) => {
            // A task made from the panel lands in this chat: show its card.
            setPanel((p) => (p ? { ...p, taskId: id, create: null } : p));
            afterTaskChange();
          }}
          say={say}
        />
      ) : null}
      {dialog?.kind === "new" || dialog?.kind === "edit" ? (
        <GroupDialog
          group={dialog.kind === "edit" ? dialog.group : null}
          people={everyone}
          groups={groupList}
          onClose={() => setDialog(null)}
          onDelete={(g) => setDialog({ kind: "delete", group: g })}
          onSaved={(saved, made) => {
            setDialog(null);
            reloadGroups();
            setThreadKey((k) => k + 1);
            if (made) {
              const one = saved.member_ids.length === 1 ? everyone.find((p) => p.memberId === saved.member_ids[0]) : null;
              say(`${saved.name} is ready. It shows in ${one ? `${one.first}’s` : "their"} Zinwe app now.`);
              setFilter("all");
              setQuery("");
              navigate(`/app/chat/g-${saved.id}`);
            } else {
              say(`Saved. Everyone in ${saved.name} sees the change.`);
            }
          }}
        />
      ) : null}
      {dialog?.kind === "delete" ? (
        <DeleteGroupDialog
          group={dialog.group}
          onClose={() => setDialog(null)}
          onDeleted={(g, already) => dropGroup(g, already ? `${g.name} was already deleted.` : `${g.name} deleted.`)}
        />
      ) : null}
      {dialog?.kind === "settings" ? <ChatSettingsDialog onClose={() => setDialog(null)} /> : null}
      {form ? (
        <TaskForm
          people={everyone}
          who={form.who}
          editing={form.editing}
          title={form.title}
          onClose={() => setForm(null)}
          onSubmit={submitTask}
        />
      ) : null}
      <Toast message={toast} onDone={() => setToast(null)} tone="success" />
    </div>
  );
}
