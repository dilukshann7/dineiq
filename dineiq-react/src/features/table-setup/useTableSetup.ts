import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  mergeSuggestedTables,
  prepareTableSetupSave,
} from "@/lib/layout-suggestions";
import { pointerToFrame } from "@/lib/monitoring/geometry";
import { validPolygon } from "@/lib/monitoring/validation";
import type { MonitoringClient } from "@/lib/monitoring/client";
import type {
  ConfiguredTable,
  FrozenFrame,
  Layout,
  Point,
  LayoutSuggestion,
} from "@/lib/monitoring/types";

export type DrawingMode = "table" | "seat" | "redraw";
const newId = () => crypto.randomUUID().replaceAll("-", "");

export function useTableSetup({
  frame,
  layout,
  client,
  onSave,
}: {
  frame: FrozenFrame;
  layout: Layout | null;
  client: Pick<MonitoringClient, "suggestLayout">;
  onSave: (tables: ConfiguredTable[]) => Promise<void>;
}) {
  const [tables, setTables] = useState<ConfiguredTable[]>(() =>
    structuredClone(layout?.tables ?? []),
  );
  const [selected, setSelected] = useState(layout?.tables[0]?.id ?? "");
  const [mode, setMode] = useState<DrawingMode>("table");
  const [points, setPoints] = useState<Point[]>([]);
  const [cursor, setCursor] = useState<Point>([0.5, 0.5]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const initialLayout = useRef(layout);
  const detectController = useRef<AbortController | null>(null);
  const [detecting, setDetecting] = useState(!layout);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [detectedSummary, setDetectedSummary] = useState("");
  const busy = saving || detecting;
  const applyDetected = useCallback(
    (result: LayoutSuggestion, previous: ConfiguredTable[]) => {
      setWarnings(result.warnings);
      setDetectedSummary(
        `${result.tables.length} tables · ${result.assigned_chairs} seat regions from ${result.visible_chairs} visible chairs`,
      );
      if (!result.tables.length && previous.length > 0) {
        setError(
          "No new tables detected. Existing regions are unchanged. Capture a clearer frame or draw new regions.",
        );
        return;
      }
      const next = mergeSuggestedTables(previous, result.tables);
      setTables(next);
      setSelected(next[0]?.id ?? "");
      setMode(next.length ? "seat" : "table");
      setPoints([]);
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    detectController.current = controller;
    if (!initialLayout.current) {
      void client
        .suggestLayout(frame, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) applyDetected(result, []);
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted)
            setError(
              cause instanceof Error
                ? cause.message
                : "Automatic setup failed. Draw regions or retry detection.",
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setDetecting(false);
        });
    }
    return () => {
      detectController.current?.abort();
    };
  }, [frame, client, applyDetected]);

  async function detectAutomatically() {
    detectController.current?.abort();
    const controller = new AbortController();
    detectController.current = controller;
    setDetecting(true);
    setError("");
    try {
      const result = await client.suggestLayout(frame, controller.signal);
      if (!controller.signal.aborted) applyDetected(result, tables);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Automatic setup failed. Draw regions or retry detection.",
        );
    } finally {
      if (!controller.signal.aborted) setDetecting(false);
    }
  }
  const selectedTable = tables.find((table) => table.id === selected);
  const canSave =
    tables.length > 0 &&
    tables.every((table) => table.name.trim() && table.seats.length > 0);
  const tablesWithoutSeats = tables.filter((table) => !table.seats.length);
  const tablesWithSeats = tables.filter((table) => table.seats.length > 0);
  const canSaveWithSeats =
    tablesWithoutSeats.length > 0 &&
    tablesWithSeats.length > 0 &&
    tablesWithSeats.every((table) => table.name.trim());

  function chooseMode(next: DrawingMode) {
    setMode(next);
    setPoints([]);
    setError("");
  }
  function addPoint(point: Point) {
    if (busy || points.length >= 64) return;
    setPoints((previous) => [...previous, point]);
    setCursor(point);
  }
  function clickFrame(event: MouseEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = pointerToFrame(
      event.clientX - bounds.left,
      event.clientY - bounds.top,
      bounds.width,
      bounds.height,
      frame.width,
      frame.height,
    );
    if (point) addPoint(point);
  }
  function keyFrame(event: KeyboardEvent<SVGSVGElement>) {
    if (busy) return;
    const step = event.shiftKey ? 0.05 : 0.01;
    const deltas: Record<string, Point> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (deltas[event.key]) {
      event.preventDefault();
      const delta = deltas[event.key];
      setCursor(([x, y]) => [
        Math.max(0, Math.min(1, x + delta[0])),
        Math.max(0, Math.min(1, y + delta[1])),
      ]);
    } else if (event.key === "Enter") {
      event.preventDefault();
      addPoint(cursor);
    } else if (event.key === "Escape") setPoints([]);
  }
  function addTable(polygon: Point[]) {
    if (tables.length >= 16) return;
    const table = {
      id: newId(),
      name: `Table ${tables.length + 1}`,
      polygon,
      seats: [],
    };
    setTables((previous) => [...previous, table]);
    setSelected(table.id);
    setMode("seat");
    setPoints([]);
  }
  function finish() {
    if (!validPolygon(points)) return;
    if (mode === "table") addTable(points);
    else if (selectedTable) {
      setTables((previous) =>
        previous.map((table) =>
          table.id !== selected
            ? table
            : mode === "redraw"
              ? { ...table, polygon: points }
              : {
                  ...table,
                  seats: [...table.seats, { id: newId(), polygon: points }],
                },
        ),
      );
      setPoints([]);
    }
  }
  async function save(skipUnseated = false) {
    if (busy || points.length > 0) return;
    setSaving(true);
    setError("");
    try {
      await onSave(prepareTableSetupSave(tables, skipUnseated));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save table setup.",
      );
    } finally {
      setSaving(false);
    }
  }

  return {
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
  };
}
