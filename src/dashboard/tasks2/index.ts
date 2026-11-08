/**
 * STUB of the v1.4 tasks module (web-tasks area), made on the web-chat branch only so Chat builds and runs before
 * the merge. At merge it is REPLACED by web-tasks' real src/dashboard/tasks2/ (engine, panel, card, quick add, form).
 * The signatures below copy the real module's (its index.ts header, 8 Nov 2026), so Chat's code is the same before
 * and after the merge; only what Chat uses is implemented here, minimally and inline-styled.
 *
 *   useTeamTasks(opts?) → TeamTasks {tasks, dir, error, pending, reload, sample, now, needs, byId, act}
 *   <TaskCard task team onOpen(id, {tab?, card?}) thread? flash? say? />
 *   <TaskPanel team taskId create? tab? card? onClose onOpen? say? chatHref? />
 *   <QuickAdd team fixed?{memberIds?, groupId?} initialText? autoFocus? onSent? onOpenFull? onCancel? say? />
 *
 * Plain .ts (no JSX) on purpose: one file, replaced whole.
 */
import { createElement as h, useCallback, useEffect, useState, type ReactElement } from "react";
import { ApiError, authedRequest, createTask, errorMessage, type Task } from "../../lib/api";
import { useResource } from "../useResource";

export type TeamTaskStatus = "sent" | "seen" | "accepted" | "progress" | "help" | "cantdo" | "review" | "approved" | "cancelled";

export interface TeamTaskPerson {
  member_id: number;
  name: string;
  state: string;
  steps_total: number;
  steps_done: number;
}

export interface TeamTask {
  id: number;
  title: string;
  note: string;
  due_at: string | null;
  priority: "normal" | "high";
  status: TeamTaskStatus;
  group_id: number | null;
  people: TeamTaskPerson[];
  steps: Array<{ id: number; title: string; done: boolean; owner_id: number | null }>;
  chat: { count: number; unread: number; last: { text: string; by: string; at: string } | null };
  activity: Array<{ at: string; by: string; action: string; note: string }>;
  member: number;
  created_at: string;
  updated_at: string;
}

/** A task row as served: the 1.3 fields plus (from a v1.4 server) the team ones. */
type RawTask = Task & Partial<Omit<TeamTask, keyof Task>>;

/** Mirrors of the real module's exported types (parts.tsx / engine.ts). */
export type PanelTab = "overview" | "chat" | "activity";
export type PanelCard = "reply" | "reopen" | "reassign" | "due" | "cancel";
export interface OpenOpts {
  tab?: PanelTab;
  card?: PanelCard | null;
}
export type Say = (text: string, undo?: () => void) => void;
export interface TaskPrefill {
  title?: string;
  memberIds?: number[];
  groupId?: number | null;
  details?: string;
  high?: boolean;
  d?: number;
  time?: string;
  repeat?: "" | "day" | "week" | "month";
  mode?: "all" | "any";
  inOrder?: boolean;
  steps?: Array<{ title: string; ownerId: number | null }>;
}
export type TTask = TeamTask;
export interface TeamTasks {
  tasks: TTask[] | undefined;
  dir: { list: unknown[]; groups: unknown[] };
  error: unknown;
  pending: boolean;
  reload: () => void;
  sample: boolean;
  now: number;
  needs: number;
  byId: (id: number) => TTask | undefined;
  act: Record<string, unknown>;
}

const CHANGED = "zinwe:tasks-changed";
const changed = () => window.dispatchEvent(new Event(CHANGED));

