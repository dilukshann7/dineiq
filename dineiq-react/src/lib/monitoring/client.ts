import { apiFetch } from "../auth.ts";
import { validResult } from "../detection/client.ts";
import {
  record,
  identifier,
  credentials,
  isLayout,
  isLayoutSuggestion,
  isTableState,
} from "./validation.ts";
import type {
  Credentials,
  FrozenFrame,
  LayoutSuggestion,
  Layout,
  MonitoringFrame,
  TableState,
  Correction,
  HistoryPage,
} from "./types.ts";

export async function monitoringRequest(
  apiBase: string,
  path: string,
  options: RequestInit = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await apiFetch(
      `${apiBase.replace(/\/$/, "")}/monitoring${path}`,
      {
        ...options,
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)])
          : AbortSignal.timeout(20_000),
      },
    );
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error(
      "Monitoring could not connect. Check the backend, then retry.",
    );
  }
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      record(result) && typeof result.detail === "string"
        ? result.detail
        : "Monitoring request failed. Please retry.",
    );
  return result;
}

function jsonBody(data: unknown): RequestInit {
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
}

export function createMonitoringClient(apiBase: string) {
  let lifecycle: Promise<void> = Promise.resolve();
  let active: { credentials: Credentials; signal: AbortSignal } | null = null;
  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = lifecycle.then(operation);
    lifecycle = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async function close(id: string) {
    await monitoringRequest(apiBase, `/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
      keepalive: true,
    });
    if (active?.credentials.session_id === id) active = null;
  }
  return {
    async suggestLayout(
      frame: FrozenFrame,
      signal: AbortSignal,
    ): Promise<LayoutSuggestion> {
      const bytes = Uint8Array.from(atob(frame.base64), (character) =>
        character.charCodeAt(0),
      );
      const value = await monitoringRequest(apiBase, "/suggestions", {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: new Blob([bytes], { type: "image/jpeg" }),
        signal,
      });
      if (
        !isLayoutSuggestion(value) ||
        value.width !== frame.width ||
        value.height !== frame.height
      )
        throw new Error(
          "Automatic setup returned invalid or mismatched frame dimensions. Please retry.",
        );
      return value;
    },
    async layout(signal?: AbortSignal): Promise<Layout | null> {
      const value = await monitoringRequest(apiBase, "/layout", { signal });
      if (value !== null && !isLayout(value))
        throw new Error("Invalid saved table layout.");
      return value;
    },
    async saveLayout(
      layout: Pick<Layout, "width" | "height" | "tables"> & {
        expected_revision: number;
        expected_position_version?: number;
        frame: string;
      },
      signal?: AbortSignal,
    ): Promise<Layout> {
      const value = await monitoringRequest(apiBase, "/layout", {
        method: "PUT",
        ...jsonBody(layout),
        signal,
      });
      if (!isLayout(value)) throw new Error("Invalid saved table layout.");
      return value;
    },
    async start(
      signal: AbortSignal,
      expectedRevision?: number,
    ): Promise<Credentials> {
      return serialize(async () => {
        if (signal.aborted)
          throw new DOMException("Capture startup canceled", "AbortError");
        if (active?.signal.aborted) await close(active.credentials.session_id);
        const value = await monitoringRequest(apiBase, "/sessions", {
          method: "POST",
          ...jsonBody({ expected_revision: expectedRevision }),
        });
        if (!credentials(value))
          throw new Error("Invalid monitoring session response.");
        active = { credentials: value, signal };
        return value;
      });
    },
    async stop(id: string): Promise<void> {
      await serialize(() => close(id));
    },
    async frame(
      session: Credentials,
      frame: Blob,
      signal: AbortSignal,
    ): Promise<MonitoringFrame> {
      const query = new URLSearchParams({
        sequence: String(session.sequence),
        token: session.token,
      });
      const value = await monitoringRequest(
        apiBase,
        `/sessions/${encodeURIComponent(session.session_id)}/frames?${query}`,
        {
          method: "POST",
          headers: { "Content-Type": "image/jpeg" },
          body: frame,
          signal,
        },
      );
      if (
        !record(value) ||
        typeof value.recalibration_required !== "boolean" ||
        (value.layout !== undefined && !isLayout(value.layout)) ||
        (value.verification_passed !== undefined &&
          typeof value.verification_passed !== "boolean") ||
        (value.matching_status !== undefined &&
          !["verified", "verifying", "recalibration_required"].includes(
            value.matching_status as string,
          )) ||
        !Array.isArray(value.tables) ||
        !value.tables.every(isTableState) ||
        !credentials(value) ||
        !validResult(value, true) ||
        value.session_id !== session.session_id ||
        value.sequence !== session.sequence
      )
        throw new Error("Invalid monitoring frame response.");
      return value as MonitoringFrame;
    },
    async states(
      signal?: AbortSignal,
    ): Promise<{ tables: TableState[]; recalibration_required: boolean }> {
      const value = await monitoringRequest(apiBase, "/tables", { signal });
      if (
        !record(value) ||
        !Array.isArray(value.tables) ||
        !value.tables.every(isTableState) ||
        typeof value.recalibration_required !== "boolean"
      )
        throw new Error("Invalid table state response.");
      return value as { tables: TableState[]; recalibration_required: boolean };
    },
    async correct(id: string, action: Correction): Promise<TableState> {
      const value = await monitoringRequest(
        apiBase,
        `/tables/${encodeURIComponent(id)}/correction`,
        {
          method: "POST",
          ...jsonBody({ action }),
        },
      );
      if (!isTableState(value))
        throw new Error("Invalid table correction response.");
      return value;
    },
    async markServed(id: string, visitId: string): Promise<TableState> {
      const value = await monitoringRequest(
        apiBase,
        `/tables/${encodeURIComponent(id)}/service`,
        { method: "POST", ...jsonBody({ visit_id: visitId }) },
      );
      if (!isTableState(value))
        throw new Error("Invalid service confirmation response.");
      return value;
    },
    async acknowledge(alertId: string): Promise<TableState> {
      const value = await monitoringRequest(
        apiBase,
        `/alerts/${encodeURIComponent(alertId)}/acknowledge`,
        { method: "POST", ...jsonBody({}) },
      );
      if (!isTableState(value))
        throw new Error("Invalid alert acknowledgement response.");
      return value;
    },
    async history(before?: number, tableId?: string): Promise<HistoryPage> {
      const params = new URLSearchParams({ limit: "20" });
      if (before !== undefined) params.set("before", String(before));
      if (tableId) params.set("table_id", tableId);
      const value = await monitoringRequest(apiBase, `/history?${params}`);
      if (
        !record(value) ||
        !Array.isArray(value.events) ||
        !(value.next_before === null || Number.isInteger(value.next_before)) ||
        !value.events.every(
          (event) =>
            record(event) &&
            Number.isInteger(event.id) &&
            typeof event.kind === "string" &&
            typeof event.at === "string" &&
            record(event.data) &&
            (event.table_id === null || identifier(event.table_id)),
        )
      )
        throw new Error("Invalid table history response.");
      return value as HistoryPage;
    },
  };
}

export async function readStaffDashboard(
  client: Pick<ReturnType<typeof createMonitoringClient>, "layout" | "states">,
  signal?: AbortSignal,
) {
  const [layout, current] = await Promise.all([
    client.layout(signal),
    client.states(signal),
  ]);
  return { ...current, layout };
}

export type MonitoringClient = ReturnType<typeof createMonitoringClient>;
