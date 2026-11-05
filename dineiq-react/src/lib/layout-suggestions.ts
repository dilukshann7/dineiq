import type { ConfiguredTable, Point, Seat } from "./monitoring/types.ts";

export function prepareTableSetupSave(
  tables: ConfiguredTable[],
  skipUnseated = false,
): ConfiguredTable[] {
  const selected = skipUnseated
    ? tables.filter((table) => table.seats.length > 0)
    : tables;
  if (!selected.length)
    throw new Error("Add at least one table with a seat before saving.");
  if (selected.some((table) => !table.name.trim()))
    throw new Error("Enter a name for every table being saved.");
  if (selected.some((table) => !table.seats.length))
    throw new Error(
      "Add seats to every table, or choose Save only tables with seats.",
    );
  return selected;
}

function overlap(first: Point[], second: Point[]): number {
  const signedArea = (points: Point[]) =>
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return sum + point[0] * next[1] - next[0] * point[1];
    }, 0) / 2;
  const cross = (a: Point, b: Point, p: Point) =>
    (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const orientation = Math.sign(signedArea(second));
  let clipped = [...first];
  for (let edge = 0; edge < second.length && clipped.length; edge++) {
    const a = second[edge],
      b = second[(edge + 1) % second.length];
    const input = clipped;
    clipped = [];
    for (let index = 0; index < input.length; index++) {
      const previous = input[(index + input.length - 1) % input.length],
        current = input[index];
      const previousInside = orientation * cross(a, b, previous) >= -1e-10;
      const currentInside = orientation * cross(a, b, current) >= -1e-10;
      if (previousInside !== currentInside) {
        const dx = current[0] - previous[0],
          dy = current[1] - previous[1];
        const ex = b[0] - a[0],
          ey = b[1] - a[1];
        const denominator = ex * dy - ey * dx;
        if (Math.abs(denominator) > 1e-12) {
          const fraction =
            (ex * (a[1] - previous[1]) - ey * (a[0] - previous[0])) /
            denominator;
          clipped.push([
            previous[0] + fraction * dx,
            previous[1] + fraction * dy,
          ]);
        }
      }
      if (currentInside) clipped.push(current);
    }
  }
  const intersection = clipped.length < 3 ? 0 : Math.abs(signedArea(clipped));
  return (
    intersection /
    Math.max(
      1e-9,
      Math.abs(signedArea(first)) + Math.abs(signedArea(second)) - intersection,
    )
  );
}

function match<T extends { id: string; polygon: Point[] }>(
  polygon: Point[],
  previous: T[],
  used: Set<string>,
  threshold: number,
): T | undefined {
  const candidates = previous
    .filter((item) => !used.has(item.id))
    .map((item) => ({ item, score: overlap(polygon, item.polygon) }))
    .filter(({ score }) => score >= threshold)
    .sort((a, b) => b.score - a.score);
  if (
    !candidates.length ||
    (candidates.length > 1 && candidates[0].score - candidates[1].score < 0.05)
  )
    return undefined;
  used.add(candidates[0].item.id);
  return candidates[0].item;
}

export function mergeSuggestedTables(
  previous: ConfiguredTable[],
  proposed: ConfiguredTable[],
): ConfiguredTable[] {
  const usedTables = new Set<string>();
  return proposed.map((table) => {
    const existing = match(table.polygon, previous, usedTables, 0.4);
    const usedSeats = new Set<string>();
    const seats: Seat[] = table.seats.map((seat) => {
      const old = match(seat.polygon, existing?.seats ?? [], usedSeats, 0.35);
      return { ...seat, id: old?.id ?? seat.id };
    });
    return {
      ...table,
      id: existing?.id ?? table.id,
      name: existing?.name ?? table.name,
      seats,
    };
  });
}

export function stableTableSuggestions(previous: ConfiguredTable[], proposed: ConfiguredTable[]): boolean {
  if (!previous.length || previous.length !== proposed.length) return false;
  const merged = mergeSuggestedTables(previous, proposed);
  return merged.every(table => {
    const old = previous.find(item => item.id === table.id);
    return old && overlap(old.polygon, table.polygon) >= 0.8
      && old.seats.length === table.seats.length
      && table.seats.every(seat => {
        const before = old.seats.find(item => item.id === seat.id);
        return before && overlap(before.polygon, seat.polygon) >= 0.7;
      });
  });
}
