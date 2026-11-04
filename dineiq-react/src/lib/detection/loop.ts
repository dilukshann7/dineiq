import type { DetectionResult } from "./types.ts";

export function createDetectionLoop<
  T extends DetectionResult = DetectionResult,
>({
  capture,
  detect,
  onResult,
  onError,
  intervalMs = 1000 / 30,
}: {
  capture: () => Promise<Blob | null>;
  detect: (frame: Blob, signal: AbortSignal) => Promise<T>;
  onResult: (result: T) => void;
  onError: (error: Error) => void;
  intervalMs?: number;
}) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function next() {
    const started = performance.now();
    try {
      const frame = await capture();
      if (controller.signal.aborted) return;
      if (frame) {
        const result = await detect(frame, controller.signal);
        if (controller.signal.aborted) return;
        onResult(result);
      }
      if (controller.signal.aborted) return;
      const delay = frame
        ? Math.max(0, intervalMs - (performance.now() - started))
        : 50;
      timer = setTimeout(() => void next(), delay);
    } catch (error) {
      if (!controller.signal.aborted) {
        onError(
          error instanceof Error
            ? error
            : new Error("Detection failed. Please retry."),
        );
      }
    }
  }

  void next();
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}
