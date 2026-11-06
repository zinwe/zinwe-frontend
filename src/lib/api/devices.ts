/** PCs, members, rules and activity (z_devices). */
import { authedDownload, authedRequest } from "./http";
import { rememberPictures, type MemberPicture } from "./pictures";
import type { Task } from "./tasks";

/**
 * What the agent last reported the person was doing (M8). Older agents that
 * don't send it heartbeat as "not_started"; treat any unknown value as that.
 */
export type WorkState = "not_started" | "working" | "on_break" | "ended";
export const WORK_STATES: readonly WorkState[] = ["not_started", "working", "on_break", "ended"];

/** Narrow an unknown wire value to a WorkState, defaulting to "not_started". */
export function toWorkState(value: unknown): WorkState {
  return WORK_STATES.includes(value as WorkState) ? (value as WorkState) : "not_started";
}

export interface Device {
  id: number;
  hostname: string;
  /** "windows" | "linux" | "macos" today; kept open for new agents. */
  platform: string;
  os_version: string;
  agent_version: string;
  enrolled_at: string;
  last_seen_at: string | null;
  is_online: boolean;
  is_revoked: boolean;
  /** The member this PC enrolled as, when the backend has joined it in. */
  member_id?: number | null;
  member_name?: string | null;
  /** Work status (M8). Optional so an older backend/agent degrades cleanly. */
  work_state?: WorkState;
  worked_seconds?: number;
  break_seconds?: number;
  /** When the agent switched this PC's USB to read-only after a large copy (null = not locked). */
  usb_locked_at?: string | null;
  /** The owner pressed "Restore USB"; the PC restores it on its next check-in. */
  usb_restore_requested_at?: string | null;
  /** The person's answer on the widget's consent screen. Absent on older backends. */
  consent_state?: ConsentState;
  consent_declined_at?: string | null;
}

/** "pending" until the person answers on their PC; "declined" = nothing is collected from that PC. */
export type ConsentState = "pending" | "given" | "declined";

/**
 * A person the owner has added. They enrol their PC with their email + the
 * `member_id` below (format "ZM-XXXX-XXXX"), which replaces the old org-wide key.
 */
export interface Member {
  id: number;
  name: string;
  email: string;
  /** The enrol id shown to the owner, e.g. "ZM-7KQ2-9F3M". */
  member_id: string;
  /** What they do (FR-19): the card's colour theme. "" = not set; older backends leave it out. */
  role?: MemberRole | "";
  is_active: boolean;
  created_at: string;
  /** The PC this member has enrolled, or null until they install the agent. */
  device: MemberDevice | null;
  /** Where this member downloads the agent — same link as their invite email. */
  download_url?: string;
  /** Unread replies from this member the admin hasn't opened yet (chat badge). */
  unread?: number;
  /** The newest line of the chat, for its tile: null with no messages (or no Chat on the plan). Older backends leave it out. */
  last_message?: MemberLastMessage | null;
  /** FR-44: library avatar or photo; null = initials. Older backends leave it out. */
  picture?: MemberPicture | null;
}

/** The newest line of a conversation: one short line of text, who wrote it, and when. */
export interface MemberLastMessage {
  text: string;
  sender: "owner" | "member";
  at: string;
}

/** The slice of a Device the Team page shows beside a member. */
export interface MemberDevice {
  hostname: string;
  last_seen_at: string | null;
  is_online: boolean;
  agent_version?: string;
  /** Work status (M8). Optional so an older backend/agent degrades cleanly. */
  work_state?: WorkState;
  worked_seconds?: number;
  break_seconds?: number;
  /** The member's consent on the widget's consent screen: which policy version, and when ("" / null = not yet). */
  consent_version?: string;
  consent_at?: string | null;
  /** Same as on Device, when the backend joins them into the member's PC. */
  consent_state?: ConsentState;
  usb_locked_at?: string | null;
}

export interface MemberPayload {
  name: string;
  email: string;
}

export type MemberField = keyof MemberPayload;

export type UsbMode = "allow" | "read_only" | "block";

export type WebMode = "monitor" | "block";

/** The site lists (GET devices/lists/). The first four are switched on when the owner first chooses blocking. */
export type WebCategory = "adult" | "gambling" | "malware" | "phishing" | "social" | "video";
export const WEB_CATEGORIES: readonly WebCategory[] = ["adult", "gambling", "malware", "phishing", "social", "video"];

export interface UsbPolicy {
  mode: UsbMode;
}

