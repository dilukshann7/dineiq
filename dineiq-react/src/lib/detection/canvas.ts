import { containRect } from "../geometry.ts";
import type { DetectionResult } from "./types.ts";

export function drawDetections(
  canvas: HTMLCanvasElement,
  result: DetectionResult | null,
) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  if (!result) return;
  const fitted = containRect(width, height, result.width, result.height);
  context.font = "12px Geist, sans-serif";
  context.textBaseline = "middle";
  context.lineWidth = 1.5;
  for (const detection of result.detections) {
    if (detection.label !== "dining table" && detection.label !== "chair")
      continue;
    const [left, top, right, bottom] = detection.box;
    const x = fitted.x + left * fitted.width;
    const y = fitted.y + top * fitted.height;
    const boxWidth = (right - left) * fitted.width;
    const boxHeight = (bottom - top) * fitted.height;
    let anchorX = x;
    let anchorY = y - 23;
    if (detection.label === "dining table") {
      if (!detection.polygon) continue;
      const points = detection.polygon.map(([px, py]) => [
        fitted.x + px * fitted.width,
        fitted.y + py * fitted.height,
      ]);
      context.beginPath();
      context.moveTo(points[0][0], points[0][1]);
      for (const [px, py] of points.slice(1)) context.lineTo(px, py);
      context.closePath();
      context.fillStyle = "rgba(16, 185, 129, 0.30)";
      context.strokeStyle = "#34d399";
      context.fill();
      context.stroke();
      anchorX = x + boxWidth / 2;
      const ys = points.map((point) => point[1]);
      anchorY = (Math.min(...ys) + Math.max(...ys)) / 2 - 11;
    } else {
      context.strokeStyle = "#34d399";
      context.strokeRect(x, y, boxWidth, boxHeight);
    }
    const label = `${detection.label === "dining table" ? "Table" : detection.label} ${Math.round(detection.confidence * 100)}%`;
    const labelWidth = context.measureText(label).width + 12;
    if (detection.label === "dining table") anchorX -= labelWidth / 2;
    const labelX = Math.max(0, Math.min(anchorX, width - labelWidth));
    const labelY = Math.max(0, Math.min(anchorY, height - 22));
    context.fillStyle = "#0a0a0a";
    context.fillRect(labelX, labelY, labelWidth, 22);
    context.fillStyle = "#ededed";
    context.fillText(label, labelX + 6, labelY + 11);
  }
}
