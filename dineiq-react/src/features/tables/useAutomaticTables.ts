import { useEffect, useRef, useState, type RefObject } from "react";
import { createAutomaticTableSetup } from "@/lib/automatic-table-setup";
import { freezeFrame } from "@/lib/monitoring/canvas";
import type { TableMonitoring } from "./useTableMonitoring";

export function useAutomaticTables(
  videoRef: RefObject<HTMLVideoElement | null>,
  live: boolean,
  monitor: TableMonitoring,
) {
  const { layout, layoutLoading, setup, client, monitoringGeneration,
    setLayout, setMonitorError, setMonitoring, monitoring, monitoringInterrupted,
    setMonitoringInterrupted } = monitor;
  const started = useRef(false);
  const [status, setStatus] = useState("");
  const discovering = live && !layoutLoading && !layout && !setup;

  useEffect(() => {
    if (!discovering) return;
    const generation = monitoringGeneration.current;
    return createAutomaticTableSetup({
      client,
      capture: () => {
        if (!videoRef.current) throw new Error("Waiting for the camera.");
        return freezeFrame(videoRef.current);
      },
      onStatus: setStatus,
      onSaved: saved => {
        if (generation !== monitoringGeneration.current) return;
        setLayout(saved);
        setMonitorError("");
        setStatus("");
      },
      onError: error => {
        if (generation === monitoringGeneration.current) {
          setMonitorError(error.message);
          setStatus(`Automatic setup will retry: ${error.message}`);
        }
      },
    });
  }, [discovering, client, videoRef, monitoringGeneration, setLayout, setMonitorError]);

  useEffect(() => {
    if (!live) { started.current = false; return; }
    if (layoutLoading || !layout || setup || started.current) return;
    started.current = true;
    setMonitoring(true);
  }, [live, layoutLoading, layout, setup, setMonitoring]);

  const revision = layout?.revision;
  useEffect(() => {
    if (!live || !revision || layoutLoading || setup || monitoring || !monitoringInterrupted) return;
    const timer = setTimeout(() => {
      setMonitoringInterrupted(false);
      setMonitorError("");
      setMonitoring(true);
    }, 2000);
    return () => clearTimeout(timer);
  }, [live, revision, layoutLoading, setup, monitoring, monitoringInterrupted,
    setMonitoringInterrupted, setMonitorError, setMonitoring]);

  return { discovering, status: discovering ? status : "" };
}