export interface WebPolicy {
  enabled: boolean;
  /** monitor = record usage only; block = also block the chosen categories and domains. */
  mode: WebMode;
  /** The lists switched on; [] = none, only custom_domains are blocked. */
  categories: WebCategory[];
  /** Extra domains to block, e.g. "example.com". */
  custom_domains: string[];
  /** Sites that stay open whatever a list says: names, and ids ("h:…") for hidden names. Optional when saving. */
  allow_domains?: string[];
  /** The allow list as shown to the owner. Read only; hidden names come masked. */
  allow_sites?: BlockListSite[];
}

/** One site of a list. `id` is what goes in allow_domains; `name` is masked on a hidden list. */
export interface BlockListSite {
  id: string;
  name: string;
  lists: WebCategory[];
}

export interface BlockList {
  key: WebCategory;
  label: string;
  description: string;
  /** The true number of sites in the list. */
  count: number;
  masked: boolean;
  default_on: boolean;
}

export interface BlockLists {
  version: string;
  updated_at: string;
  lists: BlockList[];
}

export interface BlockListSites {
  key: WebCategory;
  /** Sites matching the search, across all pages. */
  count: number;
  page: number;
  page_size: number;
  has_more: boolean;
  masked: boolean;
  sites: BlockListSite[];
}

export interface DataTransferPolicy {
  enabled: boolean;
  usb_warn_bytes: number;
  lan_warn_bytes: number;
  email_warn_bytes: number;
  /** Website uploads limit: what a browser or mail app sends to one site within an hour. */
  web_upload_warn_bytes?: number;
  /** OFF by default: filenames/subjects are recorded only when true. */
  include_details: boolean;
  /** When true, a USB copy over the usb limit auto-sets the PC to USB read-only. */
  usb_lockdown: boolean;
}

export interface RemoteSoftwarePolicy {
  enabled: boolean;
  blocking_enabled: boolean;
  /** Tool display names to block when seen, e.g. "AnyDesk". */
  blocked_tools: string[];
  /** Extra executable names (no .exe) to also treat as remote tools. */
  extra_tool_executables: string[];
}

export interface Policy {
  version: number;
  usb: UsbPolicy;
  web: WebPolicy;
  data_transfer: DataTransferPolicy;
  remote_software: RemoteSoftwarePolicy;
  updated_at: string;
}

/** A partial change: send only the block(s) the owner actually edited. */
export interface PolicyUpdate {
  usb?: UsbPolicy;
  web?: WebPolicy;
  data_transfer?: DataTransferPolicy;
  remote_software?: RemoteSoftwarePolicy;
}

/** Defaults matching the backend's new-Policy and migration defaults. */
export const POLICY_DEFAULTS = {
  usb: { mode: "allow" } as UsbPolicy,
  web: { enabled: true, mode: "monitor", categories: [], custom_domains: [] } as WebPolicy,
  data_transfer: {
    enabled: true,
    usb_warn_bytes: 52_428_800,
    lan_warn_bytes: 52_428_800,
    email_warn_bytes: 20_971_520,
    include_details: false,
    usb_lockdown: false,
  } as DataTransferPolicy,
  remote_software: {
    enabled: true,
    blocking_enabled: false,
    blocked_tools: [],
    extra_tool_executables: [],
  } as RemoteSoftwarePolicy,
} as const;

/**
 * Fill in any block the backend hasn't shipped yet, so the page always has a
 * full shape to edit even while the backend is mid-rollout.
 */
export function normalizePolicy(raw: Policy): Policy {
  return {
    version: raw.version,
    updated_at: raw.updated_at,
    usb: raw.usb ?? { ...POLICY_DEFAULTS.usb },
    web: raw.web ?? { ...POLICY_DEFAULTS.web, categories: [], custom_domains: [] },
    data_transfer: raw.data_transfer ?? { ...POLICY_DEFAULTS.data_transfer },
    remote_software: raw.remote_software
      ? raw.remote_software
      : { ...POLICY_DEFAULTS.remote_software, blocked_tools: [], extra_tool_executables: [] },
  };
}

export type EventSeverity = "info" | "warning" | "critical";

export interface DeviceEvent {
  id: number;
  device_id: number;
  hostname: string;
  type: string;
  /** "info" | "warning" | "critical"; unknown values render as info. */
  severity: string;
  title: string;
  occurred_at: string;
  received_at: string;
  data: Record<string, unknown>;
  /** When this alert was emailed to the member (via Activity → Send mail), or null. */
  emailed_at?: string | null;
  /** "confirmation" = a rule was applied (not a risk): never shown or counted as an alert. */
  kind?: "alert" | "confirmation";
  /** When the owner marked it handled (or messaged the person about it); null = still open. */
  handled_at?: string | null;
  /** Who handled it ("" when not handled). */
  handled_by?: string;
}

