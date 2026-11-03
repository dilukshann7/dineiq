"""Track people or dining tables in a video and emit one JSON record per frame."""

import argparse
import json
from pathlib import Path

import cv2
from ultralytics import YOLO


ASSETS = Path(__file__).resolve().parent.parent / "downloads"


def identify(video: Path, weights: Path, target: str = "people", imgsz: int = 640):
    if imgsz <= 0:
        raise ValueError("Inference size must be positive")
    if not weights.is_file():
        raise FileNotFoundError(f"Missing model weights: {weights}")
    if not video.is_file():
        raise FileNotFoundError(f"Missing video: {video}")

    model = YOLO(str(weights))
    label = {"people": "person", "tables": "dining table"}[target]
    class_ids = [index for index, name in model.names.items() if name == label]
    if not class_ids:
        raise ValueError(f"Model does not contain the class {label!r}")
    capture = cv2.VideoCapture(str(video))
    try:
        if not capture.isOpened():
            raise ValueError(f"Cannot open video: {video}")
        frame_index = 0
        while True:
            ok, frame = capture.read()
            if not ok:
                if frame_index == 0:
                    raise ValueError(f"No readable frames: {video}")
                break

            result = model.track(
                frame, classes=class_ids, tracker="bytetrack.yaml",
                persist=True, device="cpu", verbose=False, imgsz=imgsz,
            )[0]
            detections = []
            for box in result.boxes:
                detections.append({
                    "track_id": int(box.id.item()) if box.id is not None else None,
                    "confidence": round(box.conf.item(), 4),
                    "bbox_xyxy": box.xyxy[0].round().int().tolist(),
                })
            yield {"frame": frame_index, target: detections}
            frame_index += 1
    finally:
        capture.release()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("--target", choices=("people", "tables"), default="people")
    parser.add_argument("--imgsz", type=int, default=640, help="Inference size in pixels (default: 640)")
    parser.add_argument("--weights", type=Path, default=ASSETS / "models/yolo11n.pt")
    args = parser.parse_args()
    try:
        for record in identify(args.video, args.weights, args.target, args.imgsz):
            print(json.dumps(record))
    except (FileNotFoundError, ValueError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
