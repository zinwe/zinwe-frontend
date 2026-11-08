import type { ChatGroup, ChatMessage, ChatReport, ChatSettings, GroupInput, Member } from "../../lib/api";

/** The pictures as the API stores them (SVG paths): Design, Code, People. */
const ICON = {
  design: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
  code: "m8 8-4 4 4 4M16 8l4 4-4 4M14 4l-4 16",
  people: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
};
import { sample, sampleStore } from "./index";

/**
 * SAMPLE (DashChat, DashPhoneChat): team chat groups (v1.4, z_chat) while the server has no /api/chat/ yet.
 * Only used when SAMPLES_ON (dev server, or a VITE_SAMPLE_DATA=1 build) AND the server answers 404 for the groups
 * list (chat/groupsSource.ts decides once per visit). A server that has the endpoint always wins, and production
 * builds never read this: there an old server simply shows no groups.
 *
 * Laid onto the real team like the other samples: "Design" = the designers (or the first three people),
 * "Development" = the developers (or the next four), "Everyone" = all. A few lines from them, one report, and the
 * chat settings. Sends, edits, deletes, reads, new groups and edits to a group are kept for the tab's life; a line
 * you send is seen by everyone and answered by someone a moment later, like the board.
 *
 * When /api/chat/ ships: nothing here is read any more (the source sees a 200).
 */

interface SampleState {
  seeded: boolean;
  groups: ChatGroup[];
  messages: Record<string, ChatMessage[]>;
  reports: ChatReport[];
  settings: ChatSettings;
  nextId: number;
}

const store = sampleStore<SampleState>("chat-v14", () => ({ seeded: false, groups: [], messages: {}, reports: [], settings: { allow_member_dm: true }, nextId: 1000 }));

const ANSWERS = ["Got it, thanks.", "Sounds good.", "Will do.", "On it.", "Thanks!"];

const first = (name: string) => name.trim().split(/\s+/)[0] || name;
const owner = { kind: "owner" as const, member_id: null, name: "You" };
const by = (m: Member) => ({ kind: "member" as const, member_id: m.id, name: m.name });

function todayAt(h: number, min: number): string {
  const d = new Date();
  d.setHours(h, min, 0, 0);
  // Never in the future: early in the day the sample lines move to yesterday.
  if (d.getTime() > Date.now()) d.setDate(d.getDate() - 1);
  return d.toISOString();
}

function names(list: readonly Member[]): string {
  const f = list.map((m) => first(m.name));
  return f.length > 1 ? `${f.slice(0, -1).join(", ")} and ${f[f.length - 1]}` : f.join("");
}

function seed(members: readonly Member[]): SampleState {
  const st = store.get();
  if (st.seeded) return st;
  const team = members.filter((m) => m.is_active);
  if (!team.length) return st;
  const byRole = (role: string, fallback: Member[]) => {
    const hit = team.filter((m) => m.role === role);
    return hit.length >= 2 ? hit : fallback;
  };
  const design = byRole("designer", team.slice(0, Math.min(3, team.length)));
  const dev = byRole("developer", team.slice(3, 7).length >= 2 ? team.slice(3, 7) : team.slice(0, Math.min(4, team.length)));
  let id = 1;
  const msg = (body: string, who: Member | null, at: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
    id: id++,
    by: who ? by(who) : owner,
    body,
    reply_to: null,
    task_id: null,
    system: false,
    edited: false,
    deleted: false,
    at,
    seen_by: who ? undefined : 0,
    ...extra,
  });
  const sys = (body: string, at: string): ChatMessage => msg(body, null, at, { system: true, by: null, seen_by: undefined });

  const g = (gid: number, name: string, icon: string, people: Member[], lines: ChatMessage[], unread: number): ChatGroup => {
    const last = [...lines].reverse().find((l) => !l.system) ?? lines[lines.length - 1];
    return {
      id: gid,
      kind: "group",
      name,
      icon,
      announce: false,
      member_ids: people.map((m) => m.id),
      unread,
      mentioned: false,
      last_message: last ? { text: last.body, by: last.by, at: last.at, system: last.system, task_id: last.task_id } : null,
      last_message_at: last?.at ?? null,
      created_at: todayAt(8, 0),
    };
  };

  const [d1, d2, d3] = [design[0], design[1] ?? design[0], design[2] ?? design[0]];
  const designLines = [
    sys(`You made the group and added ${names(design)}.`, todayAt(8, 0)),
    msg(`Hero options are in Figma, three versions. Which one do you like for Lumen?`, d2, todayAt(11, 2)),
    msg("Option B. Bigger product shot, shorter headline.", null, todayAt(11, 10), { seen_by: design.length }),
    msg("On it. Cutting the images now.", d1, todayAt(11, 14)),
    msg("The printer on the 2nd floor is out of toner. I’m ordering more today.", d3, todayAt(14, 40)),
  ];
  designLines[3].reply_to = { id: designLines[2].id, by: owner, body: designLines[2].body };
  const [v1, v2, v3] = [dev[0], dev[1] ?? dev[0], dev[2] ?? dev[0]];
  const devLines = [
    sys(`You made the group and added ${names(dev)}.`, todayAt(8, 0)),
    msg("Staging is slow again, looking into it.", v1, todayAt(10, 5)),
    msg("It’s the image cache. Fix is in PR #490.", v2, todayAt(10, 12)),
    msg("Thanks both. Please merge it before the BluePeak demo.", null, todayAt(10, 20), { seen_by: dev.length }),
    msg("Merged. Staging is back to normal.", v3, todayAt(12, 40)),
  ];
  const allLines = [
    sys(`You made the group and added everyone.`, todayAt(8, 0)),
    msg("Friday 5 PM on the terrace for the Diwali party. Please send your food choices by Wednesday.", null, todayAt(9, 12), { seen_by: team.length }),
  ];

  const groups = [g(1, "Design", ICON.design, design, designLines, 2), g(2, "Development", ICON.code, dev, devLines, 0), g(3, "Everyone", ICON.people, team, allLines, 0)];
  const reporter = team[1] ?? team[0];
  const about = team[2] ?? team[0];
  const next: SampleState = {
    seeded: true,
    groups,
    messages: { 1: designLines, 2: devLines, 3: allLines },
    reports:
      team.length >= 3
        ? [
            {
              id: 1,
              conversation: { id: 0, kind: "direct", name: `${first(reporter.name)} and ${first(about.name)}` },
              message: { id: 0, body: "Can you send me the bank portal password? I’ll do the vendor payment myself today.", by: by(about), at: todayAt(14, 44) },
              reporter: { member_id: reporter.id, name: reporter.name },
              note: "They asked in our chat. I didn’t share it.",
              created_at: todayAt(14, 51),
              handled_at: null,
            },
          ]
        : [],
    settings: { allow_member_dm: true },
    nextId: id + 100,
  };
  store.set(next);
  return next;
}

