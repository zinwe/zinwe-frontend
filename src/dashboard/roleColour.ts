// src/dashboard/roleColour.ts
/** One colour per role, the same everywhere: the company's roles sorted A-Z take the chart palette in order. */
export const ROLE_PALETTE = ["#2563A8", "#16A085", "#E0762F", "#B83B6B", "#6D5BC7", "#2E8B57", "#C99A06", "#9C5B2E"] as const;

export function roleColour(role: string, allRoles: readonly string[]): string {
  const names = [...new Set(allRoles.map((r) => r.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const i = names.findIndex((r) => r.localeCompare(role.trim(), undefined, { sensitivity: "base" }) === 0);
  return i < 0 ? "#8A8A8A" : ROLE_PALETTE[i % ROLE_PALETTE.length];
}
