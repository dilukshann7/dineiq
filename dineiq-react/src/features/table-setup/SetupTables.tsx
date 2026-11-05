import { Button } from "@/components/ui/button";
import { validPolygon } from "@/lib/monitoring/validation";
import type { MonitoringClient } from "@/lib/monitoring/client";
import type {
  ConfiguredTable,
  FrozenFrame,
  Layout,
} from "@/lib/monitoring/types";
import { SetupCanvas } from "./SetupCanvas";
import { SetupTableList } from "./SetupTableList";
import { useTableSetup } from "./useTableSetup";

export function SetupTables({
  frame,
  layout,
  client,
  onSave,
  onCancel,
}: {
  frame: FrozenFrame;
  layout: Layout | null;
  client: Pick<MonitoringClient, "suggestLayout">;
  onSave: (tables: ConfiguredTable[]) => Promise<void>;
  onCancel: () => void;
}) {
  const {
    tables,
    setTables,
    selected,
    setSelected,
    mode,
    points,
    setPoints,
    cursor,
    saving,
    error,
    detecting,
    warnings,
    detectedSummary,
    busy,
    selectedTable,
    canSave,
    canSaveWithSeats,
    tablesWithoutSeats,
    tablesWithSeats,
    chooseMode,
    clickFrame,
    keyFrame,
    finish,
    save,
    detectAutomatically,
  } = useTableSetup({ frame, layout, client, onSave });
  const saveControls = (
    <div className="my-4 flex flex-wrap items-center gap-3">
      <Button
        disabled={busy || !canSave || points.length > 0}
        onClick={() => void save()}
      >
        {saving ? "Saving setup…" : "Save and replace table setup"}
      </Button>
      {canSaveWithSeats && (
        <Button
          disabled={busy || points.length > 0}
          onClick={() => void save(true)}
        >
          Save only {tablesWithSeats.length} tables with seats
        </Button>
      )}
      <span className="text-[13px] text-muted-foreground">
        Saving replaces the previous table setup and confirms the camera position.
        Frames are not saved.
      </span>
    </div>
  );
  return (
    <section aria-labelledby="setup-title">
      <div className="dashboard-section-header">
        <div>
          <h2 id="setup-title">Manual table adjustments</h2>
          <p>
            Tables update automatically during monitoring. Use this frozen frame
            for optional corrections. Keep stationary background visible outside your regions.
          </p>
        </div>
        <Button variant="ghost" disabled={saving} onClick={onCancel}>
          Cancel setup
        </Button>
      </div>
      <div
        className="my-4 flex flex-wrap items-center gap-3"
        role="group"
        aria-label="Drawing mode"
      >
        <Button disabled={busy} onClick={() => void detectAutomatically()}>
          {detecting
            ? "Detecting tables and seats…"
            : "Auto-detect tables & seats"}
        </Button>
        <Button
          variant={mode === "table" ? "default" : "outline"}
          disabled={busy || tables.length >= 16}
          onClick={() => chooseMode("table")}
        >
          New tabletop
        </Button>
        <Button
          variant={mode === "seat" ? "default" : "outline"}
          disabled={busy || !selectedTable || selectedTable.seats.length >= 32}
          onClick={() => chooseMode("seat")}
        >
          Add seat
        </Button>
        <Button
          variant={mode === "redraw" ? "default" : "outline"}
          disabled={busy || !selectedTable}
          onClick={() => chooseMode("redraw")}
        >
          Redraw tabletop
        </Button>
      </div>
      {detectedSummary && (
        <p className="text-sm font-medium" role="status">
          {detectedSummary}
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="my-3 list-disc space-y-1 pl-5 text-[13px] text-muted-foreground">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      <p className="my-3 text-[13px] text-muted-foreground">
        Automatic detection fills the tabletop outlines and approximate
        seated-person regions. Check the suggested seats before saving; hidden
        chairs and benches may need manual regions. Running detection again
        replaces the outlines shown here.
      </p>
      {tablesWithoutSeats.length > 0 && (
        <p className="my-3 text-[13px] text-muted-foreground" role="status">
          Missing seats: {tablesWithoutSeats.map((table) => table.name).join(", ")}.
          Add seats to include these tables, or save only the tables with seats.
          Skipped tables will not appear in the saved layout.
        </p>
      )}
      {tables.some((table) => !table.name.trim()) && (
        <p className="my-3 text-[13px] text-muted-foreground" role="status">
          Enter a name for every table you want to save.
        </p>
      )}
      {error && (
        <p className="my-3 rounded-md border border-border bg-muted px-4 py-3 text-[13px]" role="alert">
          {error}
        </p>
      )}
      {points.length > 0 && (
        <p className="my-3 text-[13px] text-muted-foreground" role="status">
          Finish the current polygon or press Escape before saving.
        </p>
      )}
      {saveControls}
      <p className="text-[13px] text-muted-foreground" id="draw-instructions">
        {mode === "seat"
          ? "Outline the area a seated person’s visible body should fill, one region per seat. Avoid aisles and neighboring seats."
          : "Click corners around the tabletop surface, in order. Use a convex shape without crossing edges."}{" "}
        Choose Finish polygon when ready. Keyboard: arrows move the cursor,
        Enter adds a corner, Escape clears.
      </p>
      <SetupCanvas
        frame={frame}
        tables={tables}
        selected={selected}
        points={points}
        cursor={cursor}
        busy={busy}
        clickFrame={clickFrame}
        keyFrame={keyFrame}
      />
      <div className="my-4 flex flex-wrap items-center gap-3">
        <Button
          onClick={finish}
          disabled={
            busy ||
            !validPolygon(points) ||
            (mode !== "table" && !selectedTable) ||
            (mode === "seat" && (selectedTable?.seats.length ?? 0) >= 32)
          }
        >
          Finish polygon
        </Button>
        <Button
          variant="outline"
          disabled={busy || !points.length}
          onClick={() => setPoints((previous) => previous.slice(0, -1))}
        >
          Undo corner
        </Button>
        <span className="text-[13px] text-muted-foreground">
          {points.length} corners ·{" "}
          {mode === "seat" ? "Seated-person region" : "Tabletop"}
        </span>
      </div>
      <SetupTableList
        tables={tables}
        selected={selected}
        busy={busy}
        setTables={setTables}
        setSelected={setSelected}
        onChooseMode={chooseMode}
      />
      {saveControls}
    </section>
  );
}
