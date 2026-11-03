from io import BytesIO
from threading import Lock
from typing import Any

from app.core.config import BACKEND_DIR, Settings


class InvalidFrame(ValueError):
    """The request does not contain a supported camera frame."""


class DetectorUnavailable(RuntimeError):
    """The configured model cannot be loaded."""


def tabletop_outline(points, width: int, height: int) -> list[list[float]]:
    import cv2
    import numpy as np

    if len(points) < 3:
        return []
    contour = np.rint(points).astype(np.int32)
    x, y, w, h = cv2.boundingRect(contour)
    mask = np.zeros((h, w), dtype=np.uint8)
    cv2.fillPoly(mask, [contour - (x, y)], 255)
    # Remove narrow supports while retaining the broad, visible tabletop.
    radius = max(1, round(min(w, h) * 0.045))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1,) * 2)
    surface = cv2.morphologyEx(
        mask, cv2.MORPH_OPEN, kernel, borderType=cv2.BORDER_CONSTANT, borderValue=0
    )
    contours, _ = cv2.findContours(surface, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return []
    outline = cv2.approxPolyDP(max(contours, key=cv2.contourArea), max(1, w * 0.004), True)
    normalized = (outline.reshape(-1, 2) + (x, y)) / (width, height)
    return normalized.clip(0, 1).round(6).tolist()


class Detector:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._model: Any = None
        self._lock = Lock()

    def _load_model(self):
        if self._model is None:
            path = self.settings.yolo_model_path
            if not path.is_absolute():
                path = BACKEND_DIR / path
            if not path.is_file():
                raise DetectorUnavailable("YOLO weights are missing. Check YOLO_MODEL_PATH.")
            try:
                from ultralytics import YOLO

                model = YOLO(str(path))
            except Exception as exc:
                raise DetectorUnavailable("YOLO could not load. Check the backend setup.") from exc
            if model.task != "segment":
                raise DetectorUnavailable("Set YOLO_MODEL_PATH to instance segmentation weights.")
            self._model = model
        return self._model

    def predict(self, content: bytes) -> dict:
        import cv2
        import numpy as np
        from PIL import Image, UnidentifiedImageError

        try:
            with Image.open(BytesIO(content)) as image:
                if image.format != "JPEG" or not (
                    0 < image.width <= 4096 and 0 < image.height <= 4096
                ):
                    raise InvalidFrame("Send a JPEG frame no larger than 4096 × 4096 pixels.")
                image.verify()
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
            raise InvalidFrame("Invalid JPEG frame") from exc

        try:
            frame = cv2.imdecode(np.frombuffer(content, dtype=np.uint8), cv2.IMREAD_COLOR)
        except cv2.error as exc:
            raise InvalidFrame("Invalid JPEG frame") from exc
        if frame is None:
            raise InvalidFrame("Invalid JPEG frame")
        height, width = frame.shape[:2]

        # One shared model is loaded once; serialize access to its mutable predictor state.
        with self._lock:
            model = self._load_model()
            device = self.settings.yolo_device
            if device == "auto":
                import torch

                device = "0" if torch.cuda.is_available() else "cpu"
            use_half = self.settings.yolo_half and (device.isdigit() or device.startswith("cuda"))
            classes = [
                index for index, name in model.names.items() if name in {"person", "dining table"}
            ]
            if len(classes) != 2:
                raise DetectorUnavailable("The model must include person and dining table classes.")
            try:
                result = model.predict(
                    frame,
                    classes=classes,
                    conf=self.settings.yolo_confidence,
                    imgsz=self.settings.yolo_image_size,
                    nms=True,
                    iou=0.35,
                    device=device,
                    quantize=16 if use_half else 32,
                    verbose=False,
                    save=False,
                )[0]
            except Exception as exc:
                raise DetectorUnavailable(
                    "YOLO inference failed. Check the backend setup."
                ) from exc

            detections = []
            outlines = result.masks.xy if result.masks is not None else []
            for index, box in enumerate(result.boxes):
                class_id = int(box.cls.item())
                if class_id not in classes:
                    continue
                left, top, right, bottom = box.xyxy[0].tolist()
                normalized = [left / width, top / height, right / width, bottom / height]
                detection = {
                    "label": model.names[class_id],
                    "confidence": round(float(box.conf.item()), 4),
                    "box": [round(max(0.0, min(1.0, value)), 6) for value in normalized],
                }
                if detection["label"] == "dining table" and index < len(outlines):
                    polygon = tabletop_outline(outlines[index], width, height)
                    if len(polygon) >= 3:
                        detection["polygon"] = polygon
                detections.append(detection)
        return {"width": width, "height": height, "detections": detections}
