import { containRect } from "../geometry.ts";
import type { Point } from "./types.ts";

export function pointerToFrame(
  x: number,
  y: number,
  width: number,
  height: number,
  frameWidth: number,
  frameHeight: number,
): Point | null {
  const fitted = containRect(width, height, frameWidth, frameHeight);
  if (!fitted.width || !fitted.height) return null;
  const px = (x - fitted.x) / fitted.width,
    py = (y - fitted.y) / fitted.height;
  return px >= 0 && px <= 1 && py >= 0 && py <= 1 ? [px, py] : null;
}
