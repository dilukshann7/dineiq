import { containRect } from "../geometry.ts";
import { tablePresentation } from "./state.ts";
import type { FrozenFrame, Layout, TableState } from "./types.ts";

export function freezeFrame(video: HTMLVideoElement): FrozenFrame {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight)
    throw new Error("Wait for the camera preview before configuring tables.");
  const scale = Math.min(
    1,
    1280 / Math.max(video.videoWidth, video.videoHeight),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot capture the setup frame.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.9);
  return {
    url,
    base64: url.split(",")[1],
    width: canvas.width,
    height: canvas.height,
  };
}

export function drawTableLabels(
  canvas: HTMLCanvasElement,
  layout: Layout,
  states: TableState[],
) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const fitted = containRect(
    canvas.clientWidth,
    canvas.clientHeight,
    layout.width,
    layout.height,
  );
  const colors = {
    unknown: "#9ca3af",
    occupied: "#f87171",
    cleaning: "#fbbf24",
    clear: "#34d399",
  };
  context.font = "12px Inter, sans-serif";
  context.textBaseline = "middle";
  for (const table of layout.tables) {
    const state = states.find((item) => item.id === table.id);
    const tone = state ? tablePresentation(state).tone : "unknown";
    const points = table.polygon.map(([x, y]) => [
      fitted.x + x * fitted.width,
      fitted.y + y * fitted.height,
    ]);
    const text = `${table.name} · ${state ? tablePresentation(state).count : `—/${table.seats.length}`}`;
    const textWidth = context.measureText(text).width + 16;
    const x = Math.max(
      0,
      Math.min(points[0][0], canvas.clientWidth - textWidth),
    );
    const y = Math.max(
      0,
      Math.min(points[0][1] - 26, canvas.clientHeight - 24),
    );
    context.fillStyle = "#111827";
    context.fillRect(x, y, textWidth, 24);
    context.fillStyle = colors[tone];
    context.fillText(text, x + 8, y + 12);
  }
}
