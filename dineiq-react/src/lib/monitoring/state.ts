import type { Layout, TableState, MonitoringFrame } from "./types.ts";

export function monitoringCheckPassed(
  frame: Pick<MonitoringFrame, "recalibration_required" | "verification_passed">,
): boolean {
  return !frame.recalibration_required && frame.verification_passed === true;
}

export function reconcileLayout(
  previous: Layout | null,
  saved: Layout | null,
  recalibrationRequired: boolean,
): Layout | null {
  if (!saved) return previous;
  if (
    previous &&
    (previous.revision > saved.revision ||
      (previous.revision === saved.revision &&
        (previous.position_version ?? 0) > (saved.position_version ?? 0)))
  )
    return previous;
  return { ...saved, recalibration_required: recalibrationRequired };
}

export function staleStates(
  states: TableState[],
  now = Date.now(),
): TableState[] {
  return states.map((state) =>
    !state.observed_at || now - Date.parse(state.observed_at) > 5000
      ? {
          ...state,
          count: null,
          occupancy: "unknown",
          cleanliness: "unknown",
          valid: false,
          evidence: [],
          reason: "Camera feed unavailable",
        }
      : state,
  );
}

export function mergeTableStates(
  previous: TableState[],
  incoming: TableState[],
  updateGeneration: number,
  currentGeneration: number,
): TableState[] {
  if (updateGeneration !== currentGeneration) return previous;
  const result = [...previous];
  for (const next of incoming) {
    const index = result.findIndex((state) => state.id === next.id);
    const old = result[index];
    if (old) {
      const oldChange = Date.parse(old.updated_at ?? "") || 0;
      const nextChange = Date.parse(next.updated_at ?? "") || 0;
      if (
        oldChange > nextChange ||
        (oldChange === nextChange &&
          (Date.parse(old.observed_at ?? "") || 0) >
            (Date.parse(next.observed_at ?? "") || 0))
      )
        continue;
      result[index] = next;
    } else result.push(next);
  }
  return result;
}

export function tablePresentation(state: TableState) {
  const occupancy = {
    unknown: "Unknown",
    empty: "Empty",
    partial: "Partly occupied",
    full: "Full",
  }[state.occupancy];
  const cleanliness = {
    unknown: "Unknown",
    not_assessed: "Not assessed",
    needs_cleaning: `Needs cleaning — ${state.manual ? "manual" : "estimate"}`,
    looks_clear: `Looks clear — ${state.manual ? "manual" : "estimate"}`,
  }[state.cleanliness];
  const tone: "unknown" | "occupied" | "cleaning" | "clear" = !state.valid
    ? "unknown"
    : state.occupancy !== "empty"
      ? "occupied"
      : state.cleanliness === "needs_cleaning"
        ? "cleaning"
        : state.cleanliness === "looks_clear"
          ? "clear"
          : "unknown";
  return {
    occupancy,
    cleanliness,
    tone,
    count: `${state.count === null ? "—" : state.count}/${state.capacity}`,
  };
}

export function hideTableStates(
  states: TableState[],
  reason: string,
): TableState[] {
  return states.map((state) => ({
    ...state,
    count: null,
    occupancy: "unknown",
    cleanliness: "unknown",
    valid: false,
    evidence: [],
    reason,
  }));
}