/** Old (≤1.3.5) task rows have no people/chat blocks: one person, no group. */
function toTeamTask(raw: RawTask): TeamTask {
  const people = Array.isArray(raw.people)
    ? raw.people
    : [{ member_id: raw.member_id, name: raw.member_name, state: raw.status, steps_total: raw.steps.length, steps_done: raw.steps.filter((s) => s.done).length }];
  return {
    id: raw.id,
    title: raw.title,
    note: raw.note ?? "",
    due_at: raw.due_at ?? null,
    priority: raw.priority === "high" ? "high" : "normal",
    status: raw.status as TeamTaskStatus,
    group_id: raw.group_id ?? null,
    people,
    steps: (raw.steps ?? []).map((s) => ({ id: s.id, title: s.title, done: s.done, owner_id: (s as { owner_id?: number | null }).owner_id ?? null })),
    chat: raw.chat ?? { count: raw.talk_count ?? 0, unread: 0, last: null },
    activity: (raw.activity ?? []) as TeamTask["activity"],
    member: raw.member ?? raw.member_id,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

export function useTeamTasks({ enabled = true, pollMs = 15_000 }: { enabled?: boolean; pollMs?: number; members?: unknown[] } = {}): TeamTasks {
  const load = useCallback(
    async (signal: AbortSignal) => (enabled ? (await authedRequest<RawTask[]>("/api/devices/tasks/?status=all", { signal })).map(toTeamTask) : []),
    [enabled],
  );
  const res = useResource(load, { pollMs: enabled ? pollMs : undefined });
  const reload = res.reload;
  useEffect(() => {
    window.addEventListener(CHANGED, reload);
    return () => window.removeEventListener(CHANGED, reload);
  }, [reload]);
  const tasks = res.data;
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return {
    tasks,
    dir: { list: [], groups: [] },
    error: res.error,
    pending: res.pending,
    reload,
    sample: false,
    now: tick,
    needs: (tasks ?? []).filter((t) => t.status === "review" || t.status === "help" || t.status === "cantdo").length,
    byId: (id) => tasks?.find((t) => t.id === id),
    act: {},
  };
}

const STAGE: Record<string, string> = {
  sent: "Sent",
  seen: "Seen",
  accepted: "Confirmed",
  progress: "In progress",
  help: "Needs help",
  cantdo: "Can’t do it",
  review: "Waiting for your OK",
  approved: "Approved",
  cancelled: "Cancelled",
};
const STEP_OF: Record<string, number> = { sent: 1, seen: 2, accepted: 2, progress: 3, help: 3, cantdo: 3, review: 4, approved: 5, cancelled: 0 };
const ini = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
const firstOf = (name: string) => name.trim().split(/\s+/)[0] || name;
const pill = { display: "inline-flex", alignItems: "center", padding: "2px 9px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "#F5F5F5", color: "#404040" };
const av = { width: 22, height: 22, borderRadius: 11, background: "#FDEBDC", color: "#404040", fontSize: 9, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "2px solid #fff", marginLeft: -6 };
const dueText = (d: string | null) => (d ? new Date(d).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : "No due date");

function postChat(taskId: number, text: string) {
  return authedRequest(`/api/devices/tasks/${taskId}/chat/`, { method: "POST", body: { text, body: text } });
}

export function TaskCard({
  task,
  thread,
  onOpen: open,
}: {
  task: TTask;
  team: TeamTasks;
  onOpen: (id: number, opts?: OpenOpts) => void;
  thread?: boolean;
  flash?: boolean;
  say?: Say;
}): ReactElement {
  const onOpen = (chat?: boolean) => open(task.id, chat ? { tab: "chat" } : undefined);
  const [reply, setReply] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const attention = task.status === "help" || task.status === "review" || task.status === "cantdo";
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const send = async () => {
    const text = reply.trim();
    if (!text) return;
    try {
      await postChat(task.id, text);
      setReply("");
      setErr(null);
      changed();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  const n = task.chat.count;
  const last = task.chat.last;
  return h(
    "article",
    {
      className: "tv-card",
      "aria-label": task.title,
      onClick: () => onOpen(),
      style: { width: "min(440px, 100%)", border: "1px solid #E5E5E5", borderLeft: attention ? "3px solid #F26A0A" : "1px solid #E5E5E5", borderRadius: 14, background: "#fff", padding: 12, display: "flex", flexDirection: "column", gap: 8, cursor: "pointer", textAlign: "left" },
    },
    h(
      "div",
      { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
      h("span", { style: pill }, STAGE[task.status] ?? task.status),
      h("span", { style: { ...pill, background: "#FDEBDC", color: "#8A3A04" } }, dueText(task.due_at)),
      task.priority === "high" ? h("span", { style: { ...pill, background: "#FBE9E5", color: "#C0331C" } }, "High") : null,
    ),
    h("b", { style: { fontSize: 15 } }, task.title),
    h(
      "span",
      { style: { display: "flex", gap: 4 } },
      ...[1, 2, 3, 4, 5].map((i) => h("i", { key: i, style: { flex: 1, height: 4, borderRadius: 2, background: i <= (STEP_OF[task.status] ?? 0) ? "#F26A0A" : "#E5E5E5" } })),
    ),
    h(
      "div",
      { style: { display: "flex", alignItems: "center", gap: 8 } },
      h("span", { style: { display: "inline-flex", paddingLeft: 6 } }, ...task.people.slice(0, 3).map((p) => h("span", { key: p.member_id, style: av, title: p.name }, ini(p.name)))),
      h("span", { style: { flex: 1 } }),
      h(
        "button",
        { type: "button", "aria-label": `Task chat: ${n} messages`, onClick: (e: { stopPropagation: () => void }) => (stop(e), onOpen(true)), style: { border: "1px solid #E5E5E5", borderRadius: 999, background: "#fff", fontSize: 12, padding: "2px 8px" } },
        `Chat ${n}${task.chat.unread ? ` · ${task.chat.unread} new` : ""}`,
      ),
    ),
    thread
      ? h(
          "div",
          { onClick: stop, style: { borderTop: "1px solid #EEEEEE", margin: "2px -12px -12px", padding: "8px 12px 12px", background: "#FAFAFA", borderRadius: "0 0 14px 14px", display: "flex", flexDirection: "column", gap: 6 } },
          last ? h("span", { style: { fontSize: 13 } }, h("b", null, `${last.by === "owner" ? "You" : firstOf(last.by)} `), last.text) : null,
          h(
            "div",
            { style: { display: "flex", justifyContent: "space-between", fontSize: 13 } },
            h("button", { type: "button", onClick: () => onOpen(true), style: { border: 0, background: "none", padding: 0, fontWeight: 600 } }, n ? `${n} ${n === 1 ? "reply" : "replies"}` : "No replies yet"),
            h("button", { type: "button", onClick: () => onOpen(true), style: { border: 0, background: "none", padding: 0 } }, "Open task chat"),
          ),
          h(
            "div",
            { style: { display: "flex", gap: 6 } },
            h("input", {
              value: reply,
              placeholder: "Reply to this task…",
              "aria-label": "Reply to this task…",
              onChange: (e: { target: { value: string } }) => setReply(e.target.value),
              onKeyDown: (e: { key: string; preventDefault: () => void }) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void send();
                }
              },
              style: { flex: 1, minWidth: 0, height: 34, border: "1px solid #E5E5E5", borderRadius: 10, padding: "0 10px", font: "inherit", fontSize: 13 },
            }),
            h("button", { type: "button", "aria-label": "Send reply", onClick: () => void send(), style: { width: 34, height: 34, border: 0, borderRadius: 10, background: "#F26A0A" } }, "→"),
          ),
          err ? h("small", { role: "alert", style: { color: "#C0331C" } }, err) : null,
        )
      : null,
  );
}

export function TaskPanel({
  team,
  taskId: id,
  create,
  tab = "overview",
  onClose,
}: {
  team: TeamTasks;
  taskId: number | null;
  create?: TaskPrefill | null;
  tab?: PanelTab;
  card?: PanelCard | null;
  onClose: () => void;
  onOpen?: (id: number) => void;
  say?: Say;
  chatHref?: (t: TTask) => string;
}): ReactElement {
  // The stub has no create form: a new task opens the quick add's job in a plain panel.
  const taskId = id ?? 0;
  const task = id == null ? undefined : team.byId(id);
  const [on, setOn] = useState(tab);
  const [text, setText] = useState("");
  const [lines, setLines] = useState<Array<{ id?: number; text?: string; body?: string; by?: string; at?: string }> | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (id == null) return;
    const c = new AbortController();
    authedRequest<Array<{ text?: string; body?: string; by?: string; at?: string }>>(`/api/devices/tasks/${taskId}/chat/`, { signal: c.signal })
      .then((rows) => {
        setLines(Array.isArray(rows) ? rows : []);
        void authedRequest(`/api/devices/tasks/${taskId}/chat/read/`, { method: "POST" }).catch(() => {});
      })
      .catch((e: unknown) => {
        if (c.signal.aborted) return;
        setLines([]);
        setNote(e instanceof ApiError && e.kind === "not_found" ? "The task chat comes with the v1.4 server." : errorMessage(e));
      });
    return () => c.abort();
  }, [id, taskId, n]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const send = async () => {
    if (!text.trim()) return;
    try {
      await postChat(taskId, text.trim());
      setText("");
      setN((x) => x + 1);
      changed();
    } catch (e) {
      setNote(errorMessage(e));
    }
  };
  const tabBtn = (k: "overview" | "chat" | "activity", label: string) =>
    h("button", { key: k, type: "button", "aria-pressed": on === k, onClick: () => setOn(k), style: { border: 0, borderRadius: 8, padding: "6px 12px", fontWeight: 600, background: on === k ? "#fff" : "transparent" } }, label);
  return h(
    "div",
    { role: "dialog", "aria-modal": "true", "aria-label": task?.title ?? "Task", style: { position: "fixed", inset: 0, zIndex: 120, display: "flex", justifyContent: "flex-end" } },
    h("button", { type: "button", tabIndex: -1, "aria-label": "Close", onClick: onClose, style: { position: "absolute", inset: 0, border: 0, background: "rgba(20,18,16,.38)" } }),
    h(
      "div",
      { style: { position: "relative", width: "min(460px, 100%)", height: "100%", background: "#fff", display: "flex", flexDirection: "column", gap: 12, padding: 20, overflowY: "auto", boxSizing: "border-box" } },
      h(
        "div",
        { style: { display: "flex", justifyContent: "space-between", gap: 8 } },
        h("h2", { style: { margin: 0, fontSize: 18 } }, task?.title ?? (create ? "New task" : "Task")),
        h("button", { type: "button", "aria-label": "Close", onClick: onClose, className: "zk-ic" }, "×"),
      ),
      h("div", { role: "group", style: { display: "inline-flex", gap: 2, padding: 3, borderRadius: 10, background: "#F5F5F5", alignSelf: "flex-start" } }, tabBtn("overview", "Overview"), tabBtn("chat", "Chat"), tabBtn("activity", "Activity")),
      create && id == null ? h(QuickAdd, { team, fixed: { memberIds: create.memberIds, groupId: create.groupId }, initialText: create.title, autoFocus: true, onSent: () => onClose(), onCancel: onClose }) : null,
      on === "overview" && task
        ? h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: 8, fontSize: 14 } },
            h("span", null, `${STAGE[task.status] ?? task.status} · ${dueText(task.due_at)}`),
            ...task.people.map((p) => h("span", { key: p.member_id }, `${p.name} · ${p.steps_done}/${p.steps_total} steps`)),
            ...task.steps.map((s) => h("span", { key: `s${s.id}` }, `${s.done ? "✓" : "○"} ${s.title}`)),
          )
        : null,
      on === "chat"
        ? h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: 8 } },
            lines === null ? h("span", null, "Loading…") : lines.length ? null : h("span", { style: { color: "#6B6B6B" } }, "No replies yet."),
            ...(lines ?? []).map((l, i) => h("span", { key: l.id ?? i, style: { fontSize: 14 } }, h("b", null, `${l.by ?? ""} `), l.text ?? l.body ?? "")),
            note ? h("small", { style: { color: "#6B6B6B" } }, note) : null,
            h(
              "div",
              { style: { display: "flex", gap: 6 } },
              h("input", {
                value: text,
                placeholder: "Message the task chat…",
                "aria-label": "Message the task chat",
                onChange: (e: { target: { value: string } }) => setText(e.target.value),
                onKeyDown: (e: { key: string }) => e.key === "Enter" && void send(),
                className: "zk-inp",
              }),
              h("button", { type: "button", className: "z-btn pri sm", onClick: () => void send() }, "Send"),
            ),
          )
        : null,
      on === "activity" && task ? h("div", { style: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13 } }, ...task.activity.map((a, i) => h("span", { key: i }, `${a.action}${a.note ? `: ${a.note}` : ""}`))) : null,
    ),
  );
}