/** POST /api/devices/events/<id>/handled/ — mark an alert handled (or open again). */
export function markEventHandled(eventId: number, handled: boolean): Promise<DeviceEvent> {
  return authedRequest<DeviceEvent>(`/api/devices/events/${eventId}/handled/`, { method: "POST", body: { handled } });
}

/** POST /api/devices/<id>/usb/restore/ — give a PC its USB back after an automatic read-only lock. */
export function restoreUsb(deviceId: number): Promise<Device> {
  return authedRequest<Device>(`/api/devices/${deviceId}/usb/restore/`, { method: "POST", body: {} });
}

/** One change in a member's work day (from the widget's Start / Break / Resume / End). */
export interface WorkLogEntry {
  id: number;
  device_id: number;
  hostname: string;
  member_id: number | null;
  member_name: string | null;
  /** "working" = started or back from a break; "on_break"; "ended" = ended the day. */
  state: "working" | "on_break" | "ended";
  previous_state: string;
  at: string;
  /** The break reason the member picked (only on "on_break"). */
  reason: string;
  /** Optional message the member added to the break. */
  note?: string;
  /** Breaks only: "pending" until the owner approves or denies; "" for other changes. */
  approval?: "" | "pending" | "approved" | "denied";
  decided_at?: string | null;
  decision_note?: string;
  /** The day moved here from this PC: the line reads "Moved to <hostname>". "" on every other change. */
  moved_from?: string;
  /** The old PC had gone quiet before the move: when it was last heard from (its time stops there). */
  left_off_at?: string | null;
}

/**
 * FIX-011: one person's figures for the day, counted on the server and split at midnight the same way reports are
 * (a 22:00–02:00 shift is 2 h on each day). `key` is "m<member id>" or "d<device id>" (no member).
 */
export interface WorkDayTotal {
  key: string;
  member_id: number | null;
  device_id: number;
  worked_seconds: number;
  break_seconds: number;
  /** Breaks that began this day. */
  breaks: number;
  /** Started a shift this day (the "day worked" rule). */
  logged_in: boolean;
  /** A stretch began this day that couldn't be counted: a forgotten log-out. */
  open_ended: boolean;
  /** The day's last stretch runs on past midnight into the next day. */
  continues: boolean;
  /** The id of yesterday's change (in `carried_in`) whose stretch was still running at midnight, or null. */
  carried_in: number | null;
}

export interface WorkLog {
  /** yyyy-mm-dd (server-local day). */
  date: string;
  entries: WorkLogEntry[];
  /** FIX-011: yesterday's changes whose stretch was still running at this day's midnight (absent on older APIs). */
  carried_in?: WorkLogEntry[];
  /** FIX-011: one row per person with the day's figures (absent on older APIs). */
  totals?: WorkDayTotal[];
}

/**
 * The longest note the decision endpoint accepts: BreakDecisionSerializer.note max_length, which DRF checks in
 * Unicode code points after trimming. Count with breakNoteLength(), not `.length` (an emoji is 2 UTF-16 units).
 */
export const BREAK_NOTE_MAX = 280;

/** A decision note's length as the API counts it: code points, after trimming. */
export function breakNoteLength(note: string): number {
  return [...note.trim()].length;
}

/** POST /api/devices/work-log/<id>/decision/ — approve or deny a break; the member is told in their widget. */
export function decideBreak(id: number, decision: "approved" | "denied", note = ""): Promise<WorkLogEntry> {
  return authedRequest<WorkLogEntry>(`/api/devices/work-log/${id}/decision/`, {
    method: "POST",
    body: { decision, note },
  });
}

/** GET /api/devices/work-log/?date=&member= — one day's start/break/end changes, oldest first. */
export function getWorkLog(params: { date?: string; member?: number } = {}, signal?: AbortSignal): Promise<WorkLog> {
  return authedRequest<WorkLog>("/api/devices/work-log/", { query: { date: params.date, member: params.member }, signal });
}

export interface AlertEmailResult {
  sent_to: string;
  sent_at: string;
}

/**
 * POST /api/devices/events/<id>/email/ — email the member whose PC raised this alert,
 * with the dashboard's wording. Once per alert (409 if already sent; 400 if the PC has no member).
 */
export function emailAlert(eventId: number, wording: { label: string; suggested: string }): Promise<AlertEmailResult> {
  return authedRequest<AlertEmailResult>(`/api/devices/events/${eventId}/email/`, { method: "POST", body: wording });
}

