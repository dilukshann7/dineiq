import { apiFetch } from "../auth.ts";
import type { DetectionResult } from "./types.ts";

const monitoringLabels = new Set([
  "chair",
  "bottle",
  "wine glass",
  "cup",
  "fork",
  "knife",
  "spoon",
  "bowl",
  "banana",
  "apple",
  "sandwich",
  "orange",
  "broccoli",
  "carrot",
  "hot dog",
  "pizza",
  "donut",
  "cake",
]);

export function validResult(
  value: unknown,
  monitoring = false,
): value is DetectionResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<DetectionResult>;
  return (
    typeof result.width === "number" &&
    Number.isFinite(result.width) &&
    result.width > 0 &&
    typeof result.height === "number" &&
    Number.isFinite(result.height) &&
    result.height > 0 &&
    Array.isArray(result.detections) &&
    result.detections.every(
      (detection) =>
        detection &&
        (detection.label === "person" ||
          detection.label === "chair" ||
          detection.label === "dining table" ||
          (monitoring && monitoringLabels.has(detection.label))) &&
        Number.isFinite(detection.confidence) &&
        detection.confidence >= 0 &&
        detection.confidence <= 1 &&
        Array.isArray(detection.box) &&
        detection.box.length === 4 &&
        detection.box.every(
          (coordinate) =>
            Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1,
        ) &&
        detection.box[0] <= detection.box[2] &&
        detection.box[1] <= detection.box[3] &&
        (detection.polygon === undefined ||
          (Array.isArray(detection.polygon) &&
            detection.polygon.length >= 3 &&
            detection.polygon.every(
              (point) =>
                Array.isArray(point) &&
                point.length === 2 &&
                point.every(
                  (value) => Number.isFinite(value) && value >= 0 && value <= 1,
                ),
            ))),
    )
  );
}

export async function requestDetection(
  apiBase: string,
  frame: Blob,
  signal: AbortSignal,
): Promise<DetectionResult> {
  let response: Response;
  try {
    response = await apiFetch(`${apiBase.replace(/\/$/, "")}/detect`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: frame,
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error(
      "Detection could not connect. Check the backend is running, then retry.",
    );
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      body &&
      typeof body === "object" &&
      "detail" in body &&
      typeof body.detail === "string"
        ? body.detail
        : "Detection is unavailable. Check the backend, then retry.";
    throw new Error(message);
  }
  const result: unknown = await response.json();
  if (!validResult(result))
    throw new Error("The detector returned an invalid response. Please retry.");
  return result;
}
