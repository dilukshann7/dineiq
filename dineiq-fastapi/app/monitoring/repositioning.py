"""Conservative, fixed-camera table identity and geometry verification."""

import copy
import math
from dataclasses import dataclass, field

import cv2
import numpy as np

from app.monitoring.rules import CLEANING_LABELS
from app.monitoring.suggestions import suggest_layout, unique_detections


def contour(polygon):
    return np.array(polygon, dtype=np.float32)


def shape(polygon, dimensions):
    points = (contour(polygon) * dimensions).astype(np.float32)
    center, sides, angle = cv2.minAreaRect(points)
    if sides[0] < sides[1]:
        sides = sides[::-1]
        angle += 90
    return np.array(center), np.array(sides), angle


def overlap(first, second):
    a, b = cv2.convexHull(contour(first)), cv2.convexHull(contour(second))
    intersection, _ = cv2.intersectConvexConvex(a, b)
    return intersection / max(1e-9, cv2.contourArea(a) + cv2.contourArea(b) - intersection)


def appearance(frame, polygon, obstructions=()):
    """Compact colour reference from visible interior pixels; never retain camera images."""
    height, width = frame.shape[:2]
    scale = min(1, 640 / width)
    reduced = cv2.resize(frame, (round(width * scale), round(height * scale)))
    h, w = reduced.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    cv2.fillPoly(mask, [np.rint(contour(polygon) * (w, h)).astype(np.int32)], 255)
    mask = cv2.erode(mask, np.ones((5, 5), np.uint8))
    total = np.count_nonzero(mask)
    for item in obstructions:
        points = item.get("polygon")
        if not points:
            left, top, right, bottom = item["box"]
            points = [[left, top], [right, top], [right, bottom], [left, bottom]]
        cv2.fillPoly(mask, [np.rint(contour(points) * (w, h)).astype(np.int32)], 0)
    if total < 32 or np.count_nonzero(mask) < max(32, 0.55 * total):
        return None
    hsv = cv2.cvtColor(reduced, cv2.COLOR_BGR2HSV)
    histogram = cv2.calcHist([hsv], [0, 1], mask, [18, 8], [0, 180, 0, 256])
    # Smooth bin boundaries so modest illumination changes do not change identity.
    histogram = cv2.GaussianBlur(histogram, (3, 3), 0)
    histogram /= max(float(histogram.sum()), 1e-9)
    return histogram.reshape(-1).tolist()


def appearance_distance(first, second):
    return cv2.compareHist(
        np.array(first, np.float32), np.array(second, np.float32), cv2.HISTCMP_BHATTACHARYYA
    )


def setup_tracking(frame, tables, features=None):
    result = copy.deepcopy(features or {})
    result["tracking"] = {
        "anchors": copy.deepcopy(tables),
        "profiles": {table["id"]: appearance(frame, table["polygon"]) for table in tables},
    }
    result["position_version"] = 0
    return result


