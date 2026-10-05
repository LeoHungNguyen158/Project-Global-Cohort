// Keyboard-friendly ordering: "Move up" / "Move down" buttons instead of drag and drop.

export type Direction = "up" | "down";

/** Returns the new order after moving `id` one step, or null when it cannot move. */
export function moveItem<T extends string>(ids: readonly T[], id: T, direction: Direction): T[] | null {
  const i = ids.indexOf(id);
  if (i < 0) return null;
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= ids.length) return null;
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Rows whose stored position differs from their index in the new order. */
export function positionChanges<T extends { id: string; position: number }>(rows: readonly T[], order: readonly string[]): { id: string; position: number }[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: { id: string; position: number }[] = [];
  order.forEach((id, index) => {
    const row = byId.get(id);
    if (row && row.position !== index) out.push({ id, position: index });
  });
  return out;
}
