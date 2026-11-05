"""Suggest editable table and seated-body regions from visible tables/chairs."""

import math
from uuid import uuid4


def box_iou(first, second):
    left, top = max(first[0], second[0]), max(first[1], second[1])
    right, bottom = min(first[2], second[2]), min(first[3], second[3])
    overlap = max(0, right - left) * max(0, bottom - top)
    first_area = (first[2] - first[0]) * (first[3] - first[1])
    second_area = (second[2] - second[0]) * (second[3] - second[1])
    return overlap / max(1e-9, first_area + second_area - overlap)


def detection_iou(first, second):
    from app.monitoring.rules import polygon_mask

    if first.get("polygon") and second.get("polygon"):
        first_mask, second_mask = polygon_mask(first["polygon"]), polygon_mask(second["polygon"])
        union = int((first_mask | second_mask).sum())
        if union:
            return int((first_mask & second_mask).sum()) / union
    return box_iou(first["box"], second["box"])


def unique_detections(items, label, threshold, confidence=0.35):
    output = []
    for item in sorted(items, key=lambda value: value["confidence"], reverse=True):
        if item["label"] != label or item["confidence"] < confidence:
            continue
        box = item["box"]
        if not all(math.isfinite(value) for value in box) or box[2] <= box[0] or box[3] <= box[1]:
            continue

        if any(detection_iou(item, previous) >= threshold for previous in output):
            continue
        output.append(item)
    return output


def rectangle(box):
    left, top, right, bottom = [round(max(0, min(1, value)), 6) for value in box]
    return [[left, top], [right, top], [right, bottom], [left, bottom]]


def suggest_layout(result: dict, calibration=None) -> dict:
    from app.calibration.contracts import Calibration

    calibration = calibration or Calibration()
    import cv2
    import numpy as np

    width, height = result["width"], result["height"]
    tables = unique_detections(
        result["detections"], "dining table", 0.65, calibration.layout_confidence
    )
    tables.sort(key=lambda item: (item["box"][1], item["box"][0]))
    chairs = unique_detections(result["detections"], "chair", 0.5, calibration.layout_confidence)
    warnings = [
        "Seat estimates use visible chairs only. Review regions and capacity before saving."
    ]
    if len(tables) > 16:
        warnings.append("Only the first 16 detected tables are included.")
    output = []
    for index, item in enumerate(tables[:16]):
        points = item.get("polygon")
        if points and len(points) >= 3:
            polygon = cv2.convexHull(np.array(points, np.float32)).reshape(-1, 2)
            polygon = polygon[:: max(1, math.ceil(len(polygon) / 64))].clip(0, 1).round(6).tolist()
        else:
            polygon = rectangle(item["box"])
            warnings.append(f"Check the approximate outline for Table {index + 1}.")
        if len(polygon) < 3 or cv2.contourArea(np.array(polygon, np.float32)) < 0.0001:
            continue
        output.append(
            {
                "id": f"table_{uuid4().hex}",
                "name": f"Table {len(output) + 1}",
                "polygon": polygon,
                "seats": [],
            }
        )
    assigned = 0
    for chair in chairs:
        left, top, right, bottom = chair["box"]
        chair_width, chair_height = (right - left) * width, (bottom - top) * height
        anchor = ((left + right) * width / 2, (top + 0.45 * (bottom - top)) * height)
        candidates = []
        for index, table in enumerate(output):
            contour = np.array(table["polygon"], np.float32) * (width, height)
            contour = contour.astype(np.float32)
            distance = abs(cv2.pointPolygonTest(contour, anchor, True))
            scale = max(np.ptp(contour[:, 0]), np.ptp(contour[:, 1]))
            if distance <= max(0.35 * scale, 0.75 * chair_height):
                candidates.append((distance, index))
        candidates.sort()
        if not candidates or (
            len(candidates) > 1
            and candidates[1][0] - candidates[0][0] <= max(8, 0.15 * chair_width)
        ):
            continue
        table = output[candidates[0][1]]
        if len(table["seats"]) >= 32:
            continue
        box_width, box_height = right - left, bottom - top
        # Chair pixels are not the region occupied by a seated person's head and torso.
        polygon = rectangle(
            [
                left - 0.15 * box_width,
                top - 0.45 * box_height,
                right + 0.15 * box_width,
                top + 0.85 * box_height,
            ]
        )
        if cv2.contourArea(np.array(polygon, np.float32)) < 0.0001:
            continue
        table["seats"].append({"id": f"seat_{uuid4().hex}", "polygon": polygon})
        assigned += 1
    if not output:
        warnings.append("No tables detected. Try a clearer camera view or draw tabletop regions.")
    if len(chairs) > assigned:
        warnings.append(
            f"{len(chairs) - assigned} visible chairs left unassigned; check nearby tables."
        )
    if any(not table["seats"] for table in output):
        warnings.append("Some tables have no detected seats. Add missing seats before saving.")
    return {
        "width": width,
        "height": height,
        "tables": output,
        "warnings": warnings,
        "visible_chairs": len(chairs),
        "assigned_chairs": assigned,
    }
