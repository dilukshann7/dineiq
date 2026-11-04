import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { API_BASE } from "@/lib/auth";
import type { CameraState } from "@/lib/camera";
import {
  createMonitoringClient,
  readStaffDashboard,
} from "@/lib/monitoring/client";
import { freezeFrame } from "@/lib/monitoring/canvas";
import {
  hideTableStates as hideStates,
  staleStates,
  mergeTableStates,
  reconcileLayout,
} from "@/lib/monitoring/state";
import type {
  ConfiguredTable,
  Correction,
  FrozenFrame,
  Layout,
  TableState,
} from "@/lib/monitoring/types";

const monitorClient = createMonitoringClient(API_BASE);

export function useTableMonitoring(
  videoRef: RefObject<HTMLVideoElement | null>,
  setupIncomplete = false,
) {
  const monitoringGeneration = useRef(0);
  const advanceGeneration = useCallback(
    () => ++monitoringGeneration.current,
    [],
  );
  const [layout, setLayout] = useState<Layout | null>(null);
  const [layoutLoading, setLayoutLoading] = useState(true);
  const [tableStates, setTableStates] = useState<TableState[]>([]);
  const [monitoring, setMonitoring] = useState(false);
  const [monitorError, setMonitorError] = useState("");
  const [reload, setReload] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [setup, setSetup] = useState<{
    frame: FrozenFrame;
    layout: Layout | null;
  } | null>(null);
  const visibleStates = useMemo(
    () => staleStates(tableStates, clock),
    [tableStates, clock],
  );
  useEffect(() => {
    const controller = new AbortController();
    const generation = monitoringGeneration.current;
    const load = setupIncomplete
      ? monitorClient.layout(controller.signal).then(layout => ({ layout, tables: [], recalibration_required: layout?.recalibration_required ?? false }))
      : readStaffDashboard(monitorClient, controller.signal);
    void load
      .then(({ layout: saved, ...current }) => {
        if (controller.signal.aborted) return;
        setLayout((previous) => generation !== monitoringGeneration.current
          ? previous
          : reconcileLayout(previous, saved, current.recalibration_required));
        setTableStates((previous) =>
          mergeTableStates(
            previous,
            current.tables,
            generation,
            monitoringGeneration.current,
          ),
        );
        if (generation === monitoringGeneration.current) setMonitorError("");
      })
      .catch((error: unknown) => {
        if (
          !controller.signal.aborted &&
          generation === monitoringGeneration.current
        )
          setMonitorError(
            error instanceof Error ? error.message : "Monitoring unavailable.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLayoutLoading(false);
      });
    return () => controller.abort();
  }, [reload, setupIncomplete]);

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (monitoring || setupIncomplete) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refreshStaffTables() {
      const generation = monitoringGeneration.current;
      try {
        const { layout: saved, ...current } = await readStaffDashboard(
          monitorClient,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setLayout((previous) => {
            if (generation !== monitoringGeneration.current) return previous;
            return reconcileLayout(
              previous,
              saved,
              current.recalibration_required,
            );
          });
          setTableStates((previous) =>
            mergeTableStates(
              previous,
              current.tables,
              generation,
              monitoringGeneration.current,
            ),
          );
        }
      } catch (error) {
        if (
          !controller.signal.aborted &&
          generation === monitoringGeneration.current
        )
          setMonitorError(
            error instanceof Error ? error.message : "Monitoring unavailable.",
          );
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(refreshStaffTables, 2000);
      }
    }
    timer = setTimeout(refreshStaffTables, 2000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [monitoring, setupIncomplete]);

  function configureTables() {
    if (!videoRef.current || layoutLoading) return;
    try {
      const frame = freezeFrame(videoRef.current);
      monitoringGeneration.current++;
      setSetup({ frame, layout: structuredClone(layout) });
      setMonitoring(false);
      setTableStates((previous) => hideStates(previous, "Configuring tables"));
      setMonitorError("");
    } catch (error) {
      setMonitorError(
        error instanceof Error
          ? error.message
          : "Could not capture setup frame.",
      );
    }
  }
  async function correctTable(id: string, action: Correction) {
    const generation = monitoringGeneration.current;
    try {
      const state = await monitorClient.correct(id, action);
      setTableStates((previous) =>
        mergeTableStates(
          previous,
          [state],
          generation,
          monitoringGeneration.current,
        ),
      );
      if (generation === monitoringGeneration.current) setMonitorError("");
    } catch (error) {
      if (generation === monitoringGeneration.current)
        setMonitorError(
          error instanceof Error
            ? error.message
            : "Could not correct table state.",
        );
    }
  }
  async function staffAction(action: () => Promise<TableState>) {
    const generation = monitoringGeneration.current;
    try {
      const state = await action();
      setTableStates((previous) =>
        mergeTableStates(
          previous,
          [state],
          generation,
          monitoringGeneration.current,
        ),
      );
      if (generation === monitoringGeneration.current) setMonitorError("");
    } catch (error) {
      if (generation === monitoringGeneration.current)
        setMonitorError(
          error instanceof Error
            ? error.message
            : "Could not confirm staff action.",
        );
    }
  }

  const onCameraState = useCallback((next: CameraState) => {
    if (next.status !== "live") {
      monitoringGeneration.current++;
      setMonitoring(false);
      setTableStates((previous) => hideStates(previous, "Camera stopped"));
    }
  }, []);

  function reloadMonitoring() {
    setLayoutLoading(true);
    monitoringGeneration.current++;
    setMonitoring(false);
    setTableStates((previous) => hideStates(previous, "Reloading monitoring"));
    setReload((value) => value + 1);
  }

  async function saveSetup(tables: ConfiguredTable[]) {
    if (!setup) return;

    const generation = monitoringGeneration.current;
    const saved = await monitorClient.saveLayout({
      tables,
      width: setup.frame.width,
      height: setup.frame.height,
      expected_revision: setup.layout?.revision ?? 0,
      expected_position_version: setup.layout?.position_version ?? 0,
      frame: setup.frame.base64,
    });
    if (generation !== monitoringGeneration.current) {
      setLayoutLoading(true);
      setReload((value) => value + 1);
      return;
    }
    setLayout(saved);
    setTableStates([]);
    setSetup(null);
    setMonitorError("");
  }

  return {
    client: monitorClient,
    monitoringGeneration,
    advanceGeneration,
    layout,
    setLayout,
    layoutLoading,
    tableStates,
    setTableStates,
    monitoring,
    setMonitoring,
    monitorError,
    setMonitorError,
    clock,
    setup,
    setSetup,
    visibleStates,
    configureTables,
    correctTable,
    staffAction,
    onCameraState,
    reloadMonitoring,
    saveSetup,
  };
}

export type TableMonitoring = ReturnType<typeof useTableMonitoring>;
