import { GROUP_ICONS, type ChatGroup, type GroupIcon } from "../../lib/api";
import { sepLabel } from "../tasks/model";
import { isoDay } from "../tasks/types";
import { clockTime } from "../ui/time";

/** The six group pictures (board DashChat, New group dialog): label and icon path. */
export const GROUP_ICON: Record<GroupIcon, { label: string; d: string }> = {
  design: { label: "Design", d: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" },
  code: { label: "Code", d: "m8 8-4 4 4 4M16 8l4 4-4 4M14 4l-4 16" },
  people: { label: "People", d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" },
  megaphone: { label: "Megaphone", d: "M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1ZM16 8a5 5 0 0 1 0 8" },
  briefcase: { label: "Briefcase", d: "M4 7h16v12H4zM9 7V5h6v2" },
  star: { label: "Star", d: "m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" },
};

export const iconKey = (icon: string): GroupIcon => ((GROUP_ICONS as readonly string[]).includes(icon) ? (icon as GroupIcon) : "people");

/** Which of the six pictures a group's `icon` is (the API stores the SVG path; older samples a key), or null. */
export function iconKeyOf(icon: string): GroupIcon | null {
  if ((GROUP_ICONS as readonly string[]).includes(icon)) return icon as GroupIcon;
  return GROUP_ICONS.find((k) => GROUP_ICON[k].d === icon) ?? null;
}

/** The path to draw: a known picture, any other SVG path the server holds (the demo's own), else "people". */
export function iconPath(icon: string): string {
  const k = iconKeyOf(icon);
  if (k) return GROUP_ICON[k].d;
  return /^[Mm][\d\s.,-]/.test(icon) && icon.length <= 400 ? icon : GROUP_ICON.people.d;
}

/** Group tints, the people avatars' palette (cream, greys). */
const TINT = ["#FDEBDC", "#EEEEEE", "#F5F5F5", "#FFF6EF"] as const;
export const groupTint = (g: Pick<ChatGroup, "id">) => TINT[Math.abs(g.id) % TINT.length];

/** "Emily, Priya and Karan" */
export function nameList(list: readonly string[]): string {
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list.join("");
}

export const firstOf = (name: string) => name.trim().split(/\s+/)[0] || name;

/** "Today, 2:51 PM" */
export function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${sepLabel(isoDay(d))}, ${clockTime(d)}`;
}
