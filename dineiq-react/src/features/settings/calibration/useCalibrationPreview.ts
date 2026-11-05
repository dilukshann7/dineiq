import { useEffect, useState, type RefObject } from "react";
import { ApiError, authRequest, jsonRequest } from "@/lib/auth";
import { createFrameCapture } from "@/lib/detection";
import type { Values } from "./model";

const base = "/admin/settings/calibration/previews";
export type PreviewDetection = { label: string; confidence: number; box: number[]; polygon?: number[][] };
export type PreviewTable = {
  id: string; name: string; occupancy: string; cleanliness: string; reason: string;
  countdowns: Record<string, number | null>;
  diagnostics: { table_coverage: number; visible_surface: number; surface_coverage: number;
    person_obstruction: number; assignments: { person_index: number; seat_id: string; overlap: number; reason: string }[] };
};
export type Simulation = { detections: PreviewDetection[]; tables: PreviewTable[]; matching_status: string;
  layout?: { id: string; polygon: number[][]; seats: { id: string; polygon: number[][] }[] }[] };
export type PreviewResult = { active: Simulation; draft: Simulation; width: number; height: number; revision: number };

export function useCalibrationPreview({ enabled, live, videoRef, settings, revision, layoutRevision, generation, onChanged }: {
  enabled: boolean; live: boolean; videoRef: RefObject<HTMLVideoElement | null>;
  settings?: Values; revision?: number; layoutRevision?: number; generation?: number; onChanged: () => void;
}) {
  const [result, setResult] = useState<{ frame: Blob; result: PreviewResult } | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const serialized = settings ? JSON.stringify(settings) : "";
  useEffect(() => {
    // Reset responses when replacing the external preview session.
    // oxlint-disable-next-line react/set-state-in-effect
    setResult(null);
    setError("");
    if (!enabled || !live || !serialized || !videoRef.current) {
      setStatus(enabled ? "Start the camera and enter valid settings to preview." : "");
      return;
    }
    const controller = new AbortController();
    const capture = createFrameCapture(videoRef.current);
    let id: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sequence = 0;
    let stopped = false;
    const close = () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      if (id) void authRequest(`${base}/${id}`, { method: "DELETE", keepalive: true }).catch(() => {});
      id = undefined;
    };
    const tick = async () => {
      const started = performance.now();
      try {
        const frame = await capture();
        if (stopped) return;
        if (frame) {
          const value = await authRequest<PreviewResult>(`${base}/${id}/frames?sequence=${++sequence}`, {
            method: "POST", headers: { "Content-Type": "image/jpeg" }, body: frame, signal: controller.signal,
          });
          if (stopped) return;
          setResult({ frame, result: value });
          setStatus("Live simulation. Production status and alerts are unchanged by preview results.");
        }
      } catch (cause) {
        if (stopped) return;
        if (cause instanceof ApiError && cause.status === 429) {
          setStatus("Production inference busy; skipping preview frames.");
        } else if (cause instanceof ApiError && cause.status === 409) {
          setStatus("Settings or table setup changed; refreshing preview.");
          onChanged();
          return;
        } else {
          setError(cause instanceof Error ? cause.message : "Preview failed.");
          close();
          return;
        }
      }
      if (!stopped) timer = setTimeout(tick, Math.max(1000, 1100 - (performance.now() - started)));
    };
    setStatus("Starting isolated preview…");
    void authRequest<{ id: string; has_layout: boolean }>(base, {
      ...jsonRequest("POST", { settings: JSON.parse(serialized), camera_id: "main", expected_layout_revision: layoutRevision ?? null }),
      signal: controller.signal,
    }).then((session) => {
      id = session.id;
      if (stopped) { close(); return; }
      void tick();
    }).catch((cause) => {
      if (stopped) return;
      if (cause instanceof ApiError && cause.status === 409) { onChanged(); return; }
      setError(cause instanceof Error ? cause.message : "Could not start preview.");
    });
    window.addEventListener("pagehide", close);
    return () => { window.removeEventListener("pagehide", close); close(); };
  }, [enabled, live, serialized, revision, layoutRevision, generation, videoRef, onChanged]);
  return { result, status, error };
}
