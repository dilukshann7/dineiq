import type { DetectionResult } from "../detection/types.ts";

export type Point = [number, number];
export type Seat = { id: string; polygon: Point[] };
export type ConfiguredTable = {
  id: string;
  name: string;
  polygon: Point[];
  seats: Seat[];
};
export type Layout = {
  camera_id: string;
  revision: number;
  position_version?: number;
  matching_status?: "verified" | "verifying" | "recalibration_required";
  matching_message?: string;
  width: number;
  height: number;
  recalibration_required: boolean;
  tables: ConfiguredTable[];
};
export type FrozenFrame = {
  url: string;
  width: number;
  height: number;
  base64: string;
};
export type LayoutSuggestion = {
  width: number;
  height: number;
  tables: ConfiguredTable[];
  warnings: string[];
  visible_chairs: number;
  assigned_chairs: number;
};
export type TableState = {
  id: string;
  name: string;
  count: number | null;
  capacity: number;
  occupancy: "unknown" | "empty" | "partial" | "full";
  cleanliness: "unknown" | "not_assessed" | "needs_cleaning" | "looks_clear";
  manual: boolean;
  valid: boolean;
  reason: string;
  evidence: string[];
  observed_at: string | null;
  updated_at: string | null;
  visit_id: string | null;
  arrived_at: string | null;
  served_at: string | null;
  service_status: "none" | "waiting" | "overdue" | "served";
  alerts: StaffAlert[];
};
export type StaffAlert = {
  id: string;
  kind: "service" | "cleaning";
  created_at: string;
  acknowledged_at: string | null;
  delivery_status:
    "pending" | "sending" | "sent" | "failed" | "cancelled" | "expired";
  last_error: string | null;
};
export type Credentials = {
  session_id: string;
  token: string;
  sequence: number;
  expires_at?: string;
};
export type MonitoringFrame = DetectionResult &
  Credentials & {
    tables: TableState[];
    recalibration_required: boolean;
    matching_status?: "verified" | "verifying" | "recalibration_required";
    verification_passed?: boolean;
    layout?: Layout;
  };
export type HistoryEvent = {
  id: number;
  kind: string;
  table_id: string | null;
  session_id: string | null;
  at: string;
  data: Record<string, unknown>;
  actor?: {
    id: string | null;
    username: string | null;
    display_name: string | null;
    kind: "user" | "system" | "legacy";
  };
};
export type HistoryPage = {
  events: HistoryEvent[];
  next_before: number | null;
};
export type Correction = "looks_clear" | "needs_cleaning" | "automatic";