/**
 * GET /api/devices/ — the owner's PCs in use, with online status. Removed PCs are left out (FIX-005) unless
 * `includeRemoved`: history views (Alerts, Overview, feature pages) pass it so an old alert from a removed PC can
 * still name its person and the PC filter can show "(removed)". Team & devices uses the default list.
 */
export function listDevices(signal?: AbortSignal, { includeRemoved = false }: { includeRemoved?: boolean } = {}): Promise<Device[]> {
  return authedRequest<Device[]>("/api/devices/", { query: { include_revoked: includeRemoved ? 1 : undefined }, signal });
}

/** GET /api/devices/members/ — the people the owner has added, newest first. */
export async function listMembers(signal?: AbortSignal): Promise<Member[]> {
  const members = await authedRequest<Member[]>("/api/devices/members/", { signal });
  rememberPictures(members);
  return members;
}

export type MemberRole =
  | "developer"
  | "designer"
  | "sales"
  | "support"
  | "accounts"
  | "operations"
  | "management"
  | "other";

export const MEMBER_ROLES: ReadonlyArray<{ value: MemberRole; label: string }> = [
  { value: "developer", label: "Developer" },
  { value: "designer", label: "Designer" },
  { value: "sales", label: "Sales" },
  { value: "support", label: "Support" },
  { value: "accounts", label: "Accounts" },
  { value: "operations", label: "Operations" },
  { value: "management", label: "Management" },
  { value: "other", label: "Other" },
];

/** PATCH /api/devices/members/<id>/ — set what a member does ("" clears it). */
export function setMemberRole(memberId: number, role: MemberRole | ""): Promise<Member> {
  return authedRequest<Member>(`/api/devices/members/${memberId}/`, { method: "PATCH", body: { role } });
}

/** A small, kind tag from a member's week (FR-19), shown only to the owner. */
export interface MemberTag {
  key: string;
  emoji: string;
  label: string;
  /** Plain words: why they got it. */
  why: string;
}

/** GET /api/devices/members/tags/ — {member id: tags} (at most three each). */
export function getMemberTags(signal?: AbortSignal): Promise<Record<string, MemberTag[]>> {
  return authedRequest<Record<string, MemberTag[]>>("/api/devices/members/tags/", { signal });
}

/** POST /api/devices/members/ — add a member; the response carries their id code. */
export function createMember(payload: MemberPayload): Promise<Member> {
  return authedRequest<Member>("/api/devices/members/", { method: "POST", body: payload });
}

/**
 * POST /api/devices/members/<id>/rotate-id/ — issue a fresh id code for this member. With `email`
 * (default true) the invite email is sent again with the new ID.
 */
export function rotateMemberId(id: number, options: { email?: boolean } = {}): Promise<Member> {
  return authedRequest<Member>(`/api/devices/members/${id}/rotate-id/`, {
    method: "POST",
    body: { email: options.email ?? true },
  });
}

/** POST /api/devices/members/<id>/deactivate/ — stop this member enrolling or checking in. */
export function deactivateMember(id: number): Promise<Member> {
  return authedRequest<Member>(`/api/devices/members/${id}/deactivate/`, { method: "POST", body: {} });
}

/**
 * A short note the owner sends to a member. It is delivered to that member's
 * Zinwe widget on their PC (the agent picks it up on its next check-in).
 */
export interface Message {
  id: number;
  /** "owner" = an admin message/alert; "member" = the member's reply. */
  sender: "owner" | "member";
  /** Admin lines: how it went out. "email" lines never reach the PC (no receipts). */
  channel?: MessageChannel;
  title: string;
  body: string | null;
  /** "info" | "warning" | "critical"; unknown values render as info. */
  severity: EventSeverity;
  created_at: string;
  /** Seen state per side (for "delivered"/unread). */
  read_by_owner: boolean;
  read_by_member: boolean;
  /** Admin lines: when the member's PC first pulled it (null = not on their PC yet). */
  delivered_at?: string | null;
  /** Admin lines: when the member opened it in the widget's chat (null on older rows). */
  read_by_member_at?: string | null;
  /** FR-20: "task" lines carry the task (its card in the thread); "chat" otherwise. */
  kind?: "chat" | "task";
  /** The task on a "task" line (null on chat lines). */
  task?: Task | null;
  /** v1.3.5 (F-17): the task this line is about (its thread); null or missing on ordinary lines. */
  about_task?: number | null;
  /** v1.3.5 (F-17): the member's own to-do this line is about; null or missing otherwise. */
  about_todo?: number | null;
}

