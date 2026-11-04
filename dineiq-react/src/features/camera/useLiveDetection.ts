import { useEffect, useState, type RefObject } from "react";
import { API_BASE } from "@/lib/auth";
import {
  createDetectionLoop,
  createFrameCapture,
  requestDetection,
  type DetectionResult,
} from "@/lib/detection";
import { createMonitoringSession } from "@/lib/monitoring/session";
import {
  hideTableStates as hideStates,
  mergeTableStates,
  reconcileLayout,
  monitoringCheckPassed,
} from "@/lib/monitoring/state";
import type { TableMonitoring } from "@/features/tables/useTableMonitoring";
import type { MonitoringFrame } from "@/lib/monitoring/types";

export function useLiveDetection(
  videoRef: RefObject<HTMLVideoElement | null>,
  live: boolean,
  monitor: TableMonitoring,
) {
  const {
    client: monitorClient,
    monitoringGeneration,
    advanceGeneration,
    monitoring,
    setup,
    layout,
    setTableStates,
    setLayout,
    setMonitorError,
    setMonitoring,
  } = monitor;
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [detectionError, setDetectionError] = useState("");
  const [detectionRetry, setDetectionRetry] = useState(0);
  const [checkedFrame, setCheckedFrame] = useState<{ frame: MonitoringFrame; generation: number } | null>(null);
  const [detectionHz, setDetectionHz] = useState<number | null>(null);

  useEffect(() => {
    if (!live || !videoRef.current || setup) return;
    const generation = monitoringGeneration.current;
    const apiBase = API_BASE;
    let lastResultAt: number | null = null;
    setDetectionHz(null);
    const onResult = (result: DetectionResult) => {
      if (generation !== monitoringGeneration.current) return;
      const now = performance.now();
      if (lastResultAt !== null && now > lastResultAt) {
        const hz = 1000 / (now - lastResultAt);
        setDetectionHz((previous) =>
          previous === null ? hz : previous * 0.7 + hz * 0.3,
        );
      }
      lastResultAt = now;
      setDetection(result);
    };
    if (monitoring) {
      const stop = createMonitoringSession({
        api: monitorClient,
        capture: createFrameCapture(videoRef.current),
        expectedRevision: layout?.revision,
        onResult: (result) => {
          if (generation !== monitoringGeneration.current) return;
          onResult(result);
          setCheckedFrame(monitoringCheckPassed(result) ? { frame: result, generation } : null);
          setTableStates((previous) =>
            mergeTableStates(
              previous,
              result.tables,
              generation,
              monitoringGeneration.current,
            ),
          );
          setLayout((previous) => result.layout
            ? reconcileLayout(previous, result.layout, result.recalibration_required)
            : previous ? { ...previous, recalibration_required: result.recalibration_required } : null);
        },
        onError: (error) => {
          if (generation !== monitoringGeneration.current) return;
          advanceGeneration();
          setMonitorError(error.message);
          setTableStates((previous) =>
            hideStates(previous, "Monitoring interrupted"),
          );
          setMonitoring(false);
        },
      });
      window.addEventListener("pagehide", stop);
      return () => {
        window.removeEventListener("pagehide", stop);
        stop();
      };
    }
    return createDetectionLoop({
      capture: createFrameCapture(videoRef.current),
      detect: (frame, signal) => requestDetection(apiBase, frame, signal),
      onResult,
      onError: (error) => {
        if (generation !== monitoringGeneration.current) return;
        setDetection(null);
        setDetectionError(error.message);
      },
    });
  }, [
    live,
    detectionRetry,
    monitoring,
    setup,
    layout?.revision,
    videoRef,
    monitorClient,
    monitoringGeneration,
    advanceGeneration,
    setTableStates,
    setLayout,
    setMonitorError,
    setMonitoring,
  ]);

  function retryDetection() {
    advanceGeneration();
    setDetectionError("");
    setDetection(null);
    setDetectionRetry((retry) => retry + 1);
  }

  return {
    detection,
    monitoringFrame: live && monitoring && !setup && checkedFrame?.generation === monitoringGeneration.current
      ? checkedFrame.frame : null,
    setDetection,
    detectionError,
    setDetectionError,
    detectionHz,
    retryDetection,
  };
}
