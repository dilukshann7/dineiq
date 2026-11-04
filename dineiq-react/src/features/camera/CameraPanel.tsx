import type { RefObject } from "react";
import { Camera, CameraOff, Maximize2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import type { CameraState } from "@/lib/camera";
import type { DetectionResult } from "@/lib/detection";
import "./camera.css";

export function CameraPanel({
  active,
  camera,
  videoRef,
  frameRef,
  overlayRef,
  detection,
  detectionError,
  detectionHz,
  fullscreenError,
  expandPreview,
  onRetryDetection,
}: {
  active: boolean;
  camera: CameraState;
  videoRef: RefObject<HTMLVideoElement | null>;
  frameRef: RefObject<HTMLDivElement | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
  detection: DetectionResult | null;
  detectionError: string;
  detectionHz: number | null;
  fullscreenError: string;
  expandPreview: () => Promise<void>;
  onRetryDetection: () => void;
}) {
  const live = camera.status === "live";
  const requesting = camera.status === "requesting";
  const statusLabel = live
    ? "Live"
    : requesting
      ? "Connecting"
      : camera.status === "error"
        ? "Unavailable"
        : "Camera off";
  const chairCount =
    detection?.detections.filter((box) => box.label === "chair").length ?? 0;
  const tableCount =
    detection?.detections.filter((box) => box.label === "dining table")
      .length ?? 0;
  return (
    <section
      hidden={!active}
      className="camera-panel"
      aria-label="Camera preview"
    >
      <Card className="camera-feed-card gap-0 py-0 shadow-none ring-0">
        <div className="camera-toolbar">
          <div className="camera-feed-label">
            <Video size={16} aria-hidden="true" />
            <h2>Webcam feed</h2>
          </div>
          <span
            className="camera-status"
            data-state={camera.status}
            role="status"
          >
            <span className="camera-status-dot" aria-hidden="true" />
            {statusLabel}
          </span>
        </div>
        <CardContent className="px-0">
          <div ref={frameRef} className="camera-viewport" data-live={live}>
            <video
              ref={videoRef}
              className="camera-video"
              data-live={live}
              autoPlay
              playsInline
              muted
              aria-label="Live webcam preview"
              aria-hidden={!live}
            />
            <canvas
              ref={overlayRef}
              className="camera-overlay"
              aria-hidden="true"
            />
            {!live && (
              <div className="camera-empty">
                {camera.status === "error" ? (
                  <CameraOff size={28} strokeWidth={1.4} aria-hidden="true" />
                ) : (
                  <Camera size={28} strokeWidth={1.4} aria-hidden="true" />
                )}
                <div
                  className="camera-empty-copy"
                  role={camera.status === "error" ? "alert" : undefined}
                  aria-live="polite"
                >
                  <h3>
                    {requesting
                      ? "Waiting for your camera"
                      : camera.status === "error"
                        ? "Camera unavailable"
                        : "Your camera starts here"}
                  </h3>
                  <p>
                    {requesting
                      ? "Allow camera access in your browser to continue."
                      : camera.status === "error"
                        ? camera.message
                        : "Select Start camera and allow access to your webcam."}
                  </p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
        <CardFooter className="camera-feed-footer gap-4 px-4 py-3">
          <span className="camera-source">
            {live ? camera.label : "Default webcam"}
          </span>
          <div className="camera-feed-actions">
            {live && camera.width && camera.height ? (
              <span className="camera-resolution">
                {camera.width} × {camera.height}
              </span>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              disabled={!live}
              onClick={() => void expandPreview()}
            >
              <Maximize2 aria-hidden="true" />
              Fullscreen
            </Button>
          </div>
        </CardFooter>
      </Card>
      {live && (
        <div className="camera-detection-status" role="status">
          <span>
            {detectionError ||
              (detection
                ? `${tableCount} ${tableCount === 1 ? "table" : "tables"} · ${chairCount} ${chairCount === 1 ? "chair" : "chairs"}${detectionHz === null ? "" : ` · ${detectionHz.toFixed(1)} Hz`}`
                : "Connecting detector…")}
          </span>
          {detectionError && (
            <Button variant="outline" size="sm" onClick={onRetryDetection}>
              Retry detection
            </Button>
          )}
        </div>
      )}
      {fullscreenError && (
        <p className="camera-feedback" role="status">
          {fullscreenError}
        </p>
      )}
    </section>
  );
}