/**
 * GET /api/devices/members/<memberPk>/messages/ — the full two-way conversation
 * with one member, newest first. Fetching it marks the member's replies as read,
 * so the member's `unread` count clears.
 */
export function getMemberThread(memberPk: number, signal?: AbortSignal): Promise<Message[]> {
  return authedRequest<Message[]>(`/api/devices/members/${memberPk}/messages/`, { signal });
}

export const MESSAGE_TITLE_MAX = 120;
export const MESSAGE_BODY_MAX = 2000;

/** Where a note goes: the Zinwe widget on their PC, the widget plus their inbox, or their inbox only. */
export type MessageChannel = "chat" | "chat_email" | "email";

/** What the owner types when sending a message. */
export interface MessagePayload {
  title: string;
  body?: string;
  severity?: EventSeverity;
  /** Defaults to "chat" (widget only). */
  channel?: MessageChannel;
  /** The alert this note is about: sending it marks that alert handled. */
  event_id?: number;
  /** v1.3.5 (F-17): said about one of the member's tasks (its thread). At most one of the two. */
  about_task?: number;
  /** v1.3.5 (F-17): said about one of the member's own to-dos (its thread). */
  about_todo?: number;
}

export type MessageField = "title" | "body" | "severity";

/**
 * POST /api/devices/members/<memberPk>/message/ — send a short message to this
 * member; it appears in their Zinwe widget. `memberPk` is the Member row's id
 * (not their "ZM-…" connect code).
 */
export function sendMessage(memberPk: number, payload: MessagePayload): Promise<Message> {
  return authedRequest<Message>(`/api/devices/members/${memberPk}/message/`, { method: "POST", body: payload });
}

/** GET /api/devices/policy/ — the rules every PC follows (all feature blocks). */
export async function getPolicy(signal?: AbortSignal): Promise<Policy> {
  return normalizePolicy(await authedRequest<Policy>("/api/devices/policy/", { signal }));
}

/**
 * PUT /api/devices/policy/ — change the rules. The body carries only the
 * block(s) that changed (partial, multi-block); the version goes up by one only
 * when something actually changed.
 */
export async function updatePolicy(patch: PolicyUpdate): Promise<Policy> {
  return normalizePolicy(await authedRequest<Policy>("/api/devices/policy/", { method: "PUT", body: patch }));
}

/** GET /api/devices/lists/ — the site lists with their true sizes (403 plan_feature without the web module). */
export function getBlockLists(signal?: AbortSignal): Promise<BlockLists> {
  return authedRequest<BlockLists>("/api/devices/lists/", { signal });
}

/** Largest page of a list; "Tick all" and "Untick all" ask for the whole list in one go. */
export const BLOCK_LIST_MAX_PAGE = 5000;

/** GET /api/devices/lists/<key>/sites/ — one page of a list, optionally searched. Adult names come masked. */
export function getBlockListSites(
  key: WebCategory,
  params: { q?: string; page?: number; pageSize?: number },
  signal?: AbortSignal,
): Promise<BlockListSites> {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("page_size", String(params.pageSize));
  const qs = query.toString();
  return authedRequest<BlockListSites>(`/api/devices/lists/${key}/sites/${qs ? `?${qs}` : ""}`, { signal });
}

export const EVENTS_DEFAULT_LIMIT = 50;
export const EVENTS_MAX_LIMIT = 200;

export interface EventFeedParams {
  device?: number;
  member?: number;
  types?: readonly string[];
  /** 1..200 (EVENTS_MAX_LIMIT); the server default is 50. There is no offset: "show older" asks for more. */
  limit?: number;
  /** "alert" = rule confirmations left out on the server, so they can't use up the limit. */
  kind?: "alert" | "confirmation";
  /** true = only handled, false = only not handled yet; omitted = both. */
  handled?: boolean;
}

/**
 * GET /api/devices/events/ — newest first, the owner's PCs only. Optionally one PC, one team member's
 * PCs, only some event types (a feature page asks for its own, so other alerts can't crowd it out),
 * only alerts or only confirmations, and/or only handled / not-handled ones.
 */
export function listEvents(params: EventFeedParams = {}, signal?: AbortSignal): Promise<DeviceEvent[]> {
  return authedRequest<DeviceEvent[]>("/api/devices/events/", {
    query: {
      device: params.device,
      member: params.member,
      types: params.types?.length ? params.types.join(",") : undefined,
      limit: params.limit,
      kind: params.kind,
      handled: params.handled === undefined ? undefined : String(params.handled),
    },
    signal,
  });
}