export function QuickAdd({
  fixed,
  initialText = "",
  autoFocus = false,
  onSent,
  onCancel,
}: {
  team: TeamTasks;
  fixed?: { memberIds?: number[]; groupId?: number | null };
  initialText?: string;
  autoFocus?: boolean;
  onSent?: (t: TTask) => void;
  onOpenFull?: (prefill: TaskPrefill) => void;
  onCancel?: () => void;
  say?: Say;
}): ReactElement {
  const preset = { memberIds: fixed?.memberIds, groupId: fixed?.groupId ?? undefined };
  const onClose = () => onCancel?.();
  const [text, setText] = useState(initialText);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    const title = text.trim();
    if (!title || pending) return;
    setPending(true);
    setErr(null);
    const ids = preset.memberIds ?? [];
    try {
      let raw: RawTask;
      try {
        raw = await authedRequest<RawTask>("/api/devices/tasks/", {
          method: "POST",
          body: { title, member_ids: ids, group_id: preset.groupId ?? null, post_in_group: preset.groupId != null, mode: "all", in_order: false, repeat: "", steps: [] },
        });
      } catch (e) {
        // A server before v1.4: one person through the old endpoint.
        if (e instanceof ApiError && (e.status === 404 || e.status === 405) && ids.length === 1) raw = await createTask(ids[0], { title });
        else throw e;
      }
      setText("");
      changed();
      onSent?.(toTeamTask(raw));
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setPending(false);
    }
  };
  return h(
    "div",
    { className: "qa-stub", style: { display: "flex", flexDirection: "column", gap: 6, border: "1px solid #141210", borderRadius: 14, padding: 10, background: "#fff" } },
    h(
      "div",
      { style: { display: "flex", gap: 8, alignItems: "center" } },
      h("input", {
        autoFocus: autoFocus || !!initialText,
        value: text,
        placeholder: "What needs doing? Try “tomorrow 5pm”",
        "aria-label": "New task",
        onChange: (e: { target: { value: string } }) => setText(e.target.value),
        onKeyDown: (e: { key: string; preventDefault: () => void }) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void send();
          } else if (e.key === "Escape") onClose();
        },
        style: { flex: 1, minWidth: 0, height: 40, border: 0, outline: "none", font: "inherit", fontSize: 15 },
      }),
      h("button", { type: "button", className: "z-btn pri sm", disabled: !text.trim() || pending, onClick: () => void send() }, pending ? "Sending…" : "Send"),
    ),
    err ? h("small", { role: "alert", style: { color: "#C0331C" } }, err) : null,
  );
}
