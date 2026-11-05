/**
 * DashTeam: role colours (FR-19) and the drawn avatar library (FR-44).
 *
 * The library is `avatars.json` — 16 calm, flat head-and-shoulders people on a 48 × 48 box. It is THE source of
 * truth: the Windows app embeds a byte-identical copy and the backend knows the keys (z_devices/pictures.py
 * AVATAR_KEYS). Keys never change; art and labels may. Paths use only M L H V C Q A Z and never overlap
 * themselves, so SVG (nonzero) and WPF (EvenOdd) draw them the same. `bg` fills the whole box: clip it to a circle.
 * Initials on the role tint stay the fallback when a person has no picture.
 */
import type { MemberRole } from "../../lib/api";
import library from "./avatars.json";

export interface AvatarArt {
  key: string;
  label: string;
  bg: string;
  /** [path, fill] pairs on the library's 48 × 48 box. */
  paths: ReadonlyArray<readonly [string, string]>;
}

export const AVATAR_VIEWBOX: string = library.viewBox;

export const AVATARS: readonly AvatarArt[] = library.avatars.map((a) => ({
  key: a.key,
  label: a.label,
  bg: a.bg,
  paths: a.paths.map(([d, fill]) => [d, fill] as const),
}));

const BY_KEY = new Map(AVATARS.map((a) => [a.key, a]));

/** The library avatar for a key, or undefined (an unknown key reads as initials). */
export function avatarArt(key: string): AvatarArt | undefined {
  return BY_KEY.get(key);
}

/** [line, avatar tint, avatar ink] per role: black, greys and orange only (v1.3.2); the role name carries it.
 *  The FR-44 faces keep their own colours. The Team card's top line now comes from roleColour (one hue per role). */
export const ROLE_COLORS: Record<MemberRole, readonly [string, string, string]> = {
  developer: ["#404040", "#F5F5F5", "#404040"],
  designer: ["#6B6B6B", "#F5F5F5", "#404040"],
  sales: ["#F26A0A", "#FDEBDC", "#8A3A04"],
  support: ["#6B6B6B", "#F5F5F5", "#404040"],
  accounts: ["#F26A0A", "#FDEBDC", "#8A3A04"],
  operations: ["#6B6B6B", "#F5F5F5", "#404040"],
  management: ["#141210", "#F5F5F5", "#404040"],
  other: ["#D4D4D4", "#F5F5F5", "#6B6B6B"],
};

export function roleColors(role: MemberRole | "" | undefined): readonly [string, string, string] {
  return role ? ROLE_COLORS[role] : ROLE_COLORS.other;
}
