import type { ReactElement, ReactNode } from "react";
import { avStyle } from "./actions";
import { personIn, type Directory } from "./engine";

/** The panel tabs, and the inline cards inside "What's happening". */
export type PanelTab = "overview" | "chat" | "activity";
export type PanelCard = "reply" | "reopen" | "reassign" | "due" | "cancel";
export interface OpenOpts {
  tab?: PanelTab;
  card?: PanelCard | null;
}
/** Toast: a short line, optionally with Undo. */
export type Say = (text: string, undo?: () => void) => void;

/** What a new task starts with (TaskForm / QuickAdd "Open full form" / Duplicate / Chat). Member ids, not keys. */
export interface TaskPrefill {
  title?: string;
  memberIds?: number[];
  groupId?: number | null;
  /** v1.4.1 ("Make a task" from a group line): post the card in this group's chat, though only `memberIds` get the
   *  task (not the whole group). Ignored when `groupId` is set. */
  postIn?: number | null;
  details?: string;
  high?: boolean;
  /** Day offset from today (0 = today). */
  d?: number;
  /** "6:00 PM" or "Any time". */
  time?: string;
  repeat?: "" | "day" | "week" | "month";
  mode?: "all" | "any";
  inOrder?: boolean;
  steps?: Array<{ title: string; ownerId: number | null }>;
}

export function Av({ dir, k, className = "tv-av", children }: { dir: Directory; k: string | null; className?: string; children?: ReactNode }): ReactElement {
  const p = personIn(dir, k);
  return (
    <span className={className} style={avStyle(p)} title={p.name} aria-hidden="true">
      {p.ini}
      {children}
    </span>
  );
}

export function Avs({ dir, keys, max = 3 }: { dir: Directory; keys: readonly string[]; max?: number }): ReactElement {
  return (
    <span className="tv-avs">
      {keys.slice(0, max).map((k) => (
        <Av key={k} dir={dir} k={k} />
      ))}
      {keys.length > max ? <span className="tv-av more">+{keys.length - max}</span> : null}
    </span>
  );
}

type IconProps = { size?: number; sw?: number };
const svg = (size: number, children: ReactNode, sw = 2, fill = false) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
export const IcChat = ({ size = 18, sw = 2 }: IconProps) => svg(size, <path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12Z" />, sw);
export const IcClock = ({ size = 12, sw = 2.2 }: IconProps) => svg(size, <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>, sw);
export const IcFlag = ({ size = 11 }: IconProps) => svg(size, <path d="M5 21V4h11l-1.5 4L16 12H5z" />, 2, true);
export const IcMore = ({ size = 18 }: IconProps) => svg(size, <><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></>, 2, true);
export const IcClose = ({ size = 17, sw = 2.2 }: IconProps) => svg(size, <path d="M6 6l12 12M18 6 6 18" />, sw);
export const IcPlus = ({ size = 13, sw = 2.6 }: IconProps) => svg(size, <path d="M12 5v14M5 12h14" />, sw);
export const IcTick = ({ size = 13, sw = 3 }: IconProps) => svg(size, <path d="M5 12.5 10 17l9-10" />, sw);
export const IcLock = ({ size = 11 }: IconProps) => svg(size, <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>, 2.4);
export const IcPerson = ({ size = 12, sw = 2.2 }: IconProps) => svg(size, <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>, sw);
export const IcGroup = ({ size = 14 }: IconProps) => svg(size, <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" /></>);
export const IcSend = ({ size = 17 }: IconProps) => svg(size, <path d="M5 12h14M13 6l6 6-6 6" />, 2.2);
export const IcChev = ({ size = 12 }: IconProps) => svg(size, <path d="m6 9 6 6 6-6" />, 2.4);
export const IcCal = ({ size = 14 }: IconProps) => svg(size, <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></>);
export const IcRepeat = ({ size = 13 }: IconProps) => svg(size, <path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" />, 2.2);
export const IcSearch = ({ size = 15 }: IconProps) => svg(size, <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);
export const IcSteps = ({ size = 14 }: IconProps) => svg(size, <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />);
export const IcEye = ({ size = 15 }: IconProps) => svg(size, <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>);

