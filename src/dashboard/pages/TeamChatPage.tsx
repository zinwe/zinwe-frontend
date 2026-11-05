import { Component, createRef, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { usePageMeta } from "../../hooks/usePageMeta";
import { copyText } from "../../lib/clipboard";
import { errorMessage, type Message } from "../../lib/api";
import { ChatComposer } from "../chat/ChatComposer";
import { ChatThread } from "../chat/ChatThread";
import { PersonTasks } from "../chat/PersonTasks";
import { approvalLine, askedLine } from "../chat/system";
import type { ReplyTarget } from "../chat/reply";
import { PlanLock } from "../components/PlanLock";
import { CHAT_POLL_MS } from "../features/chatEvents";
import { useEntitlements } from "../features/entitlements";
import { roleColour } from "../roleColour";
import { PageHead } from "../shell/PageHead";
import { useShell } from "../shell/shellContext";
import { Avatar } from "../tasks/Avatar";
import { dueLabel, findPerson, isOpenTask, peopleOf, sepLabel, type TaskPerson } from "../tasks/model";
import { isoDay, type TaskView } from "../tasks/types";
import { TaskForm, type TaskFormValues } from "../tasks/TaskForm";
import { taskActions, useTasks } from "../tasks/useTasks";
import { EmptyBlock, ErrorBlock, SkRows } from "../ui/States";
import { clockTime } from "../ui/time";
import "../../styles/dash13/tasks.css";
import "../../styles/dash13/chat.css";

/** How long a tile keeps the "just arrived" class (the highlight's length in chat.css). */
const FRESH_MS = 1400;

const LEDE = "Message your team in their Zinwe window, or send a task they can tick off.";

type ChatPerson = TaskPerson & { memberId: number };
/** One row of the conversation list: who, their latest activity, the line it shows and how ("sys" grey, "none" faint). */
type Tile = { person: ChatPerson; at: Date | null; text: string; tone?: "sys" | "none" };

const DOT: Record<TaskPerson["presenceKind"], string> = { working: "#17663F", break: "#A84505", online: "#404040", offline: "#8A8A8A", waiting: "#8A8A8A" };

/** A tile's latest activity and line: the newest message, or a newer task (unread messages always win the line). */
function tileOf(person: ChatPerson, tasks: readonly TaskView[]): Tile {
  const last = person.member?.last_message;
  const unread = person.member?.unread ?? 0;
  const lastAt = last ? new Date(last.at) : null;
  const task = tasks.filter((t) => t.memberId === person.memberId).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (task && !unread && (!lastAt || task.createdAt > lastAt.getTime())) return { person, at: new Date(task.createdAt), text: `Task: ${task.title}` };
  if (last) {
    // An approval is an event: "✓ Lunch break 2:13 PM approved", in grey.
    const approved = last.sender === "owner" ? approvalLine(last.text) : null;
    if (approved) return { person, at: lastAt, text: `✓ ${approved}`, tone: "sys" };
    const asked = last.sender === "owner" ? askedLine(last.text) : null;
    if (asked) return { person, at: lastAt, text: asked, tone: "sys" };
    return { person, at: lastAt, text: `${last.sender === "owner" ? "You: " : ""}${last.text}` };
  }
  // No line from an older backend, which still counts replies.
  if (unread) return { person, at: null, text: `${unread} new ${unread === 1 ? "reply" : "replies"}` };
  // Presence is the dot on the avatar; the line invites a first message.
  return { person, at: null, text: last === null ? `Say hi to ${person.first}` : person.presence, tone: last === null ? "none" : undefined };
}

/** Unread first, then latest activity, as a chat app does; people with no messages yet by name at the end. */
function sortTiles(tiles: Tile[]): Tile[] {
  const un = (t: Tile) => ((t.person.member?.unread ?? 0) > 0 ? 1 : 0);
  return [...tiles].sort(
    (a, b) => un(b) - un(a) || (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0) || a.person.name.localeCompare(b.person.name, undefined, { sensitivity: "base" }),
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

/**
 * /app/chat and /app/chat/:member (board DashChat; #m=<first> and ?member=<id> also pick a person). Plan: team_chat
 * (chat and tasks); without it a lock card shows instead. The page fits the window: the thread scrolls inside, the
 * composer always shows (chat.css). Nothing opens by itself: fetching a thread marks it read, so messages stay unread
 * on their tiles until you open a conversation. The tiles read the shell's team list, the same one as the Chat tab.
 *
 * Phone (v1.3.3, chats only since 6 Nov 2026: Tasks has its own tab, board LabPhoneChatTasks): the list runs full
 * width under "Chat" with search and All · Role ▾ (a dot in each role's colour) stuck under it; an old #view=tasks
 * link goes to the Tasks page. An open chat hides the bottom tabs; its header is the name, a dot with role and
 * presence, the Chat · Tasks pill and ⋮ (Their tasks, Copy link, Open on Team), with open tasks pinned under it.
 * Their Tasks tab (both layouts) is the Tasks page's list for that one person (chat/PersonTasks).
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
  const { members, membersError, reloadMembers, setOpenChat } = useShell();
  const tasks = useTasks();
  const params = useParams<{ member?: string }>();
  const [search] = useSearchParams();
  const { hash } = useLocation();
  const navigate = useNavigate();

  const everyone = useMemo(() => peopleOf(members).filter((p): p is ChatPerson => p.memberId !== null), [members]);
  const allTasks = useMemo(() => tasks.data ?? [], [tasks.data]);
  const tiles = useMemo(() => sortTiles(everyone.map((p) => tileOf(p, allTasks))), [everyone, allTasks]);
  const hashParams = useMemo(() => new URLSearchParams(hash.slice(1)), [hash]);
  const wanted = params.member ?? hashParams.get("m") ?? search.get("member");
  const selected = findPerson(wanted, everyone) as ChatPerson | null;
  const screen = selected ? "m-thread" : "m-list";

  const [tab, setTab] = useState<"chat" | "tasks">("chat");
  // Phone list: search and a role filter.
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [roleOpen, setRoleOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [threadKey, setThreadKey] = useState(0);
  const [fresh, setFresh] = useState<ReadonlySet<number>>(new Set());
  const [reply, setReply] = useState<ReplyTarget | null>(null);
  const [openCards, setOpenCards] = useState<ReadonlySet<number>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState<{ who: string; editing: TaskView | null; title?: string } | null>(null);
  // Send → the thread goes to the bottom (pin) and shows your line at once (outbox) until the next fetch has it.
  const [pin, setPin] = useState(0);
  const [outbox, setOutbox] = useState<Message[]>([]);
  const flashTimer = useRef<number | undefined>(undefined);
  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      window.clearTimeout(flashTimer.current);
      window.clearTimeout(copyTimer.current);
    },
    [],
  );

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

  // #tab=tasks shows their tasks; #new=1 opens Add task for them. The list's old #view=tasks (the team's tasks, from
  // before Tasks had its own tab) opens the Tasks page.
  const toTasksPage = !wanted && hashParams.get("view") === "tasks";
  useEffect(() => {
    if (toTasksPage) navigate("/app/tasks", { replace: true });
  }, [toTasksPage, navigate]);
  const [handledHash, setHandledHash] = useState<string | null>(null);
  if (selected && handledHash !== hash) {
    setHandledHash(hash);
    if (hashParams.get("tab") === "tasks") setTab("tasks");
    if (hashParams.get("new") === "1") setForm({ who: selected.key, editing: null });
  }

  // Keep the open conversation fresh while the tab is visible.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") setThreadKey((k) => k + 1);
    }, CHAT_POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  // Arriving: the shell's list may be up to a minute old.
  useEffect(() => reloadMembers(), [reloadMembers]);

  // The conversation on screen is being read (its thread fetch marks it read), so the shell shows no count for it.
  const readingId = selected && tab === "chat" ? selected.memberId : null;
  useEffect(() => {
    setOpenChat(readingId);
    return () => setOpenChat(null);
  }, [readingId, setOpenChat]);

  // A new message while the page is open: its tile moves up by itself (sortTiles) and gets a short highlight.
  const [lastTeam, setLastTeam] = useState(members);
  if (members !== lastTeam) {
    setLastTeam(members);
    const before = new Map((lastTeam ?? []).map((m) => [m.id, m.unread ?? 0]));
    const rose = lastTeam ? (members ?? []).filter((m) => (m.unread ?? 0) > (before.get(m.id) ?? 0)).map((m) => m.id) : [];
    if (rose.length) setFresh(new Set(rose));
  }
  useEffect(() => {
    if (!fresh.size) return;
    const id = window.setTimeout(() => setFresh(new Set()), FRESH_MS);
    return () => window.clearTimeout(id);
  }, [fresh]);

  // A new person: start in Chat with no reply, and their newest task card open.
  const [shownFor, setShownFor] = useState<number | null>(null);
  const openId = selected?.memberId ?? null;
  if (tasks.data && shownFor !== openId) {
    setShownFor(openId);
    setReply(null);
    setCopied(false);
    setMenuOpen(false);
    setOutbox([]);
    const mine = allTasks.filter((t) => t.memberId === openId && isOpenTask(t)).sort((a, b) => b.createdAt - a.createdAt);
    setOpenCards(new Set(mine.length ? [mine[0].id] : []));
  }

  const tasksOf = (p: ChatPerson) => allTasks.filter((t) => t.memberId === p.memberId);
  const openOf = (p: ChatPerson) => tasksOf(p).filter(isOpenTask).length;

  const flashItem = (key: string) => {
    setFlash(key);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => document.getElementById(`msg-${key}`)?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" }), 60);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1800);
  };
  const go = (p: ChatPerson) => {
    navigate(`/app/chat/${p.key}`);
    setTab("chat");
    // Phone: the thread opens full screen with the newest lines and the composer in view.
    if (window.matchMedia?.("(max-width: 760px)").matches) window.setTimeout(() => document.getElementById("msg")?.scrollIntoView({ block: "end" }), 80);
  };
  const startReply = (target: ReplyTarget) => {
    setTab("chat");
    setReply(target);
    window.setTimeout(() => document.getElementById("msg")?.focus(), 40);
  };

  const submitTask = async (v: TaskFormValues, editing: TaskView | null) => {
    const saved = await taskActions.submit(v, editing);
    setForm(null);
    if (editing) return;
    // The card lands in that person's chat, and the chat switches to them (their route).
    const target = everyone.find((p) => p.key === v.person.key);
    if (target && target.memberId !== selected?.memberId) navigate(`/app/chat/${target.key}`);
    setTab("chat");
    setReply(null);
    setOpenCards((s) => new Set([...s, saved.id]));
    setThreadKey((k) => k + 1);
    setPin((n) => n + 1);
    reloadMembers();
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

  const selTasks = selected ? tasksOf(selected).sort((a, b) => b.createdAt - a.createdAt) : [];
  const selOpen = selTasks.filter(isOpenTask);
  const roles = [...new Set(everyone.map((p) => p.role))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  // Role colours as on People & PCs and Tasks: the stored role (member.role) among the active members' roles; no
  // role ("Team member") stays grey.
  const storedRoles = everyone.map((p) => p.member?.role ?? "");
  const roleDot = (label: string) => roleColour(everyone.find((p) => p.role === label)?.member?.role ?? "", storedRoles);
  const q = query.trim().toLowerCase();
  const shownTiles = tiles.filter(({ person: p }) => (!role || p.role === role) && (!q || `${p.name} ${p.role}`.toLowerCase().includes(q)));
  const copyLink = () => {
    void copyText(`${window.location.origin}/app/chat/${selected?.key ?? ""}`);
    setCopied(true);
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
  };
  const route = selected ? `/app/chat/${selected.key}` : "/app/chat";
  const presenceLine = selected?.member?.device ? `${selected.pc} · ${selected.role} · ${selected.presence}` : `${selected?.role} · Zinwe isn't on their PC yet: chat waits until it is, email arrives now`;

  return (
    <div className={`zp-chat ${screen}`}>
      <div className="cv-top">
        <PageHead title="Chat" lede={LEDE} />
        <div className="cv-find">
          <label className="cv-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-4-4" />
            </svg>
            <span className="z-sr">Search your team</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your team" />
          </label>
          <div className="cv-fchips" role="group" aria-label="Filter chats">
            <button
              type="button"
              className={role ? "" : "on"}
              aria-pressed={!role}
              onClick={() => {
                setRole("");
                setRoleOpen(false);
              }}
            >
              All
            </button>
            <span style={{ position: "relative" }}>
              <button type="button" className={role ? "on" : ""} aria-haspopup="menu" aria-expanded={roleOpen} onClick={() => (role ? setRole("") : setRoleOpen((o) => !o))} aria-label={role ? `Role: ${role}. Clear` : "Filter by role"}>
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
                  <span className="cv-menu" role="menu" aria-label="Role">
                    {roles.map((r) => (
                      <button
                        key={r}
                        type="button"
                        role="menuitemradio"
                        aria-checked={r === role}
                        onClick={() => {
                          setRole(r);
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
          </div>
        </div>
      </div>

      <div className="cv-box">
        <TileList order={tiles.map((x) => x.person.memberId).join(" ")}>
          {shownTiles.length === 0 ? <p className="cv-tempty">{q ? `No one matches “${query.trim()}”` : "No one"}{role ? ` in ${role}` : ""}.</p> : null}
          {shownTiles.map(({ person: p, at, text, tone }) => {
            const on = p.memberId === selected?.memberId;
            const unread = p.member?.unread ?? 0;
            const open = openOf(p);
            const cls = ["conv", on && "on", unread > 0 && "un", fresh.has(p.memberId) && "new"].filter(Boolean).join(" ");
            return (
              <button key={p.memberId} type="button" className={cls} aria-pressed={on} aria-label={`${p.name}${unread ? `, ${unread} unread` : ""}`} onClick={() => go(p)}>
                <span className="conv-av">
                  <Avatar person={p} size={38} />
                  <span className="conv-dot" style={{ background: DOT[p.presenceKind] }} />
                </span>
                <span className="conv-text">
                  <span className="conv-line">
                    <b className="conv-name">{p.name}</b>
                    <span className="conv-when">{tileWhen(at)}</span>
                  </span>
                  <span className="conv-line">
                    <span className={`conv-last${tone ? ` ${tone}` : ""}`}>{text}</span>
                    {unread > 0 ? <span className="conv-unread">{unread}</span> : null}
                  </span>
                </span>
                {open > 0 ? (
                  <span className="cv-pill" style={{ background: "#FDEBDC", color: "#8A3A04", fontSize: 11 }}>
                    {open === 1 ? "1 task" : `${open} tasks`}
                  </span>
                ) : null}
              </button>
            );
          })}
        </TileList>

        <section aria-label="Conversation" className="cv-pane">
          {selected ? (
            <>
              <div className="cv-head">
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  <Link className="zk-ic zk-m-only cv-back" aria-label="Back to all chats" to="/app/chat">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M15 18 9 12l6-6" />
                    </svg>
                  </Link>
                  <span className="cv-hav">
                    <Avatar person={selected} size={40} />
                  </span>
                  <div className="cv-who" style={{ minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.35 }}>
                    <b style={{ fontSize: 16 }}>{selected.name}</b>
                    <span className="cv-whosub" style={{ fontSize: 12, color: "#6B6B6B" }}>
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
                    </span>
                  </div>
                </div>
                <div className="cv-hacts" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  <button type="button" className="z-btn sm zk-d-only" onClick={copyLink}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
                    </svg>
                    <span aria-live="polite">{copied ? "Link copied" : "Copy link to this chat"}</span>
                  </button>
                  <div role="group" aria-label="Show" className="z-segs cv-hsegs" style={{ flexWrap: "nowrap" }}>
                    <button type="button" className={tab === "chat" ? "z-seg on" : "z-seg"} aria-pressed={tab === "chat"} onClick={() => setTab("chat")}>
                      Chat
                    </button>
                    <button type="button" className={tab === "tasks" ? "z-seg on" : "z-seg"} aria-pressed={tab === "tasks"} onClick={() => setTab("tasks")}>
                      <span className="zk-d-only">Tasks · {openOf(selected)} open</span>
                      <span className="zk-m-only" aria-label={`Tasks, ${openOf(selected)} open`}>
                        Tasks <em className={openOf(selected) > 0 ? "hot" : ""}>{openOf(selected)}</em>
                      </span>
                    </button>
                  </div>
                  <span className="zk-m-only" style={{ position: "relative" }}>
                    <button type="button" className="cv-dots" aria-label="More for this chat" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <circle cx="12" cy="5" r="1.9" />
                        <circle cx="12" cy="12" r="1.9" />
                        <circle cx="12" cy="19" r="1.9" />
                      </svg>
                    </button>
                    {menuOpen ? (
                      <>
                        <button type="button" tabIndex={-1} aria-label="Close" className="cv-scrim" onClick={() => setMenuOpen(false)} />
                        <span className="cv-menu end" role="menu" aria-label={`More for ${selected.first}`}>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMenuOpen(false);
                              setTab("tasks");
                            }}
                          >
                            Their tasks <small>{openOf(selected)} open</small>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMenuOpen(false);
                              copyLink();
                            }}
                          >
                            Copy link to this chat
                          </button>
                          <Link role="menuitem" to={`/app/team#m=${selected.key}`} onClick={() => setMenuOpen(false)}>
                            Open on Team
                          </Link>
                        </span>
                      </>
                    ) : null}
                  </span>
                </div>
              </div>
              {copied ? (
                <p className="cv-copied zk-m-only" role="status">
                  Link copied
                </p>
              ) : null}
              {tab === "chat" && selOpen.length ? (
                <button type="button" className="cv-pin zk-m-only" onClick={() => setTab("tasks")}>
                  <i aria-hidden="true" />
                  <span>
                    <b>{selOpen.length === 1 ? "1 open task" : `${selOpen.length} open tasks`}:</b> {selOpen[0].title} · {dueLabel(selOpen[0])}
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
              ) : null}

              {tab === "chat" ? (
                <ChatThread
                  key={`thread-${selected.memberId}`}
                  person={selected}
                  tasks={tasks.data ? selTasks : []}
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
                />
              ) : (
                <PersonTasks
                  key={`tasks-${selected.memberId}`}
                  person={selected}
                  tasks={selTasks}
                  loading={!tasks.data && !tasks.error}
                  error={tasks.data ? null : tasks.error}
                  onRetry={tasks.reload}
                  onEdit={(t) => setForm({ who: selected.key, editing: t })}
                  onOpenChat={() => setTab("chat")}
                />
              )}

              <ChatComposer
                key={`compose-${selected.memberId}`}
                person={selected}
                reply={reply}
                onCancelReply={() => setReply(null)}
                onJumpReply={() => reply && flashItem(reply.key)}
                onTask={(title) => setForm({ who: selected.key, editing: null, title })}
                onSent={(_delivery, message) => {
                  setReply(null);
                  if (message) setOutbox((o) => [...o, message]);
                  setPin((n) => n + 1);
                  setThreadKey((k) => k + 1);
                  reloadMembers();
                }}
              />
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
      </div>

      {form ? (
        <TaskForm
          people={everyone}
          who={form.who}
          editing={form.editing}
          title={form.title}
          onClose={() => {
            setForm(null);
            if (hashParams.get("new")) navigate(route, { replace: true });
          }}
          onSubmit={submitTask}
        />
      ) : null}
    </div>
  );
}

