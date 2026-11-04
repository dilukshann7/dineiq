import { useEffect, type RefObject } from "react";
import { drawDetections, type DetectionResult } from "@/lib/detection";
import { drawTableLabels } from "@/lib/monitoring/canvas";
import type { Layout, TableState } from "@/lib/monitoring/types";

export function useDetectionOverlay({
  overlayRef,
  frameRef,
  detection,
  live,
  layout,
  monitoring,
  visibleStates,
  configuring,
}: {
  overlayRef: RefObject<HTMLCanvasElement | null>;
  frameRef: RefObject<HTMLDivElement | null>;
  detection: DetectionResult | null;
  live: boolean;
  layout: Layout | null;
  monitoring: boolean;
  visibleStates: TableState[];
  configuring: boolean;
}) {
  useEffect(() => {
    const canvas = overlayRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;
    const render = () => {
      const result = live ? detection : null;
      drawDetections(canvas, result);
      if (result && layout && monitoring && !configuring && !layout.recalibration_required)
        drawTableLabels(canvas, layout, visibleStates);
    };
    render();
    const observer = new ResizeObserver(render);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [
    detection,
    live,
    layout,
    monitoring,
    visibleStates,
    configuring,
    frameRef,
    overlayRef,
  ]);
}
