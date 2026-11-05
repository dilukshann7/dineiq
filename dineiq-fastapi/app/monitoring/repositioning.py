"""Conservative, fixed-camera table identity and geometry verification."""

import copy
import math
from dataclasses import dataclass, field
from uuid import uuid4

import cv2
import numpy as np

from app.monitoring.registration import background_features, registration_status
from app.monitoring.rules import CLEANING_LABELS
from app.monitoring.suggestions import suggest_layout, unique_detections
from app.monitoring.time import OBSERVATION_TIMEOUT_SECONDS


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


def match_tables(frame, tables, features, detections, calibration=None):
    """Mutual unique best matches: appearance alone cannot disambiguate neighbours."""
    from app.calibration.contracts import Calibration

    calibration = calibration or Calibration()
    height, width = frame.shape[:2]
    dimensions = np.array([width, height])
    tracking = features.get("tracking", {})
    anchors = {table["id"]: table for table in tracking.get("anchors", tables)}
    profiles = tracking.get("profiles", {})
    candidates = [
        item
        for item in unique_detections(
            detections, "dining table", 0.65, calibration.layout_confidence
        )
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
    # Extra confidently segmented tables are confirmed separately as additions.
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
    return matches, bool(incompatible)


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


def project_seats(table, polygon, dimensions):
    """Move saved seat regions with their table without claiming new visual evidence."""
    old_center, old_sides, old_angle = shape(table["polygon"], dimensions)
    center, sides, angle = shape(polygon, dimensions)
    delta = math.radians((angle - old_angle + 90) % 180 - 90)
    rotation = np.array([[math.cos(delta), -math.sin(delta)], [math.sin(delta), math.cos(delta)]])
    scale = float(np.linalg.norm(sides) / max(1, np.linalg.norm(old_sides)))
    projected = []
    for seat in table["seats"]:
        points = (
            (contour(seat["polygon"]) * dimensions - old_center) @ rotation.T * scale + center
        ) / dimensions
        if np.any(points < 0) or np.any(points > 1):
            return None
        projected.append({"id": seat["id"], "polygon": points.tolist()})
    return projected


def follow_seats(table, polygon, suggested, dimensions):
    if len(suggested) != len(table["seats"]):
        return None
    projected = project_seats(table, polygon, dimensions)
    if projected is None:
        return None
    predicted = [contour(seat["polygon"]).mean(axis=0) * dimensions for seat in projected]
    _, sides, _ = shape(polygon, dimensions)
    targets = [contour(seat["polygon"]).mean(axis=0) * dimensions for seat in suggested]
    costs = np.linalg.norm(np.array(predicted)[:, None, :] - np.array(targets)[None, :, :], axis=2)
    assignment = unique_assignment(costs, 0.5 * np.linalg.norm(sides), 12)
    if assignment is None:
        return None
    return [
        {"id": seat["id"], "polygon": suggested[j]["polygon"]}
        for seat, j in zip(table["seats"], assignment, strict=True)
    ]


def seat_regions_match(first, second, minimum_overlap=0.8):
    """Compare seat geometry by stable seat key, independently of database row order."""
    previous = {seat["id"]: seat["polygon"] for seat in first}
    current = {seat["id"]: seat["polygon"] for seat in second}
    return previous.keys() == current.keys() and all(
        overlap(polygon, current[key]) >= minimum_overlap for key, polygon in previous.items()
    )


@dataclass
class PositionTracker:
    pending: dict = field(default_factory=dict)
    additions: list = field(default_factory=list)
    absences: dict = field(default_factory=dict)
    mismatch_since: float | None = None
    last_seen: float | None = None
    scene_pending: dict | None = None

    def recover_scene(self, frame, tables, features, detections, suggestions, now, calibration):
        """Learn a changed camera/OBS view only after its background and layout settle."""
        surfaces = unique_detections(
            detections, "dining table", 0.65, calibration.layout_confidence
        )
        if (
            len(surfaces) != len(suggestions)
            or any(not item.get("polygon") for item in surfaces)
            or any(not table["seats"] for table in suggestions)
            or (not suggestions and any(item["label"] == "person" for item in detections))
        ):
            self.scene_pending = None
            return None
        if not suggestions:
            blockers = [
                item
                for item in detections
                if item["label"] in CLEANING_LABELS | {"person", "chair"}
            ]
            profiles = features.get("tracking", {}).get("profiles", {})
            for table in tables:
                profile = profiles.get(table["id"])
                current_look = appearance(frame, table["polygon"], blockers)
                if (
                    not profile
                    or current_look is None
                    or appearance_distance(profile, current_look) <= 0.65
                ):
                    self.scene_pending = None
                    return None
        current = background_features(frame, suggestions)
        if registration_status(current, current, calibration) != "aligned":
            self.scene_pending = None
            return None
        pending = self.scene_pending
        stable = (
            pending is not None
            and registration_status(pending["features"], current, calibration) == "aligned"
            and len(pending["tables"]) == len(suggestions)
        )
        proposed = []
        if stable:
            matches, _ = match_tables(
                frame, pending["tables"], pending["features"], detections, calibration
            )
            dimensions = np.array([frame.shape[1], frame.shape[0]])
            for table in pending["tables"]:
                match = matches.get(table["id"])
                if match is None or overlap(table["polygon"], match["polygon"]) < 0.8:
                    stable = False
                    break
                suggested = max(
                    suggestions, key=lambda item: overlap(item["polygon"], match["polygon"])
                )
                seats = follow_seats(table, match["polygon"], suggested["seats"], dimensions)
                if seats is None or not seat_regions_match(table["seats"], seats, 0.65):
                    stable = False
                    break
                proposed.append({**table, "polygon": match["polygon"], "seats": seats})
        if not stable:
            pending = {
                "tables": copy.deepcopy(suggestions),
                "features": setup_tracking(frame, suggestions, current),
                "since": now,
                "count": 1,
            }
            self.scene_pending = pending
            return None
        pending["count"] += 1
        # Empty scenes need the same absence delay as individual table removals.
        minimum_seconds = 3 if proposed else 10
        if pending["count"] < 5 or now - pending["since"] < minimum_seconds:
            return None
        next_features = setup_tracking(frame, proposed, current)
        next_features["position_version"] = features.get("position_version", 0) + 1
        old_ids = {table["id"] for table in tables}
        new_ids = {table["id"] for table in proposed}
        self.scene_pending = None
        self.pending.clear()
        self.additions.clear()
        self.absences.clear()
        self.mismatch_since = None
        return {
            "tables": proposed,
            "features": next_features,
            "verified": new_ids,
            "trusted": new_ids,
            "changed": old_ids | new_ids,
            "added": new_ids,
            "removed": old_ids,
            "blocked": False,
            "status": "verified" if proposed else "verifying",
            "scene_reconfigured": True,
            "message": "Camera view and table setup updated automatically.",
        }

    def reconcile_membership(
        self, frame, tables, tracking, matches, suggestions, detections, background, now
    ):
        """Require repeated positive evidence; missed or obstructed tables are retained."""
        if background != "aligned":
            self.additions.clear()
            self.absences.clear()
            return set(), set()
        blockers = [
            item for item in detections if item["label"] in CLEANING_LABELS | {"person", "chair"}
        ]
        surfaces = [item for item in detections if item["label"] == "dining table"]
        removed, added = set(), set()
        for table in tables:
            key = table["id"]
            if key in matches:
                self.absences.pop(key, None)
                continue
            profile = tracking["profiles"].get(key)
            current = appearance(frame, table["polygon"], blockers)
            visible_surface = any(
                overlap(
                    table["polygon"],
                    item.get("polygon")
                    or [
                        [item["box"][0], item["box"][1]],
                        [item["box"][2], item["box"][1]],
                        [item["box"][2], item["box"][3]],
                        [item["box"][0], item["box"][3]],
                    ],
                )
                >= 0.1
                for item in surfaces
            )
            if (
                not profile
                or current is None
                or visible_surface
                or appearance_distance(profile, current) <= 0.65
            ):
                self.absences.pop(key, None)
                continue
            pending = self.absences.setdefault(key, {"since": now, "count": 0})
            pending["count"] += 1
            if pending["count"] >= 5 and now - pending["since"] >= 10:
                removed.add(key)
        tables[:] = [table for table in tables if table["id"] not in removed]
        for key in removed:
            tracking["profiles"].pop(key, None)
            self.absences.pop(key, None)
            self.pending.pop(key, None)
        # Unmatched existing tables may have moved. Resolve them before creating new identities.
        pending_additions = []
        if all(table["id"] in matches for table in tables):
            for proposed in suggestions:
                if not proposed["seats"] or any(
                    overlap(proposed["polygon"], table["polygon"]) >= 0.1
                    or (
                        table["id"] in matches
                        and overlap(proposed["polygon"], matches[table["id"]]["polygon"]) >= 0.1
                    )
                    for table in tables
                ):
                    continue
                # Only segmented, confident, unobstructed surfaces can create saved tables.
                detected = next(
                    (
                        item
                        for item in surfaces
                        if item.get("polygon")
                        and item["confidence"] >= 0.65
                        and overlap(item["polygon"], proposed["polygon"]) >= 0.8
                    ),
                    None,
                )
                look = appearance(frame, proposed["polygon"], blockers)
                if detected is None or look is None:
                    continue
                pending = next(
                    (
                        item
                        for item in self.additions
                        if overlap(item["table"]["polygon"], proposed["polygon"]) >= 0.8
                        and len(item["table"]["seats"]) == len(proposed["seats"])
                    ),
                    None,
                )
                if pending is not None:
                    self.additions.remove(pending)
                else:
                    pending = {"table": copy.deepcopy(proposed), "since": now, "count": 0}
                pending["count"] += 1
                if pending["count"] >= 3 and now - pending["since"] >= 2 and len(tables) < 16:
                    table = copy.deepcopy(proposed)
                    table["id"] = f"table_{uuid4().hex}"
                    names = {item["name"] for item in tables}
                    number = 1
                    while f"Table {number}" in names:
                        number += 1
                    table["name"] = f"Table {number}"
                    tables.append(table)
                    tracking["profiles"][table["id"]] = look
                    added.add(table["id"])
                else:
                    pending_additions.append(pending)
        self.additions = pending_additions
        return added, removed

    def evaluate(
        self,
        frame,
        tables,
        features,
        detections,
        background,
        now,
        *,
        force_verify=False,
        calibration=None,
    ):
        from app.calibration.contracts import Calibration

        calibration = calibration or Calibration()
        if self.last_seen is not None and now - self.last_seen > OBSERVATION_TIMEOUT_SECONDS:
            self.pending.clear()
            self.additions.clear()
            self.absences.clear()
            self.mismatch_since = None
            self.scene_pending = None
        self.last_seen = now
        output = copy.deepcopy(tables)
        next_features = copy.deepcopy(features)
        tracking = next_features.setdefault(
            "tracking", {"anchors": copy.deepcopy(tables), "profiles": {}}
        )
        suggestions = suggest_layout(
            {"width": frame.shape[1], "height": frame.shape[0], "detections": detections},
            calibration,
        )["tables"]
        if background != "aligned":
            recovered = self.recover_scene(
                frame, tables, features, detections, suggestions, now, calibration
            )
            if recovered is not None:
                return recovered
        else:
            self.scene_pending = None
        matches, mismatch = match_tables(frame, tables, features, detections, calibration)
        added, removed = self.reconcile_membership(
            frame, output, tracking, matches, suggestions, detections, background, now
        )
        if added or removed:
            tracking["anchors"] = copy.deepcopy(output)
            matches, mismatch = match_tables(frame, output, next_features, detections, calibration)
        # Known absences are being confirmed automatically, rather than requiring setup clicks.
        if self.absences and background == "aligned":
            mismatch = False
        mismatch = background == "moved" or (background == "aligned" and mismatch)
        if mismatch:
            if self.mismatch_since is None:
                self.mismatch_since = now
        else:
            self.mismatch_since = None
        blocked = (
            self.mismatch_since is not None
            and now - self.mismatch_since >= calibration.mismatch_seconds
        )
        verified, changed, trusted = set(), set(added | removed), set()
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
                seats is not None and not seat_regions_match(table["seats"], seats)
            )
            bootstrap = not tracking["profiles"].get(key)
            if not moved and not bootstrap and not force_verify:
                trusted.add(key)
                if seats is not None:
                    verified.add(key)
                self.pending.pop(key, None)
                continue
            projected = seats if seats is not None else project_seats(table, polygon, dimensions)
            if projected is None:
                self.pending.pop(key, None)
                continue
            proposal = {"polygon": polygon, "seats": projected}
            pending = self.pending.get(key)
            stable = (
                pending
                and overlap(pending["polygon"], polygon) >= 0.9
                and seat_regions_match(pending["seats"], proposal["seats"])
            )
            if not stable:
                pending = {**proposal, "since": now, "count": 0}
            pending["count"] += 1
            self.pending[key] = pending
            if pending["count"] < 3 or now - pending["since"] < 1:
                continue
            if moved:
                table.update(proposal)
                anchors[key] = copy.deepcopy(table)
                changed.add(key)
            if bootstrap:
                tracking["profiles"][key] = match["appearance"]
            trusted.add(key)
            if seats is not None:
                verified.add(key)
        if changed:
            tracking["anchors"] = [anchors[table["id"]] for table in output]
            next_features["position_version"] = features.get("position_version", 0) + 1
        return {
            "tables": output,
            "features": next_features,
            "verified": verified,
            "trusted": trusted,
            "changed": changed,
            "added": added,
            "removed": removed,
            "message": (
                "Detecting tables in the changed camera view. Keep the view steady."
                if self.scene_pending is not None
                else "Waiting for a steady view with visible tables, chairs, and background detail."
                if background != "aligned"
                else "Verifying table and seat positions automatically."
                if len(verified) != len(output)
                else ""
            ),
            "blocked": blocked,
            "status": "recalibration_required"
            if blocked
            else ("verified" if output and len(verified) == len(output) else "verifying"),
        }
