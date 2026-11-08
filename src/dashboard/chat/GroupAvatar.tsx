import type { ReactElement } from "react";
import type { ChatGroup } from "../../lib/api";
import { GROUP_ICON, groupTint, iconKey } from "./groupModel";

export function GroupGlyph({ icon, size = 18 }: { icon: string; size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={GROUP_ICON[iconKey(icon)].d} />
    </svg>
  );
}

/** A group's picture: the people avatar's circle with the group's icon (Rule 2: same Avatar circle). */
export function GroupAvatar({ group, size }: { group: Pick<ChatGroup, "id" | "icon">; size: number }): ReactElement {
  return (
    <span
      aria-hidden="true"
      className="cv-gav"
      style={{ width: size, height: size, borderRadius: "50%", background: groupTint(group), color: "#404040", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}
    >
      <GroupGlyph icon={group.icon} size={Math.round(size * 0.47)} />
    </span>
  );
}

/** The Reports tile's picture: a flag on red. */
export function ReportsAvatar({ size }: { size: number }): ReactElement {
  return (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: "50%", background: "#FBE9E5", color: "#C0331C", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
      <svg width={Math.round(size * 0.47)} height={Math.round(size * 0.47)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 22V4M4 4h13l-2 4 2 4H4" />
      </svg>
    </span>
  );
}
