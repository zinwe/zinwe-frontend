import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  authedRequest,
  getReleaseNotes,
  getWorkLog,
  listEvents,
  type Announcement,
  type DeviceEvent,
  type Member,
  type ReleaseNote,
  type WorkLogEntry,
} from "../../lib/api";
import { viewOf } from "../alerts/alertModel";
import { groupAlerts } from "../features/alertGroups";
import { alertLabel, isConfirmation, isHandled, severityOf } from "../features/events";
import { repeatLabel, type Decision } from "../features/requests";
import { useNow } from "../time";

/**
 * The bell (v1.3.1): REAL items only, gathered on this browser from the APIs the dashboard already has —
 * there is no notification-centre API yet. What it lists is what needs the owner right now, plus news:
 *   alert     "Needs you" alerts nobody has marked as fine (events?kind=alert&handled=false, critical)
 *   chat      people with unread messages (members[].unread)
 *   approval  breaks / early End day waiting for the owner's OK (today's work log, approval=pending)
 *   task      tasks where the person asked for help, can't do it, or finished and waits for the OK
 *             (GET tasks/?status=open, status help|review — FR-20; skipped while that API is missing)
 *   news      announcements (not upgrade nudges) and release notes from the last 60 days
 * Read state is per browser (localStorage). An item's id changes when its content changes (a new message,
 * a new status), so it shows as unread again.
 */

export type BellKind = "alert" | "chat" | "approval" | "task" | "news";

export interface BellItem {
  id: string;
  kind: BellKind;
  title: string;
  body: string;
  /** ISO time it happened (or when this browser first saw it, for items without a time). */
  at: string;
  href: string;
  /** "Opens Alerts", for the line under the item. */
  opens: string;
  read: boolean;
}

export interface BellState {
  /** undefined while the first round loads. */
  items: BellItem[] | undefined;
  unread: number;
  /** Every source failed on the last round. */
  failed: boolean;
  markRead: (ids: readonly string[] | "all") => void;
  reload: () => void;
}

export const EMPTY_BELL: BellState = { items: undefined, unread: 0, failed: false, markRead: () => {}, reload: () => {} };

/** The FR-20 task fields the bell needs (contract in .claude/dev/planning/v1.3.1-fix-roadmap.md). */
interface OpenTask {
  id: number;
  member_id: number | null;
  member_name: string;
  title: string;
  status: string;
  help_note?: string;
  /** v1.4 team tasks. */
  cantdo_note?: string;
  people?: Array<{ name: string; state: string }>;
  status_changed_at?: string | null;
  updated_at?: string;
}

const POLL_MS = 60_000;
const NEWS_DAYS = 60;
const MAX_READ = 400;
const NO_TASKS_KEY = "zinwe.bell.noTasksApi";

function storeKey(userId: number | string): string {
  return `zinwe.bell.${userId}`;
}

interface Stored {
  read: string[];
  /** id → when this browser first saw it (items without a time of their own). */
  seen: Record<string, string>;
}

function load(userId: number | string): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(storeKey(userId)) ?? "null") as Partial<Stored> | null;
    return { read: Array.isArray(raw?.read) ? raw.read : [], seen: raw?.seen && typeof raw.seen === "object" ? raw.seen : {} };
  } catch {
    return { read: [], seen: {} };
  }
}

function save(userId: number | string, value: Stored): void {
  try {
    localStorage.setItem(storeKey(userId), JSON.stringify(value));
  } catch {
    /* storage blocked: read state lasts until reload */
  }
}

function tasksApiMissing(): boolean {
  try {
    return sessionStorage.getItem(NO_TASKS_KEY) === "1";
  } catch {
    return false;
  }
}

function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

function alertItems(events: DeviceEvent[], members: Member[], now: number): Omit<BellItem, "read">[] {
  // Same rows and person-first titles as Alerts → Needs you (repeats folded into one row).
  const open = events.filter((e) => !isConfirmation(e) && !isHandled(e) && severityOf(e) === "critical");
  const byHost = new Map(members.filter((m) => m.device).map((m) => [m.device?.hostname ?? "", m]));
  const byDevice = new Map(open.map((e) => [e.device_id, byHost.get(e.hostname)]));
  const ctx = { now, personFor: (id: number) => byDevice.get(id), devices: undefined, policy: undefined, asks: undefined };
  return groupAlerts(open).map((g) => {
    const v = viewOf(g, ctx);
    const e = g.latest;
    return {
      id: `alert-${e.id}`,
      kind: "alert" as const,
      title: v.title || e.title || alertLabel(e),
      body: `Needs you${g.count > 1 ? ` · ${g.count} times` : ""} · ${v.person ? `${v.person.name}, ${e.hostname}` : e.hostname}`,
      at: e.received_at || e.occurred_at,
      href: `/app/alerts#alert=${e.id}`,
      opens: "Alerts",
    };
  });
}

