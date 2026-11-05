import { useEffect, useRef } from "react";
import { useTableMonitoring } from "@/features/tables/useTableMonitoring";
import { useAutomaticTables } from "@/features/tables/useAutomaticTables";
import { useCameraPreview } from "@/features/camera/useCameraPreview";
import { useLiveDetection } from "@/features/camera/useLiveDetection";
import { useDetectionOverlay } from "@/features/camera/useDetectionOverlay";
import { hideTableStates } from "@/lib/monitoring/state";

export function useDashboardWorkspace(setupIncomplete = false) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const monitor = useTableMonitoring(videoRef, setupIncomplete);
  const camera = useCameraPreview(videoRef, frameRef, monitor.onCameraState);
  const automaticTables = useAutomaticTables(videoRef, camera.live, monitor);
  const detector = useLiveDetection(videoRef, camera.live, monitor, automaticTables.discovering);
  useDetectionOverlay({
    overlayRef,
    frameRef,
    detection: detector.detection,
    live: camera.live,
    layout: monitor.layout,
    monitoring: monitor.monitoring,
    visibleStates: monitor.visibleStates,
    configuring: Boolean(monitor.setup),
  });

  useEffect(() => {
    const previous = document.documentElement.classList.contains("dark");
    document.documentElement.classList.remove("dark");
    return () => {
      document.documentElement.classList.toggle("dark", previous);
    };
  }, []);

  function toggleCamera() {
    monitor.advanceGeneration();
    camera.setFullscreenError("");
    monitor.setMonitoring(false);
    monitor.setMonitoringInterrupted(false);
    monitor.setSetup(null);
    detector.setDetection(null);
    detector.setDetectionError("");
    camera.toggleCamera();
  }

  function toggleMonitoring() {
    monitor.advanceGeneration();
    monitor.setMonitorError("");
    monitor.setMonitoringInterrupted(false);
    detector.setDetectionError("");
    if (monitor.monitoring)
      monitor.setTableStates((previous) =>
        hideTableStates(previous, "Monitoring stopped"),
      );
    monitor.setMonitoring((value) => !value);
  }

  return {
    monitor,
    camera,
    detector,
    automaticTables,
    videoRef,
    frameRef,
    overlayRef,
    toggleCamera,
    toggleMonitoring,
    stopForReset() {
      monitor.advanceGeneration();
      monitor.setMonitoring(false);
      monitor.setMonitoringInterrupted(false);
      monitor.setSetup(null);
      detector.setDetection(null);
      camera.stopCamera();
    },
  };
}
