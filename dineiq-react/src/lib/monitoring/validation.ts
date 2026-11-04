import type {
  Point,
  ConfiguredTable,
  Layout,
  LayoutSuggestion,
  TableState,
  Credentials,
} from "./types.ts";

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validPolygon(value: unknown): value is Point[] {
  if (!Array.isArray(value) || value.length < 3 || value.length > 64)
    return false;
  if (
    !value.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        point.every(
          (coordinate) =>
            typeof coordinate === "number" &&
            Number.isFinite(coordinate) &&
            coordinate >= 0 &&
            coordinate <= 1,
        ),
    )
  )
    return false;
  const points = value as Point[];
  if (new Set(points.map((point) => point.join(","))).size !== points.length)
    return false;
  let direction = 0;
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index],
      b = points[(index + 1) % points.length],
      c = points[(index + 2) % points.length];
    area += a[0] * b[1] - b[0] * a[1];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-10) return false;
    if (direction && Math.sign(cross) !== direction) return false;
    direction = Math.sign(cross);
  }
  return Math.abs(area) / 2 >= 0.0001;
}

export const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
const dateOrNull = (value: unknown) =>
  value === null ||
  (typeof value === "string" && Number.isFinite(Date.parse(value)));

export function isLayout(value: unknown): value is Layout {
  if (
    !record(value) ||
    !identifier(value.camera_id) ||
    !Number.isInteger(value.revision) ||
    (value.revision as number) < 1 ||
    !Number.isInteger(value.width) ||
    !Number.isInteger(value.height) ||
    (value.width as number) <= 0 ||
    (value.height as number) <= 0 ||
    typeof value.recalibration_required !== "boolean" ||
    (value.position_version !== undefined &&
      (!Number.isSafeInteger(value.position_version) || (value.position_version as number) < 0)) ||
    (value.matching_status !== undefined &&
      !["verified", "verifying", "recalibration_required"].includes(value.matching_status as string))
  )
    return false;
  return validTables(value.tables, false);
}

function validTables(
  value: unknown,
  allowEmpty: boolean,
): value is ConfiguredTable[] {
  if (
    !Array.isArray(value) ||
    value.length > 16 ||
    (!allowEmpty && value.length < 1)
  )
    return false;
  const ids: string[] = [];
  for (const table of value) {
    if (
      !record(table) ||
      !identifier(table.id) ||
      typeof table.name !== "string" ||
      !table.name.trim() ||
      !validPolygon(table.polygon) ||
      !Array.isArray(table.seats) ||
      (!allowEmpty && table.seats.length < 1) ||
      table.seats.length > 32
    )
      return false;
    ids.push(table.id);
    for (const seat of table.seats) {
      if (!record(seat) || !identifier(seat.id) || !validPolygon(seat.polygon))
        return false;
      ids.push(seat.id);
    }
  }
  return new Set(ids).size === ids.length;
}

export function isLayoutSuggestion(value: unknown): value is LayoutSuggestion {
  return (
    record(value) &&
    Number.isInteger(value.width) &&
    Number.isInteger(value.height) &&
    (value.width as number) > 0 &&
    (value.height as number) > 0 &&
    validTables(value.tables, true) &&
    Array.isArray(value.warnings) &&
    value.warnings.every((item) => typeof item === "string") &&
    Number.isInteger(value.visible_chairs) &&
    (value.visible_chairs as number) >= 0 &&
    Number.isInteger(value.assigned_chairs) &&
    (value.assigned_chairs as number) >= 0 &&
    (value.assigned_chairs as number) <= (value.visible_chairs as number) &&
    value.tables.reduce((count, table) => count + table.seats.length, 0) ===
      value.assigned_chairs
  );
}

export function isTableState(value: unknown): value is TableState {
  if (
    !record(value) ||
    !identifier(value.id) ||
    typeof value.name !== "string" ||
    !Number.isInteger(value.capacity) ||
    (value.capacity as number) < 1 ||
    (value.capacity as number) > 32 ||
    typeof value.valid !== "boolean" ||
    typeof value.manual !== "boolean" ||
    typeof value.reason !== "string" ||
    !Array.isArray(value.evidence) ||
    !value.evidence.every((item) => typeof item === "string") ||
    !dateOrNull(value.observed_at) ||
    !dateOrNull(value.updated_at) ||
    !(value.visit_id === null || identifier(value.visit_id)) ||
    !dateOrNull(value.arrived_at) ||
    !dateOrNull(value.served_at) ||
    !["none", "waiting", "overdue", "served"].includes(
      value.service_status as string,
    ) ||
    !Array.isArray(value.alerts) ||
    !value.alerts.every(
      (alert) =>
        record(alert) &&
        identifier(alert.id) &&
        ["service", "cleaning"].includes(alert.kind as string) &&
        typeof alert.created_at === "string" &&
        dateOrNull(alert.created_at) &&
        dateOrNull(alert.acknowledged_at) &&
        [
          "pending",
          "sending",
          "sent",
          "failed",
          "cancelled",
          "expired",
        ].includes(alert.delivery_status as string) &&
        (alert.last_error === null || typeof alert.last_error === "string"),
    ) ||
    !["unknown", "not_assessed", "needs_cleaning", "looks_clear"].includes(
      value.cleanliness as string,
    )
  )
    return false;
  if (value.visit_id === null) {
    if (
      value.arrived_at !== null ||
      value.served_at !== null ||
      value.service_status !== "none"
    )
      return false;
  } else if (
    value.arrived_at === null ||
    value.service_status === "none" ||
    (value.service_status === "served") !== (value.served_at !== null)
  )
    return false;
  if (!value.valid)
    return (
      value.count === null &&
      value.occupancy === "unknown" &&
      value.cleanliness === "unknown"
    );
  if (
    !Number.isInteger(value.count) ||
    (value.count as number) < 0 ||
    (value.count as number) > (value.capacity as number)
  )
    return false;
  const expected =
    value.count === 0
      ? "empty"
      : value.count === value.capacity
        ? "full"
        : "partial";
  return value.occupancy === expected;
}

export function credentials(value: unknown): value is Credentials {
  return (
    record(value) &&
    identifier(value.session_id) &&
    typeof value.token === "string" &&
    value.token.length > 0 &&
    Number.isInteger(value.sequence) &&
    (value.sequence as number) >= 0
  );
}