/** Account-wide alert totals (rule confirmations excluded), over the plan's history window. */
export interface EventCounts {
  /** Every alert. */
  alerts: number;
  /** Alerts nobody has marked handled yet (any priority, "For info" included). */
  unhandled: number;
  /** "Needs attention" alerts nobody has handled yet. */
  critical_unhandled: number;
}

/** GET /api/devices/events/counts/ — counted on the server, so they don't stop at the feed's limit. */
export function getEventCounts(signal?: AbortSignal): Promise<EventCounts> {
  return authedRequest<EventCounts>("/api/devices/events/counts/", { signal });
}

// ---------------------------------------------------------------------------
// Usage metrics (for the feature-page charts)
// ---------------------------------------------------------------------------

/**
 * Metric categories the agent reports. The feature pages chart these; the list
 * is open-ended, so an unknown category is tolerated (it simply has no label).
 */
export type MetricCategory =
  | "web.domain"
  | "app.foreground"
  | "transfer.usb"
  | "transfer.lan"
  | "transfer.email"
  | "remote.tool"
  | "remote.detected"
  | (string & {});

/** One category's totals over the requested window. */
export interface MetricCategoryTotal {
  category: string;
  total_count: number;
  total_bytes: number;
  total_seconds: number;
}

/**
 * One (hour bucket, category) point. The backend collapses per-key detail and
 * sums across the owner's PCs, so this is a combined series ready to plot.
 */
export interface MetricPoint {
  bucket_start: string;
  category: string;
  count: number;
  bytes: number;
  seconds: number;
}

/** GET /api/devices/metrics/ response: per-category totals + an oldest-first series. */
export interface Metrics {
  categories: MetricCategoryTotal[];
  series: MetricPoint[];
}

export interface MetricsQuery {
  /** Scope to one member's PC(s). */
  member?: number;
  /** Scope to one PC. */
  device?: number;
  /** 1..31; the backend defaults to 7 when omitted. */
  days?: number;
  /** Scope to a single metric category. */
  category?: MetricCategory;
}

/**
 * GET /api/devices/metrics/ — usage for the charts, the owner's own PCs only.
 * The backend returns empty arrays (never an error) when there's no data yet.
 */
export function getMetrics(params: MetricsQuery = {}, signal?: AbortSignal): Promise<Metrics> {
  return authedRequest<Metrics>("/api/devices/metrics/", {
    query: { member: params.member, device: params.device, days: params.days, category: params.category },
    signal,
  });
}

/** One item in a per-key breakdown: a domain or app, with its summed usage. */
export interface MetricTopItem {
  /** The domain (for web.domain) or app process name (for app.foreground). */
  key: string;
  count: number;
  bytes: number;
  seconds: number;
}

/** GET /api/devices/metrics/top/ response: the ranked per-key breakdown for one category. */
export interface MetricsTop {
  category: string;
  items: MetricTopItem[];
}

export interface MetricsTopQuery extends MetricsQuery {
  /** The category to break down, e.g. "web.domain" or "app.foreground" (required). */
  category: MetricCategory;
  /** Max rows to return (1..100; backend default 20). */
  limit?: number;
}

/**
 * GET /api/devices/metrics/top/ — the per-domain / per-app breakdown within one
 * category (the detail the chart totals collapse away). Owner-scoped: a company
 * only ever sees its own PCs. Returns an empty list when there's nothing yet.
 */
export function getTopMetrics(params: MetricsTopQuery, signal?: AbortSignal): Promise<MetricsTop> {
  return authedRequest<MetricsTop>("/api/devices/metrics/top/", {
    query: {
      category: params.category,
      member: params.member,
      device: params.device,
      days: params.days,
      limit: params.limit,
    },
    signal,
  });
}

/** One thing new for the owner (FR-15), shown as a browser notification. `link` is a dashboard path. */
export interface OwnerFeedItem {
  id: string;
  /** "task": a member asked for help on a task, or marked one done (FR-20). */
  kind: "chat" | "alert" | "approval" | "task";
  title: string;
  body: string;
  at: string;
  link: string;
  severity?: "info" | "warning" | "critical";
}

export interface OwnerFeed {
  /** Server time: pass it back as the next `since`. */
  now: string;
  items: OwnerFeedItem[];
}

/** GET notifications/?since= — what's new since then (nothing on the first call, without `since`). */
export function getOwnerFeed(since: string | null, signal?: AbortSignal): Promise<OwnerFeed> {
  const query = since ? `?since=${encodeURIComponent(since)}` : "";
  return authedRequest<OwnerFeed>(`/api/devices/notifications/${query}`, { signal });
}