function save(st: SampleState): void {
  store.set({ ...st });
}

function group(st: SampleState, id: number): ChatGroup {
  const g = st.groups.find((x) => x.id === id);
  if (!g) throw new Error("No such group");
  return g;
}

function touch(st: SampleState, g: ChatGroup): void {
  const lines = st.messages[g.id] ?? [];
  const last = [...lines].reverse().find((l) => !l.deleted) ?? lines[lines.length - 1];
  g.last_message = last ? { text: last.deleted ? "This message was deleted" : last.body, by: last.by, at: last.at, system: last.system, task_id: last.task_id } : null;
  g.last_message_at = last?.at ?? g.last_message_at;
}

/**
 * A line you sent a moment ago is seen by everyone, and (once per line) someone answers it: the board's feeling,
 * applied when the thread or the list is read again.
 */
function settle(st: SampleState, members: readonly Member[]): boolean {
  let changed = false;
  const now = Date.now();
  for (const g of st.groups) {
    const lines = st.messages[g.id] ?? [];
    const last = lines[lines.length - 1];
    if (!last || last.by?.kind !== "owner" || last.system || last.deleted) continue;
    const age = now - new Date(last.at).getTime();
    if (age > 1200 && last.seen_by !== g.member_ids.length) {
      last.seen_by = g.member_ids.length;
      changed = true;
    }
    if (age > 2500 && age < 10 * 60_000 && !(last as ChatMessage & { answered?: boolean }).answered) {
      (last as ChatMessage & { answered?: boolean }).answered = true;
      const tagged = members.find((m) => g.member_ids.includes(m.id) && last.body.includes(`@${first(m.name)}`));
      const who = tagged ?? members.find((m) => m.id === g.member_ids[last.id % Math.max(1, g.member_ids.length)]);
      if (who) {
        lines.push({
          id: st.nextId++,
          by: by(who),
          body: tagged ? "On it." : ANSWERS[last.id % ANSWERS.length],
          reply_to: tagged ? { id: last.id, by: owner, body: last.body } : null,
          task_id: null,
          system: false,
          edited: false,
          deleted: false,
          at: new Date().toISOString(),
        });
        g.unread += 1;
        touch(st, g);
      }
      changed = true;
    }
  }
  return changed;
}

export function sampleListGroups(members: readonly Member[], signal?: AbortSignal): Promise<ChatGroup[]> {
  const st = seed(members);
  if (settle(st, members)) save(st);
  return sample(st.groups, signal, 120);
}

export function sampleListMessages(id: number, members: readonly Member[], signal?: AbortSignal): Promise<ChatMessage[]> {
  const st = seed(members);
  if (settle(st, members)) save(st);
  return sample(st.messages[id] ?? [], signal, 120);
}