def match_tables(frame, tables, features, detections):
    """Mutual unique best matches: appearance alone cannot disambiguate neighbours."""
    height, width = frame.shape[:2]
    dimensions = np.array([width, height])
    tracking = features.get("tracking", {})
    anchors = {table["id"]: table for table in tracking.get("anchors", tables)}
    profiles = tracking.get("profiles", {})
    candidates = [
        item
        for item in unique_detections(detections, "dining table", 0.65)
        if item.get("polygon") and len(item["polygon"]) >= 3
    ]
    blockers = [
        item for item in detections if item["label"] in CLEANING_LABELS | {"person", "chair"}
    ]
    polygons = [
        cv2.convexHull(contour(item["polygon"])).reshape(-1, 2).tolist() for item in candidates
    ]
    looks = [appearance(frame, polygon, blockers) for polygon in polygons]
    costs = np.full((len(tables), len(candidates)), np.inf)
    for i, table in enumerate(tables):
        anchor = anchors[table["id"]]
        origin, sides, _ = shape(anchor["polygon"], dimensions)
        last, _, _ = shape(table["polygon"], dimensions)
        diagonal = max(1, np.linalg.norm(sides))
        original_area = max(1e-9, cv2.contourArea(contour(anchor["polygon"])))
        for j, polygon in enumerate(polygons):
            if looks[j] is None:
                continue
            center, current_sides, _ = shape(polygon, dimensions)
            area_ratio = cv2.contourArea(contour(polygon)) / original_area
            aspect_ratio = (current_sides[0] / max(1, current_sides[1])) / (
                sides[0] / max(1, sides[1])
            )
            distance = np.linalg.norm(center - origin) / diagonal
            look = (
                appearance_distance(profiles[table["id"]], looks[j])
                if profiles.get(table["id"])
                else 0
            )
            if distance > 1.1 or not 0.5 <= area_ratio <= 1.9 or not 0.5 <= aspect_ratio <= 2:
                continue
            if look > 0.45:
                continue
            costs[i, j] = (
                0.65 * distance
                + 0.35 * np.linalg.norm(center - last) / diagonal
                + 0.25 * abs(math.log(area_ratio))
                + 0.15 * abs(math.log(aspect_ratio))
                + 0.5 * look
            )
    matches = {}
    used = set()
    for i, table in enumerate(tables):
        if not len(candidates):
            continue
        j = int(np.argmin(costs[i]))
        score = costs[i, j]
        if not np.isfinite(score):
            continue
        alternatives = np.delete(costs[i], j)
        rivals = np.delete(costs[:, j], i)
        if (len(alternatives) and alternatives.min() - score < 0.18) or (
            len(rivals) and rivals.min() - score < 0.18
        ):
            continue
        matches[table["id"]] = {**candidates[j], "polygon": polygons[j], "appearance": looks[j]}
        used.add(j)
    # An extra confidently segmented table is positive evidence, unlike a missed detection.
    extra = len(matches) == len(tables) and any(
        j not in used and item["confidence"] >= 0.65 for j, item in enumerate(candidates)
    )
    incompatible = False
    for table in tables:
        if table["id"] in matches:
            continue
        profile = profiles.get(table["id"])
        for j, polygon in enumerate(polygons):
            if overlap(table["polygon"], polygon) >= 0.5 and looks[j] is not None and profile:
                incompatible |= appearance_distance(profile, looks[j]) > 0.45
        # A missing detection alone is insufficient. Require visible changed surface pixels.
        current = appearance(frame, table["polygon"], blockers)
        has_surface = any(overlap(table["polygon"], polygon) >= 0.2 for polygon in polygons)
        if profile and current is not None and not has_surface:
            incompatible |= appearance_distance(profile, current) > 0.65
    return matches, bool(extra or incompatible)


def minimum_assignment(costs):
    """Square Hungarian assignment, bounded by the existing 32-seat limit."""
    size = len(costs)
    u, v = np.zeros(size + 1), np.zeros(size + 1)
    owner, path = np.zeros(size + 1, int), np.zeros(size + 1, int)
    for row in range(1, size + 1):
        owner[0] = row
        column = 0
        best, used = np.full(size + 1, np.inf), np.zeros(size + 1, bool)
        while True:
            used[column] = True
            current = owner[column]
            delta, next_column = np.inf, 0
            for candidate in range(1, size + 1):
                if used[candidate]:
                    continue
                cost = costs[current - 1, candidate - 1] - u[current] - v[candidate]
                if cost < best[candidate]:
                    best[candidate], path[candidate] = cost, column
                if best[candidate] < delta:
                    delta, next_column = best[candidate], candidate
            if not np.isfinite(delta):
                return None
            for candidate in range(size + 1):
                if used[candidate]:
                    u[owner[candidate]] += delta
                    v[candidate] -= delta
                else:
                    best[candidate] -= delta
            column = next_column
            if not owner[column]:
                break
        while column:
            previous = path[column]
            owner[column] = owner[previous]
            column = previous
    assignment = [0] * size
    for column in range(1, size + 1):
        assignment[owner[column] - 1] = column - 1
    return assignment


def unique_assignment(costs, maximum, margin):
    bounded = np.where(costs <= maximum, costs, np.inf)
    assignment = minimum_assignment(bounded)
    if assignment is None:
        return None
    best = sum(costs[i, j] for i, j in enumerate(assignment))
    for i, j in enumerate(assignment):
        alternative = bounded.copy()
        alternative[i, j] = np.inf
        runner_up = minimum_assignment(alternative)
        if (
            runner_up is not None
            and sum(costs[row, col] for row, col in enumerate(runner_up)) - best < margin
        ):
            return None
    return assignment


