import { mergeSuggestedTables, stableTableSuggestions } from "./layout-suggestions.ts";
import type { MonitoringClient } from "./monitoring/client.ts";
import type { ConfiguredTable, FrozenFrame, Layout } from "./monitoring/types.ts";

export function createAutomaticTableSetup({
  client, capture, onSaved, onError, onStatus,
}: {
  client: Pick<MonitoringClient, "suggestLayout" | "saveLayout" | "layout">;
  capture: () => FrozenFrame;
  onSaved: (layout: Layout) => void;
  onError: (error: Error) => void;
  onStatus: (message: string) => void;
}): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let previous: ConfiguredTable[] = [];
  let confirmations = 0;
  async function detect() {
    try {
      const frame = capture();
      onStatus("Detecting tables and seats automatically…");
      const result = await client.suggestLayout(frame, controller.signal);
      if (controller.signal.aborted) return;
      const tables = result.tables.filter(table => table.seats.length > 0);
      confirmations = stableTableSuggestions(previous, tables) ? confirmations + 1 : 1;
      previous = mergeSuggestedTables(previous, tables);
      if (tables.length && confirmations >= 3) {
        onStatus("Saving detected tables…");
        const saved = await client.saveLayout({
          width: frame.width, height: frame.height, frame: frame.base64,
          tables: previous, expected_revision: 0, expected_position_version: 0,
        }, controller.signal);
        if (!controller.signal.aborted) onSaved(saved);
        return;
      }
      onStatus(tables.length
        ? "Confirming table positions across camera frames…"
        : "Waiting for a clear view of tables and chairs. Keep the camera fixed.");
    } catch (cause) {
      if (controller.signal.aborted) return;
      previous = [];
      confirmations = 0;
      // A concurrent tab may have finished setup. Adopt its layout instead of replacing it.
      try {
        const saved = await client.layout(controller.signal);
        if (controller.signal.aborted) return;
        if (saved) { onSaved(saved); return; }
      } catch { /* The next camera frame retries the connection. */ }
      if (controller.signal.aborted) return;
      onError(cause instanceof Error ? cause : new Error("Automatic table setup failed."));
    }
    if (!controller.signal.aborted) timer = setTimeout(() => void detect(), 1000);
  }
  void detect();
  return () => { controller.abort(); clearTimeout(timer); };
}
