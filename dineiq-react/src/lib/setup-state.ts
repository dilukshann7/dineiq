export type SetupCheckpoint = "camera" | "tables" | "staff" | "review";
export type SetupStatus = {
  phase: "needs_admin" | "in_progress" | "complete";
  checkpoint?: SetupCheckpoint;
  generation?: number;
  csrf_token?: string;
};

const checkpoints: string[] = ["camera", "tables", "staff", "review"];

export function parseSetupStatus(value: unknown): SetupStatus {
  if (!value || typeof value !== "object")
    throw new Error("Invalid setup status.");
  const status = value as Record<string, unknown>;
  if (
    !["needs_admin", "in_progress", "complete"].includes(
      String(status.phase),
    ) ||
    (status.checkpoint !== undefined &&
      !checkpoints.includes(String(status.checkpoint))) ||
    (status.generation !== undefined &&
      (!Number.isInteger(status.generation) ||
        Number(status.generation) < 1)) ||
    (status.csrf_token !== undefined && typeof status.csrf_token !== "string")
  )
    throw new Error("Invalid setup status.");
  return status as SetupStatus;
}

export function onboardingStep(
  status: SetupStatus,
  cameraLive: boolean,
  staffPending = false,
): SetupCheckpoint {
  if (staffPending || status.checkpoint === "staff") return "staff";
  return cameraLive ? (status.checkpoint ?? "camera") : "camera";
}