export function sampleSend(id: number, body: string, replyTo: number | null): Promise<ChatMessage> {
  const st = store.get();
  const g = group(st, id);
  const lines = (st.messages[id] ??= []);
  const q = replyTo != null ? lines.find((l) => l.id === replyTo) : null;
  const m: ChatMessage = {
    id: st.nextId++,
    by: owner,
    body,
    reply_to: q ? { id: q.id, by: q.by, body: q.body } : null,
    task_id: null,
    system: false,
    edited: false,
    deleted: false,
    at: new Date().toISOString(),
    seen_by: 0,
  };
  lines.push(m);
  touch(st, g);
  save(st);
  return sample(m, undefined, 80);
}

export function sampleEdit(id: number, messageId: number, body: string): Promise<ChatMessage> {
  const st = store.get();
  const m = (st.messages[id] ?? []).find((l) => l.id === messageId);
  if (!m) throw new Error("No such message");
  m.body = body;
  m.edited = true;
  touch(st, group(st, id));
  save(st);
  return sample(m, undefined, 80);
}

export function sampleDelete(id: number, messageId: number): Promise<void> {
  const st = store.get();
  const m = (st.messages[id] ?? []).find((l) => l.id === messageId);
  if (m) {
    m.deleted = true;
    m.body = "";
  }
  touch(st, group(st, id));
  save(st);
  return sample(undefined, undefined, 80);
}

export function sampleRead(id: number): Promise<void> {
  const st = store.get();
  const g = st.groups.find((x) => x.id === id);
  if (g) {
    g.unread = 0;
    g.mentioned = false;
    save(st);
  }
  return sample(undefined, undefined, 40);
}

function sysLine(st: SampleState, g: ChatGroup, body: string): void {
  (st.messages[g.id] ??= []).push({ id: st.nextId++, by: null, body, reply_to: null, task_id: null, system: true, edited: false, deleted: false, at: new Date().toISOString() });
}

export function sampleCreate(input: GroupInput, members: readonly Member[]): Promise<ChatGroup> {
  const st = seed(members);
  const gid = Math.max(0, ...st.groups.map((g) => g.id)) + 1;
  const g: ChatGroup = {
    id: gid,
    kind: "group",
    name: input.name,
    icon: input.icon,
    announce: input.announce,
    member_ids: [...input.member_ids],
    unread: 0,
    mentioned: false,
    last_message: null,
    last_message_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
  const people = members.filter((m) => input.member_ids.includes(m.id));
  st.groups = [g, ...st.groups];
  sysLine(st, g, `You made the group and added ${names(people)}.${input.announce ? " Only you can post here." : ""}`);
  touch(st, g);
  save(st);
  return sample(g, undefined, 120);
}

export function sampleUpdate(id: number, patch: Partial<GroupInput>, members: readonly Member[]): Promise<ChatGroup> {
  const st = store.get();
  const g = group(st, id);
  const nameOf = (ids: number[]) => names(members.filter((m) => ids.includes(m.id)));
  if (patch.name != null && patch.name !== g.name) {
    g.name = patch.name;
    sysLine(st, g, `You renamed the group to ${patch.name}.`);
  }
  if (patch.member_ids) {
    const added = patch.member_ids.filter((x) => !g.member_ids.includes(x));
    const removed = g.member_ids.filter((x) => !patch.member_ids!.includes(x));
    if (added.length) sysLine(st, g, `You added ${nameOf(added)}.`);
    if (removed.length) sysLine(st, g, `You removed ${nameOf(removed)}. They keep what was said before they left.`);
    g.member_ids = [...patch.member_ids];
  }
  if (patch.announce != null && patch.announce !== g.announce) {
    g.announce = patch.announce;
    sysLine(st, g, patch.announce ? "Only you can post here now." : "Everyone can post here again.");
  }
  if (patch.icon) g.icon = patch.icon;
  touch(st, g);
  save(st);
  return sample(g, undefined, 120);
}

/** Delete a group (v1.4.1): it and its lines go; reports about it stay, named "Design (deleted)". */
export function sampleDeleteGroup(id: number): Promise<void> {
  const st = store.get();
  const g = group(st, id);
  st.groups = st.groups.filter((x) => x.id !== id);
  delete st.messages[id];
  st.reports = st.reports.map((r) => (r.conversation?.kind === "group" && r.conversation.id === id ? { ...r, conversation: { id: null, kind: "group", name: `${g.name} (deleted)` } } : r));
  save(st);
  return sample(undefined, undefined, 120);
}

export function sampleReports(members: readonly Member[], signal?: AbortSignal): Promise<ChatReport[]> {
  return sample(seed(members).reports, signal, 100);
}

export function sampleHandle(id: number): Promise<ChatReport> {
  const st = store.get();
  const r = st.reports.find((x) => x.id === id);
  if (!r) throw new Error("No such report");
  r.handled_at = new Date().toISOString();
  save(st);
  return sample(r, undefined, 80);
}

export function sampleSettings(signal?: AbortSignal): Promise<ChatSettings> {
  return sample(store.get().settings, signal, 60);
}

export function sampleSaveSettings(patch: Partial<ChatSettings>): Promise<ChatSettings> {
  const st = store.get();
  st.settings = { ...st.settings, ...patch };
  save(st);
  return sample(st.settings, undefined, 60);
}
