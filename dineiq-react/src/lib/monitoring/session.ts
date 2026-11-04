import { createDetectionLoop } from "../detection/loop.ts";
import type { MonitoringClient } from "./client.ts";
import type { Credentials, MonitoringFrame } from "./types.ts";

type CaptureApi = Pick<MonitoringClient, "start" | "stop" | "frame">;

export function createMonitoringSession({
  api,
  capture,
  onResult,
  onError,
  expectedRevision,
  intervalMs = 500,
}: {
  api: CaptureApi;
  capture: () => Promise<Blob | null>;
  onResult: (frame: MonitoringFrame) => void;
  onError: (error: Error) => void;
  expectedRevision?: number;
  intervalMs?: number;
}) {
  const controller = new AbortController();
  let session: Credentials | null = null;
  let stopLoop: (() => void) | undefined;
  let closing = false;
  function closeRemote() {
    if (session && !closing) {
      closing = true;
      void api.stop(session.session_id).catch(() => {});
    }
  }
  function fail(error: unknown) {
    if (!controller.signal.aborted)
      onError(error instanceof Error ? error : new Error("Monitoring failed."));
    closeRemote();
  }
  void api
    .start(controller.signal, expectedRevision)
    .then((value) => {
      session = value;
      if (controller.signal.aborted) {
        closeRemote();
        return;
      }
      stopLoop = createDetectionLoop<MonitoringFrame>({
        capture,
        detect: async (frame, signal) => {
          const next = { ...session!, sequence: session!.sequence + 1 };
          const result = await api.frame(next, frame, signal);
          session = result;
          return result;
        },
        onResult: (result) => {
          onResult(result);
        },
        onError: fail,
        intervalMs,
      });
    })
    .catch(fail);
  return () => {
    controller.abort();
    stopLoop?.();
    closeRemote();
  };
}
