import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../auth/authContext";
import {
  ApiError,
  teamTasksApi,
  type Member,
  type TaskChatLineJson,
  type TaskGroupJson,
  type TeamTaskAction,
  type TeamTaskCreate,
  type TeamTaskJson,
  type TeamTaskPatch,
  type TeamTasksSource,
} from "../../lib/api";
import { SAMPLES_ON } from "../fixtures";
import { SAMPLE_OWNER_NAME, sampleMembers, TASKS_CHANGED, teamTasksSample, teamTasksSampleForced } from "../fixtures/teamTasks";
import { useShell } from "../shell/shellContext";
import { useResource } from "../useResource";
import { buildDirectory, needsYou, toTask, type Directory, type TTask } from "./engine";

/** How often an open task view checks for updates (members' taps arrive through the API). */
export const TEAM_TASKS_POLL_MS = 15_000;
/** The task chat, while it is on screen. */
export const TASK_CHAT_POLL_MS = 4_000;

/** Fired after any task change, so every view (the badge, Overview, Chat, the old task cards) reloads at once. */
export const TEAM_TASKS_CHANGED = TASKS_CHANGED;
export function teamTasksChanged(): void {
  window.dispatchEvent(new Event(TASKS_CHANGED));
}

/**
 * Where tasks come from, decided once per tab: the v1.4 API, or (SAMPLES_ON only) the sample backend when the API
 * has no v1.4 tasks yet — 404, no network, or rows without `people` — or when forced (`?sample=tasks`).
 */
let decided: "api" | "sample" | null = null;
/** Read fresh after an await (another view may have decided meanwhile). */
const sampleNow = (): boolean => decided === "sample";
function sourceNow(): TeamTasksSource {
  return decided === "sample" ? teamTasksSample : teamTasksApi;
}
async function listFromSource(signal: AbortSignal): Promise<TeamTaskJson[]> {
  if (decided === null && teamTasksSampleForced()) decided = "sample";
  if (decided === "sample") return teamTasksSample.list(signal);
  try {
    const rows = await teamTasksApi.list(signal);
    // Another view settled on the sample backend while this call was out: follow it.
    if (sampleNow()) return teamTasksSample.list(signal);
    if (decided === null) {
      const oldShape = rows.length > 0 && !rows.some((r) => Array.isArray(r.people));
      decided = SAMPLES_ON && oldShape ? "sample" : "api";
      if (decided === "sample") return teamTasksSample.list(signal);
    }
    return rows;
  } catch (err) {
    if (sampleNow()) return teamTasksSample.list(signal);
    if (decided === null && SAMPLES_ON && err instanceof ApiError && ["not_found", "network", "server"].includes(err.kind)) {
      decided = "sample";
      return teamTasksSample.list(signal);
    }
    throw err;
  }
}

interface Raw {
  /** When this load finished (the screens' "now" never runs behind the data). */
  at: number;
  tasks: TeamTaskJson[];
  groups: TaskGroupJson[];
  sample: boolean;
}

export interface TeamTaskActions {
  /** Send a new task. Resolves with it (already in the list). */
  create(input: TeamTaskCreate): Promise<TTask>;
  /** Edit: title, note, due, priority, repeat, in order, steps (ticked steps keep their tick). */
  patch(id: number, patch: TeamTaskPatch): Promise<TTask>;
  /** approve · reopen · nudge · reply · reassign · move_due · cancel · restore. */
  action(id: number, body: TeamTaskAction): Promise<TTask>;
  /** Post the task's card in its group chat (or each person's chat with you). */
  copyToChat(t: TTask): Promise<void>;
  /** The task chat: load, send a line, mark read. */
  chat(id: number, signal?: AbortSignal): Promise<TaskChatLineJson[]>;
  say(id: number, body: string): Promise<TaskChatLineJson>;
  read(id: number): Promise<void>;
}

export interface TeamTasks {
  /** Every task, newest activity first; undefined while the first load runs. */
  tasks: TTask[] | undefined;
  dir: Directory;
  error: unknown;
  pending: boolean;
  reload: () => void;
  /** Sample data (dev / VITE_SAMPLE_DATA only). */
  sample: boolean;
  /** "Now" the values were computed at (refreshes every 30 s). */
  now: number;
  /** Tasks waiting on the owner: review, help, can't do it (the Tasks badge, Overview's Needs you). */
  needs: number;
  byId: (id: number) => TTask | undefined;
  act: TeamTaskActions;
}

/**
 * Every team task of the account (v1.4 API, lib/api/teamTasks.ts), normalised for the screens (engine.ts → TTask),
 * with the people directory (the team + groups) and the owner actions. Any change made here fires
 * TEAM_TASKS_CHANGED so every other view reloads; the members' side arrives on the poll. `enabled` false (no
 * team_chat on the plan) loads nothing. `members` defaults to the shell's team list.
 */