export type AlertNotifyLevel = "all" | "warning" | "critical" | "off";

/** What the owner is notified about in the browser (FR-15). */
export interface NotificationPrefs {
  chat: boolean;
  alerts: AlertNotifyLevel;
  approvals: boolean;
  /** FR-20: a member needs help with a task, or finished one (on by default). */
  tasks?: boolean;
}

export function getNotificationPrefs(signal?: AbortSignal): Promise<NotificationPrefs> {
  return authedRequest<NotificationPrefs>("/api/devices/notifications/settings/", { signal });
}

export function saveNotificationPrefs(prefs: Partial<NotificationPrefs>): Promise<NotificationPrefs> {
  return authedRequest<NotificationPrefs>("/api/devices/notifications/settings/", { method: "PATCH", body: prefs });
}

/** Web push (FR-15): off until the server has its keys. `public_key` is what a browser subscribes with. */
export interface PushStatus {
  enabled: boolean;
  public_key: string;
}

export function getPushStatus(signal?: AbortSignal): Promise<PushStatus> {
  return authedRequest<PushStatus>("/api/devices/notifications/push/", { signal });
}

/** POST notifications/push/subscribe/ — this browser, as PushSubscription.toJSON() gives it. Safe to repeat. */
export function savePushSubscription(subscription: PushSubscriptionJSON): Promise<{ subscribed: boolean }> {
  const { endpoint, keys } = subscription;
  return authedRequest<{ subscribed: boolean }>("/api/devices/notifications/push/subscribe/", {
    method: "POST",
    body: { endpoint, keys },
  });
}

export function removePushSubscription(endpoint: string, signal?: AbortSignal): Promise<{ subscribed: boolean }> {
  return authedRequest<{ subscribed: boolean }>("/api/devices/notifications/push/unsubscribe/", {
    method: "POST",
    body: { endpoint },
    signal,
  });
}

/** One person's row in a report (FR-17, FR-22). Seconds are whole seconds. */
export interface ReportPerson {
  member_id: number | null;
  name: string;
  days_worked: number;
  worked_seconds: number;
  break_seconds: number;
  breaks: number;
  logouts: number;
  /** Breaks and log-outs still waiting for the owner's OK. */
  to_review: number;
  alerts: number;
  /** Time an app was in front while the PC was in use (Zinwe app 1.1.1+). */
  active_seconds: number;
  /** Internet data sent and received. */
  data_bytes: number;
  /** Usual (average) first log-in and last log-out, in minutes after midnight; null when none. */
  first_in: number | null;
  last_out: number | null;
}

/** One day of the period: the team's (or the person's) totals that day. */
export interface ReportDay {
  date: string;
  worked_seconds: number;
  break_seconds: number;
  breaks: number;
  alerts: number;
  active_seconds: number;
  data_bytes: number;
  /** How many people worked that day. */
  people: number;
  /** One person's report only: when they started and finished (minutes after midnight). */
  first_in: number | null;
  last_out: number | null;
  /** Team report only: each person's numbers that day, most worked first (the chart's bars and hover detail). */
  by_person?: ReportDayPerson[];
}

/** One person on one day of the team report. */
export interface ReportDayPerson {
  /** "m12" for a team member, "d5" for a PC that isn't linked to anyone. */
  key: string;
  member_id: number | null;
  name: string;
  worked_seconds: number;
  break_seconds: number;
  breaks: number;
  active_seconds: number;
  data_bytes: number;
  alerts: number;
  first_in: number | null;
  last_out: number | null;
}

export interface ReportTotals {
  worked_seconds: number;
  break_seconds: number;
  breaks: number;
  logouts: number;
  to_review: number;
  alerts: number;
  active_seconds: number;
  data_bytes: number;
  alerts_all: number;
  people_worked: number;
  /** Days worked, added up over everyone (for "average a person-day"). */
  person_days: number;
}

export interface TeamReport {
  /** The period actually shown (clamped to today and the plan's history). */
  from: string;
  to: string;
  days: number;
  /** Set when the report is about one person. */
  member: { id: number; name: string; email: string; role: string } | null;
  people: ReportPerson[];
  /** Active members with nothing in the period (team report only). */
  no_activity: string[];
  totals: ReportTotals;
  daily: ReportDay[];
  top_apps: MetricTopItem[];
  top_sites: MetricTopItem[];
  /** Sites that used the most internet data (bytes). */
  top_data: (MetricTopItem & { bytes: number })[];
  /** One person's report: each day they have something recorded. */
  person_days?: ReportDay[];
}

