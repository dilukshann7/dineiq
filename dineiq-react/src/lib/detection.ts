export type { Detection, DetectionResult } from "./detection/types.ts";
export { containRect } from "./geometry.ts";
export { createDetectionLoop } from "./detection/loop.ts";
export { createFrameCapture } from "./detection/capture.ts";
export { requestDetection, validResult } from "./detection/client.ts";
export { drawDetections } from "./detection/canvas.ts";
