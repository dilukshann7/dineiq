import { Camera, CameraOff, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CameraState } from "@/lib/camera";

export function CameraToggle({
  camera,
  onToggle,
}: {
  camera: CameraState;
  onToggle: () => void;
}) {
  const live = camera.status === "live";
  const requesting = camera.status === "requesting";
  return (
    <Button
      size="lg"
      variant={live || requesting ? "outline" : "default"}
      onClick={onToggle}
    >
      {live ? (
        <Square aria-hidden="true" />
      ) : requesting ? (
        <CameraOff aria-hidden="true" />
      ) : (
        <Camera aria-hidden="true" />
      )}
      {live
        ? "Stop camera"
        : requesting
          ? "Cancel"
          : camera.status === "error"
            ? "Try again"
            : "Start camera"}
    </Button>
  );
}