export function useTeamTasks({ enabled = true, pollMs = TEAM_TASKS_POLL_MS, members }: { enabled?: boolean; pollMs?: number; members?: Member[] } = {}): TeamTasks {
  const shell = useShell();
  const { user } = useAuth();
  const load = useCallback(
    async (signal: AbortSignal): Promise<Raw> => {
      if (!enabled) return { at: Date.now(), tasks: [], groups: [], sample: false };
      const tasks = await listFromSource(signal);
      const groups = await sourceNow()
        .groups(signal)
        .catch(() => []);
      return { at: Date.now(), tasks, groups, sample: decided === "sample" };
    },
    [enabled],
  );
  const res = useResource(load, { pollMs: enabled ? pollMs : undefined });
  const { reload, setData } = res;
  useEffect(() => {
    window.addEventListener(TASKS_CHANGED, reload);
    return () => window.removeEventListener(TASKS_CHANGED, reload);
  }, [reload]);

  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  // "now" follows the clock and every load, so late / "in 3 h" stay true.
  const now = Math.max(tick, res.data?.at ?? 0);

  const sample = !!res.data?.sample;
  const sampleTeam = useMemo(() => (sample ? sampleMembers() : undefined), [sample]);
  const team = sampleTeam ?? members ?? shell.members;
  const ownerName = sample ? SAMPLE_OWNER_NAME : user?.full_name || "You";
  const raw = res.data;
  const rawGroups = raw?.groups;
  const rawTasks = raw?.tasks;
  const dir = useMemo(() => buildDirectory(team, rawGroups ?? [], rawTasks ?? [], ownerName), [team, rawGroups, rawTasks, ownerName]);
  const tasks = useMemo(() => raw?.tasks.map((t) => toTask(t, dir, now)), [raw, dir, now]);

  const rawRef = useRef(raw);
  const dirRef = useRef(dir);
  useEffect(() => {
    rawRef.current = raw;
    dirRef.current = dir;
  }, [raw, dir]);
  const put = useCallback(
    (saved: TeamTaskJson, front = false): TTask => {
      const cur = rawRef.current;
      if (cur) {
        const has = cur.tasks.some((t) => t.id === saved.id);
        const list = has ? cur.tasks.map((t) => (t.id === saved.id ? saved : t)) : front ? [saved, ...cur.tasks] : [...cur.tasks, saved];
        setData({ ...cur, tasks: list });
      }
      teamTasksChanged();
      return toTask(saved, dirRef.current, Date.now());
    },
    [setData],
  );

  const act: TeamTaskActions = useMemo(
    () => ({
      create: async (input) => put(await sourceNow().create(input), true),
      patch: async (id, patch) => put(await sourceNow().patch(id, patch)),
      action: async (id, body) => put(await sourceNow().act(id, body)),
      copyToChat: async (t) => {
        await sourceNow().copyToChat(t.raw);
      },
      chat: (id, signal) => sourceNow().chat(id, signal),
      say: async (id, body) => {
        const line = await sourceNow().say(id, body);
        teamTasksChanged();
        return line;
      },
      read: async (id) => {
        await sourceNow().read(id);
        const cur = rawRef.current;
        if (cur?.tasks.some((t) => t.id === id && (t.chat?.unread ?? 0) > 0)) {
          setData({ ...cur, tasks: cur.tasks.map((t) => (t.id === id && t.chat ? { ...t, chat: { ...t.chat, unread: 0 } } : t)) });
        }
      },
    }),
    [put, setData],
  );

  const byId = useCallback((id: number) => tasks?.find((t) => t.id === id), [tasks]);
  return {
    tasks,
    dir,
    error: res.error,
    pending: res.pending,
    reload,
    sample,
    now,
    needs: (tasks ?? []).filter(needsYou).length,
    byId,
    act,
  };
}

/** The task chat of one task while it is on screen: lines (oldest first), send, and it marks them read. */
export function useTaskChat(team: TeamTasks, id: number | null, open: boolean) {
  const { act } = team;
  const load = useCallback((signal: AbortSignal) => (id == null || !open ? Promise.resolve([] as TaskChatLineJson[]) : act.chat(id, signal)), [act, id, open]);
  const lines = useResource(load, { pollMs: open && id != null ? TASK_CHAT_POLL_MS : undefined, resetKey: id ?? 0 });
  const count = lines.data?.length ?? 0;
  useEffect(() => {
    if (open && id != null) void act.read(id).catch(() => undefined);
  }, [open, id, count, act]);
  const send = useCallback(
    async (body: string) => {
      if (id == null) return;
      const line = await act.say(id, body);
      lines.setData([...(lines.data ?? []), line]);
    },
    [act, id, lines],
  );
  return { lines: lines.data, error: lines.error, pending: lines.pending, send, reload: lines.reload };
}