def follow_seats(table, polygon, suggested, dimensions):
    if len(suggested) != len(table["seats"]):
        return None
    old_center, old_sides, old_angle = shape(table["polygon"], dimensions)
    center, sides, angle = shape(polygon, dimensions)
    delta = math.radians((angle - old_angle + 90) % 180 - 90)
    rotation = np.array([[math.cos(delta), -math.sin(delta)], [math.sin(delta), math.cos(delta)]])
    scale = float(np.linalg.norm(sides) / max(1, np.linalg.norm(old_sides)))
    predicted = []
    for seat in table["seats"]:
        points = (
            (contour(seat["polygon"]) * dimensions - old_center) @ rotation.T * scale + center
        ) / dimensions
        predicted.append(points.mean(axis=0) * dimensions)
    targets = [contour(seat["polygon"]).mean(axis=0) * dimensions for seat in suggested]
    costs = np.linalg.norm(np.array(predicted)[:, None, :] - np.array(targets)[None, :, :], axis=2)
    assignment = unique_assignment(costs, 0.5 * np.linalg.norm(sides), 12)
    if assignment is None:
        return None
    return [
        {"id": seat["id"], "polygon": suggested[j]["polygon"]}
        for seat, j in zip(table["seats"], assignment, strict=True)
    ]


@dataclass
class PositionTracker:
    pending: dict = field(default_factory=dict)
    mismatch_since: float | None = None
    last_seen: float | None = None

    def evaluate(self, frame, tables, features, detections, background, now, *, force_verify=False):
        if self.last_seen is not None and now - self.last_seen > 2:
            self.pending.clear()
            self.mismatch_since = None
        self.last_seen = now
        matches, mismatch = match_tables(frame, tables, features, detections)
        mismatch = background == "moved" or (background == "aligned" and mismatch)
        if mismatch:
            if self.mismatch_since is None:
                self.mismatch_since = now
        else:
            self.mismatch_since = None
        blocked = self.mismatch_since is not None and now - self.mismatch_since >= 10
        output, verified, changed, trusted = copy.deepcopy(tables), set(), set(), set()
        next_features = copy.deepcopy(features)
        tracking = next_features.setdefault(
            "tracking", {"anchors": copy.deepcopy(tables), "profiles": {}}
        )
        suggestions = suggest_layout(
            {"width": frame.shape[1], "height": frame.shape[0], "detections": detections}
        )["tables"]
        dimensions = np.array([frame.shape[1], frame.shape[0]])
        anchors = {table["id"]: table for table in tracking["anchors"]}
        for table in output:
            key = table["id"]
            match = matches.get(key)
            if match is None or background != "aligned" or mismatch:
                self.pending.pop(key, None)
                continue
            polygon = match["polygon"]
            proposed = max(
                suggestions, key=lambda item: overlap(item["polygon"], polygon), default=None
            )
            seats = (
                follow_seats(anchors[key], polygon, proposed["seats"], dimensions)
                if proposed
                else None
            )
            moved = overlap(table["polygon"], polygon) < 0.9 or (
                seats is not None
                and any(
                    overlap(old["polygon"], new["polygon"]) < 0.8
                    for old, new in zip(table["seats"], seats, strict=True)
                )
            )
            bootstrap = not tracking["profiles"].get(key)
            if not moved and not bootstrap and not force_verify:
                trusted.add(key)
                if seats is not None:
                    verified.add(key)
                self.pending.pop(key, None)
                continue
            proposal = {"polygon": polygon, "seats": seats or table["seats"]}
            pending = self.pending.get(key)
            stable = (
                pending
                and overlap(pending["polygon"], polygon) >= 0.9
                and all(
                    overlap(a["polygon"], b["polygon"]) >= 0.8
                    for a, b in zip(pending["seats"], proposal["seats"], strict=True)
                )
            )
            if not stable:
                pending = {**proposal, "since": now, "count": 0}
            pending["count"] += 1
            self.pending[key] = pending
            if pending["count"] < 3 or now - pending["since"] < 1:
                continue
            if moved:
                table.update(proposal)
                changed.add(key)
            if bootstrap:
                tracking["profiles"][key] = match["appearance"]
            trusted.add(key)
            if seats is not None:
                verified.add(key)
        if changed:
            next_features["position_version"] = features.get("position_version", 0) + 1
        return {
            "tables": output,
            "features": next_features,
            "verified": verified,
            "trusted": trusted,
            "changed": changed,
            "blocked": blocked,
            "status": "recalibration_required"
            if blocked
            else ("verified" if len(verified) == len(tables) else "verifying"),
        }