function reportQuery(from: string, to: string, member?: number | null): string {
  const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return member ? `${q}&member=${member}` : q;
}

/** GET reports/?from=&to=[&member=] — the report for that period (both days included), team or one person. */
export function getReport(from: string, to: string, signal?: AbortSignal, member?: number | null): Promise<TeamReport> {
  return authedRequest<TeamReport>(`/api/devices/reports/?${reportQuery(from, to, member)}`, { signal });
}

/** Download the same report as CSV (Excel / Google Sheets) or PDF (reports_pro). */
export function downloadReport(from: string, to: string, member?: number | null, format: "csv" | "pdf" = "csv"): Promise<void> {
  return authedDownload(
    `/api/devices/reports/download/?${reportQuery(from, to, member)}&file=${format}`,
    `Zinwe-report-${from}-to-${to}.${format}`,
  );
}

export type ReportDeliveryStatus = "sent" | "partial" | "failed" | "skipped";

/** One report that went out by email (the "Sent" list). */
export interface ReportDelivery {
  id: number;
  schedule: number | null;
  member_name: string | null;
  period_from: string;
  period_to: string;
  recipients: string[];
  status: ReportDeliveryStatus;
  detail: string;
  created_at: string;
}

export interface ReportSendInput {
  from: string;
  to: string;
  member?: number | null;
  send_to_owner: boolean;
  /** Each person gets only their own report. */
  send_to_members: boolean;
  emails: string[];
  include_csv: boolean;
}

/** POST reports/send/ — email the report now. */
export function sendReport(input: ReportSendInput): Promise<ReportDelivery> {
  return authedRequest<ReportDelivery>("/api/devices/reports/send/", { method: "POST", body: input });
}

export type ReportFrequency = "daily" | "weekly" | "monthly" | "custom";

/** What a daily report covers (F-10): the day it is sent, or the day before. */
export type ReportCovers = "today" | "yesterday";

export interface ReportSchedule {
  id: number;
  /** Null = the whole team. */
  member: number | null;
  member_name: string | null;
  frequency: ReportFrequency;
  /** Weekly: 0 = Monday. */
  weekday: number;
  /** Monthly: 1-28. */
  month_day: number;
  /** Custom: every N days (2-90); 0 = once, on `start_date` (v1.3.3, F-09). */
  every_days: number;
  /** Custom ("Pick dates"): the first send day, yyyy-mm-dd (v1.3.3, F-09). Older servers leave it out. */
  start_date?: string | null;
  /** Daily only: the report covers today's or yesterday's work (v1.3.3, F-10). Older servers leave it out. */
  covers?: ReportCovers;
  /** Local hour, 0-23. */
  send_hour: number;
  send_to_owner: boolean;
  send_to_members: boolean;
  extra_emails: string[];
  include_csv: boolean;
  is_active: boolean;
  /** "Every Monday around 9 AM, for the week before". */
  description: string;
  next_run_at: string | null;
  last_sent_at: string | null;
  last_status: string;
  created_at: string;
}

export type ReportScheduleInput = Omit<
  ReportSchedule,
  "id" | "member_name" | "description" | "next_run_at" | "last_sent_at" | "last_status" | "created_at"
>;

export function getReportSchedules(signal?: AbortSignal): Promise<ReportSchedule[]> {
  return authedRequest<ReportSchedule[]>("/api/devices/reports/schedules/", { signal });
}

export function createReportSchedule(input: ReportScheduleInput): Promise<ReportSchedule> {
  return authedRequest<ReportSchedule>("/api/devices/reports/schedules/", { method: "POST", body: input });
}

export function updateReportSchedule(id: number, input: Partial<ReportScheduleInput>): Promise<ReportSchedule> {
  return authedRequest<ReportSchedule>(`/api/devices/reports/schedules/${id}/`, { method: "PATCH", body: input });
}

export function deleteReportSchedule(id: number): Promise<void> {
  return authedRequest<void>(`/api/devices/reports/schedules/${id}/`, { method: "DELETE" });
}

/** Send a schedule's latest period now (to try it). */
export function sendReportScheduleNow(id: number): Promise<ReportDelivery> {
  return authedRequest<ReportDelivery>(`/api/devices/reports/schedules/${id}/send-now/`, { method: "POST", body: {} });
}

export function getReportDeliveries(signal?: AbortSignal): Promise<ReportDelivery[]> {
  return authedRequest<ReportDelivery[]>("/api/devices/reports/deliveries/", { signal });
}
