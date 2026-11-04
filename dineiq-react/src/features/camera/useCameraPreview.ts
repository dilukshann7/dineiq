import { useEffect, useRef, useState, type RefObject } from "react";
import {
  createCameraSession,
  type CameraSession,
  type CameraState,
} from "@/lib/camera";

export function useCameraPreview(
  videoRef: RefObject<HTMLVideoElement | null>,
  frameRef: RefObject<HTMLDivElement | null>,
  onCameraState: (state: CameraState) => void,
) {
  const sessionRef = useRef<CameraSession | null>(null);
  const [camera, setCamera] = useState<CameraState>({ status: "idle" });
  const [fullscreenError, setFullscreenError] = useState("");
  const live = camera.status === "live";
  const requesting = camera.status === "requesting";

  useEffect(() => {
    if (!videoRef.current) return;
    const session = createCameraSession(
      videoRef.current,
      (next) => {
        setCamera(next);
        onCameraState(next);
      },
      navigator.mediaDevices,
    );
    sessionRef.current = session;
    return () => {
      sessionRef.current = null;
      session.dispose();
    };
  }, [videoRef, onCameraState]);
  async function expandPreview() {
    setFullscreenError("");
    try {
      if (!frameRef.current?.requestFullscreen) {
        setFullscreenError("Fullscreen is not available in this browser.");
        return;
      }
      await frameRef.current.requestFullscreen();
    } catch {
      setFullscreenError(
        "Fullscreen could not open. You can continue watching here.",
      );
    }
  }

  function toggleCamera() {
    if (live || requesting) sessionRef.current?.stop();
    else void sessionRef.current?.start();
  }

  return {
    camera,
    live,
    requesting,
    fullscreenError,
    setFullscreenError,
    expandPreview,
    toggleCamera,
    stopCamera: () => sessionRef.current?.stop(),
  };
}