/** A request row keeps its work-log id, so a decision made elsewhere hides it (F-02). */
type ApprovalItem = Omit<BellItem, "read"> & { logId: number };

function approvalItems(entries: WorkLogEntry[]): ApprovalItem[] {
  return entries
    .filter((w) => w.approval === "pending")
    .map((w) => {
      const who = w.member_name || w.hostname;
      const what = w.state === "ended" ? "end the day early" : "take a break";
      const why = [repeatLabel(w, entries), w.reason, w.note].filter(Boolean).join(" · ");
      return {
        id: `approval-${w.id}`,
        logId: w.id,
        kind: "approval" as const,
        title: `${who} wants to ${what}`,
        body: why ? `${why}. Waiting for your OK.` : "Waiting for your OK.",
        at: w.at,
        href: w.member_id ? `/app/activity?member=${w.member_id}` : "/app/activity",
        opens: "Today's activity",
      };
    });
}

function chatItems(members: Member[]): Untimed[] {
  return members
    .filter((m) => m.is_active && (m.unread ?? 0) > 0)
    .map((m) => ({
      id: `chat-${m.id}-${m.unread}`,
      kind: "chat" as const,
      title: `${m.name} sent ${(m.unread ?? 0) === 1 ? "a message" : `${m.unread} messages`}`,
      body: "Unread in Chat.",
      href: `/app/chat?member=${m.id}`,
      opens: `Chat with ${firstName(m.name) || m.name}`,
    }));
}

function taskItems(tasks: OpenTask[]): Omit<BellItem, "read">[] {
  return tasks
    .filter((t) => t.status === "help" || t.status === "review" || t.status === "cantdo")
    .map((t) => {
      // v1.4 team tasks: the person who asked or can't do it; the first person otherwise.
      const asker = t.people?.find((p) => p.state === t.status);
      const team = (t.people?.length ?? 0) > 1;
      const who = firstName(asker?.name ?? t.member_name) || "Someone";
      const help = t.status === "help";
      const cant = t.status === "cantdo";
      return {
        id: `task-${t.id}-${t.status}-${t.status_changed_at ?? t.updated_at ?? ""}`,
        kind: "task" as const,
        title: help ? `${who} needs help with a task` : cant ? `${who} can’t do a task` : team ? "Everyone finished a task" : `${who} finished a task`,
        body: help
          ? `${t.title}${t.help_note ? `: “${t.help_note}”` : ""}`
          : cant
            ? `${t.title}${t.cantdo_note ? `: “${t.cantdo_note}”` : ""}`
            : `${t.title}. Waiting for your OK.`,
        at: t.status_changed_at || t.updated_at || "",
        href: `/app/tasks?open=${t.id}`,
        opens: "Tasks",
      };
    });
}

type Untimed = Omit<BellItem, "read" | "at"> & { at?: string };

function newsItems(bars: Announcement[], notes: ReleaseNote[], now: number): Untimed[] {
  const out: Untimed[] = [];
  for (const n of notes) {
    if (now - Date.parse(n.published_at) > NEWS_DAYS * 86_400_000) continue;
    out.push({
      id: `note-${n.id}`,
      kind: "news",
      title: `What's new in Zinwe ${n.version}`,
      body: n.title || n.summary,
      at: n.published_at,
      href: "/app/help#tab=whats-new",
      opens: "What's new",
    });
  }
  for (const a of bars) {
    if (a.kind === "upgrade") continue; // sales nudges stay in the offer bar
    const internal = a.cta_href && a.cta_href.startsWith("/") ? a.cta_href : "";
    out.push({
      id: `news-${a.id}`,
      kind: "news",
      title: a.title,
      body: a.body,
      href: internal || "/app",
      opens: internal ? (a.cta_label || "More") : "Overview",
    });
  }
  return out;
}

export interface BellSources {
  userId: number | string | undefined;
  members: Member[] | undefined;
  announcements: Announcement[];
  /** Plan modules: Chat (and Tasks) need team_chat, requests need work_time. */
  chat: boolean;
  work: boolean;
  /** Requests decided on this visit (shell): hidden before the next poll. */
  decided?: Readonly<Record<number, Decision>>;
}

/** The bell's data, polled once a minute while the dashboard is open (one copy for both bells). */
export function useBellFeed({ userId, members, announcements, chat, work, decided }: BellSources): BellState {
  const [alerts, setAlerts] = useState<Omit<BellItem, "read">[] | undefined>(undefined);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [tasks, setTasks] = useState<Omit<BellItem, "read">[]>([]);
  const [notes, setNotes] = useState<ReleaseNote[]>([]);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);
  const [stored, setStored] = useState<Stored>(() => (userId != null ? load(userId) : { read: [], seen: {} }));
  const membersRef = useRef(members);
  const announcementsRef = useRef(announcements);
  useEffect(() => {
    membersRef.current = members;
    announcementsRef.current = announcements;
  }, [members, announcements]);

  // A different account on this browser: its own read state.
  const [forUser, setForUser] = useState(userId);
  if (forUser !== userId) {
    setForUser(userId);
    setStored(userId != null ? load(userId) : { read: [], seen: {} });
  }

  useEffect(() => {
    if (userId == null) return;
    const controller = new AbortController();
    const { signal } = controller;
    const run = async () => {
      const wantTasks = chat && !tasksApiMissing();
      const [ev, log, tk, rn] = await Promise.allSettled([
        listEvents({ kind: "alert", handled: false, limit: 50 }, signal),
        work ? getWorkLog({}, signal) : Promise.resolve(null),
        wantTasks ? authedRequest<OpenTask[]>("/api/devices/tasks/", { query: { status: "open" }, signal }) : Promise.resolve([]),
        getReleaseNotes(signal),
      ]);
      if (signal.aborted) return;
      if (ev.status === "fulfilled") setAlerts(alertItems(ev.value, membersRef.current ?? [], Date.now()));
      else setAlerts((a) => a ?? []);
      if (log.status === "fulfilled") setApprovals(log.value ? approvalItems(log.value.entries ?? []) : []);
      if (tk.status === "fulfilled") setTasks(taskItems(Array.isArray(tk.value) ? tk.value : []));
      else if (tk.reason instanceof ApiError && (tk.reason.status === 404 || tk.reason.status === 403)) {
        // FR-20 not on this server (or not on this plan): stop asking for this tab's session.
        try {
          sessionStorage.setItem(NO_TASKS_KEY, "1");
        } catch {
          /* asks again next round */
        }
        setTasks([]);
      }
      if (rn.status === "fulfilled") setNotes(Array.isArray(rn.value) ? rn.value : []);
      setFailed(ev.status === "rejected" && log.status !== "fulfilled" && rn.status === "rejected");
      // Chat and announcement items have no time of their own: remember when this browser first saw each one,
      // so the list keeps its order across reloads (and forget ids that are gone, so storage stays small).
      if (chat && membersRef.current === undefined) return; // people not loaded yet: stamp next round
      const untimed = [...(chat ? chatItems(membersRef.current ?? []) : []), ...newsItems(announcementsRef.current, [], Date.now())];
      const at = new Date().toISOString();
      setStored((prev) => {
        const live = new Set(untimed.map((i) => i.id));
        const missing = untimed.filter((i) => !prev.seen[i.id]);
        const stale = Object.keys(prev.seen).filter((id) => !live.has(id));
        if (!missing.length && !stale.length) return prev;
        const seen = { ...prev.seen };
        for (const i of missing) seen[i.id] = at;
        for (const id of stale) delete seen[id];
        const next = { ...prev, seen };
        save(userId, next);
        return next;
      });
    };
    void run();
    const id = window.setInterval(() => void run(), POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(id);
    };
  }, [userId, chat, work, round]);

  // Between polls a new chat / news item shows as "just now" (it is stamped on the next round).
  const now = useNow(30_000);
  const raw = useMemo(() => {
    if (alerts === undefined) return undefined;
    const open = decided ? approvals.filter((a) => !decided[a.logId]) : approvals;
    const timed: Omit<BellItem, "read">[] = [...alerts, ...open, ...tasks];
    const untimed: Untimed[] = [
      ...(chat ? chatItems(members ?? []) : []),
      ...newsItems(announcements, notes, now),
    ];
    return { timed, untimed };
  }, [alerts, approvals, decided, tasks, chat, members, announcements, notes, now]);

  const items = useMemo(() => {
    if (!raw) return undefined;
    const read = new Set(stored.read);
    const fallback = new Date(now).toISOString();
    const all: BellItem[] = [
      ...raw.timed.map((i) => ({ ...i, read: read.has(i.id) })),
      ...raw.untimed.map((i) => ({ ...i, at: i.at || stored.seen[i.id] || fallback, read: read.has(i.id) })),
    ];
    return all.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [raw, stored, now]);

  const markRead = useCallback(
    (ids: readonly string[] | "all") => {
      if (userId == null || !items) return;
      const add = ids === "all" ? items.map((i) => i.id) : ids;
      const live = new Set(items.map((i) => i.id));
      // Keep read marks for items still listed first, then the newest others, capped.
      const merged = Array.from(new Set([...add, ...stored.read]));
      const next: Stored = { ...stored, read: [...merged.filter((id) => live.has(id)), ...merged.filter((id) => !live.has(id))].slice(0, MAX_READ) };
      setStored(next);
      save(userId, next);
    },
    [items, stored, userId],
  );

  const reload = useCallback(() => setRound((r) => r + 1), []);
  const unread = items ? items.filter((i) => !i.read).length : 0;
  return useMemo(() => ({ items, unread, failed, markRead, reload }), [items, unread, failed, markRead, reload]);
}

