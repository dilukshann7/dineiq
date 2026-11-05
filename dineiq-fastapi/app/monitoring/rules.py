from dataclasses import dataclass, field

from app.calibration.contracts import Calibration
from app.monitoring.time import OBSERVATION_TIMEOUT_SECONDS

GRID = 512
CLEANING_LABELS = {
    "bottle",
    "wine glass",
    "cup",
    "fork",
    "knife",
    "spoon",
    "bowl",
    "banana",
    "apple",
    "sandwich",
    "orange",
    "broccoli",
    "carrot",
    "hot dog",
    "pizza",
    "donut",
    "cake",
}


def polygon_mask(points):
    import cv2
    import numpy as np

    mask = np.zeros((GRID, GRID), np.uint8)
    if points and len(points) >= 3:
        contour = np.rint(np.array(points) * (GRID - 1)).astype(np.int32)
        cv2.fillPoly(mask, [contour], 1)
    return mask.astype(bool)


def box_polygon(box):
    left, top, right, bottom = box
    return [[left, top], [right, top], [right, bottom], [left, bottom]]


def observe_tables(
    tables: list[dict],
    detections: list[dict],
    calibration: Calibration | None = None,
    *,
    diagnostics=False,
) -> dict[str, dict]:
    import cv2
    import numpy as np

    calibration = calibration or Calibration()
    table_masks = {table["id"]: polygon_mask(table["polygon"]) for table in tables}
    people = [item for item in detections if item["label"] == "person"]
    detected_table_masks = [
        polygon_mask(item.get("polygon")) for item in detections if item["label"] == "dining table"
    ]
    person_masks = [polygon_mask(p.get("polygon") or box_polygon(p["box"])) for p in people]
    obstruction = (
        np.logical_or.reduce(person_masks) if person_masks else np.zeros((GRID, GRID), dtype=bool)
    )
    chair_masks = [
        polygon_mask(item.get("polygon")) for item in detections if item["label"] == "chair"
    ]
    chairs = (
        np.logical_or.reduce(chair_masks) if chair_masks else np.zeros((GRID, GRID), dtype=bool)
    )
    output = {}
    assignments: dict[int, list[tuple[str, str]]] = {}
    seat_people: dict[tuple[str, str], list[int]] = {}
    candidate_details: dict[tuple[int, tuple[str, str]], float] = {}
    table_matches: dict[int, list[str]] = {}
    for table in tables:
        table_id = table["id"]
        mask = table_masks[table_id]
        area = max(1, mask.sum())
        coverages = [float((mask & detected).sum() / area) for detected in detected_table_masks]
        best = max(range(len(coverages)), key=coverages.__getitem__) if coverages else None
        coverage = coverages[best] if best is not None else 0
        # Saved convex outlines bridge chair backs that segmentation correctly excludes.
        # Discount only segmented chair pixels; boxes can cover real tabletop space.
        surface = mask & ~chairs
        surface_area = int(surface.sum())
        surface_coverage = (
            float((surface & detected_table_masks[best]).sum() / max(1, surface_area))
            if best is not None
            else 0
        )
        if best is not None and coverage >= calibration.minimum_table_coverage:
            table_matches.setdefault(best, []).append(table_id)
        output[table_id] = {
            "count": 0,
            "items": [],
            "valid": coverage >= calibration.minimum_table_coverage,
            "clear_view": bool(
                coverage >= calibration.clear_table_coverage
                and surface_area / area >= calibration.visible_surface
                and surface_coverage >= calibration.surface_coverage
                and (mask & obstruction).sum() / area < calibration.maximum_obstruction
            ),
            "reason": "" if coverage >= calibration.minimum_table_coverage else "Table not visible",
        }
        if diagnostics:
            output[table_id]["diagnostics"] = {
                "table_coverage": coverage,
                "visible_surface": surface_area / area,
                "surface_coverage": surface_coverage,
                "person_obstruction": float((mask & obstruction).sum() / area),
                "assignments": [],
            }
        for seat in table["seats"]:
            seat_mask = polygon_mask(seat["polygon"])
            seat_area = max(1, seat_mask.sum())
            seat_height = max(p[1] for p in seat["polygon"]) - min(p[1] for p in seat["polygon"])
            contour = np.array(seat["polygon"], dtype=np.float32)
            seat_center_x = float(np.mean(contour[:, 0]))
            seat_center_y = float(np.mean(contour[:, 1]))
            for index, person in enumerate(people):
                left, top, right, bottom = person["box"]
                center = ((left + right) / 2, (top + bottom) / 2)
                overlap = float(
                    (seat_mask & polygon_mask(box_polygon(person["box"]))).sum() / seat_area
                )
                dist = cv2.pointPolygonTest(contour, center, True)
                seat_center_in_person = (
                    left <= seat_center_x <= right and top <= seat_center_y <= bottom
                )
                center_near_seat = dist >= -0.015 or seat_center_in_person
                reason = (
                    "Person center outside seat"
                    if not center_near_seat
                    else "Person too tall for seat"
                    if bottom - top > calibration.person_height_ratio * seat_height
                    else "Insufficient seat overlap"
                    if overlap < calibration.seat_overlap
                    else "Assigned"
                )
                if diagnostics:
                    output[table_id]["diagnostics"]["assignments"].append(
                        {
                            "person_index": index,
                            "seat_id": seat["id"],
                            "overlap": overlap,
                            "reason": reason,
                        }
                    )
                if reason != "Assigned":
                    continue
                pair = (table_id, seat["id"])
                assignments.setdefault(index, []).append(pair)
                seat_people.setdefault(pair, []).append(index)
                score = (
                    overlap + (0.5 if seat_center_in_person else 0.0) + (0.1 if dist >= 0 else 0.0)
                )
                candidate_details[(index, pair)] = score

    for candidates in table_matches.values():
        if len(candidates) > 1:
            for table_id in candidates:
                output[table_id].update(valid=False, reason="Table outlines overlap ambiguously")

    cross_table_conflicts = set()
    for index, seats in assignments.items():
        matching_tables = {table_id for table_id, _ in seats}
        if len(matching_tables) > 1:
            cross_table_conflicts.update(matching_tables)
            for table_id in matching_tables:
                output[table_id].update(valid=False, reason="Ambiguous seat assignment")
                if diagnostics:
                    for assignment in output[table_id]["diagnostics"]["assignments"]:
                        if (
                            assignment["person_index"] == index
                            and assignment["reason"] == "Assigned"
                        ):
                            assignment["reason"] = "Ambiguous seat assignment"

    for table in tables:
        table_id = table["id"]
        if not output[table_id]["valid"] or table_id in cross_table_conflicts:
            continue
        table_candidates = [
            (candidate_details[(index, (table_id, seat_id))], index, seat_id)
            for index, seats in assignments.items()
            for t_id, seat_id in seats
            if t_id == table_id
        ]
        table_candidates.sort(key=lambda item: item[0], reverse=True)
        assigned_people = set()
        assigned_seats = set()
        for _score, index, seat_id in table_candidates:
            if index not in assigned_people and seat_id not in assigned_seats:
                assigned_people.add(index)
                assigned_seats.add(seat_id)
                output[table_id]["count"] += 1

        candidate_people_for_table = {
            index
            for index, seats in assignments.items()
            if any(t_id == table_id for t_id, _ in seats)
        }
        unseated = candidate_people_for_table - assigned_people
        if unseated:
            output[table_id].update(valid=False, reason="Ambiguous seat assignment")
            if diagnostics:
                for assignment in output[table_id]["diagnostics"]["assignments"]:
                    if (
                        assignment["person_index"] in unseated
                        and assignment["reason"] == "Assigned"
                    ):
                        assignment["reason"] = "Ambiguous seat assignment"

    for item in detections:
        if item["label"] not in CLEANING_LABELS:
            continue
        has_mask = bool(item.get("polygon")) and len(item["polygon"]) >= 3
        mask = polygon_mask(item["polygon"] if has_mask else box_polygon(item["box"]))
        area = max(1, mask.sum())
        overlaps = {
            table_id: int((mask & surface).sum()) for table_id, surface in table_masks.items()
        }
        owners = [
            table_id
            for table_id, overlap in overlaps.items()
            if has_mask and overlap / area >= calibration.object_overlap
        ]
        if len(owners) == 1:
            output[owners[0]]["items"].append(item["label"])
        # Missing masks and uncertain edge attribution cannot become absence evidence.
        for table_id, overlap in overlaps.items():
            if overlap and (len(owners) != 1 or table_id != owners[0]):
                output[table_id]["clear_view"] = False
    for observation in output.values():
        observation["items"] = sorted(set(observation["items"]))
    return output


@dataclass
class TableMachine:
    capacity: int
    calibration: Calibration = field(default_factory=Calibration)
    calibration_revision: int | None = None
    confirmed_count: int | None = None
    pending_count: int | None = None
    count_since: float | None = None
    clean_candidate: str | None = None
    clean_since: float | None = None
    cleanliness: str = "unknown"
    manual_clean: str | None = None
    last_seen: float | None = None
    ready: bool = False
    reason: str = "Waiting for observations"
    items: list[str] = field(default_factory=list)
    arrival_at: float | None = None

    def snapshot(self) -> dict:
        count = self.confirmed_count if self.ready else None
        occupancy = (
            "unknown"
            if count is None
            else ("empty" if count == 0 else "full" if count >= self.capacity else "partial")
        )
        return {
            "calibration_revision": self.calibration_revision,
            "count": count,
            "capacity": self.capacity,
            "occupancy": occupancy,
            "cleanliness": self.cleanliness if self.ready else "unknown",
            "manual": self.manual_clean is not None,
            "valid": self.ready,
            "reason": self.reason,
            "evidence": self.items.copy(),
        }

    def recalibrate(self, calibration: Calibration, revision=None):
        self.calibration = calibration
        self.calibration_revision = revision
        self.invalidate("Calibration changed; confirming observations")

    def countdowns(self, now):
        increasing = self.pending_count is not None and self.pending_count > (
            self.confirmed_count or 0
        )
        count_delay = (
            self.calibration.occupancy_increase_seconds
            if increasing
            else self.calibration.occupancy_decrease_seconds
        )
        clean_delay = (
            self.calibration.cleaning_seconds
            if self.clean_candidate == "needs_cleaning"
            else self.calibration.clear_seconds
        )
        return {
            "occupancy_seconds": max(0, count_delay - (now - self.count_since))
            if self.count_since is not None
            else None,
            "cleanliness_seconds": max(0, clean_delay - (now - self.clean_since))
            if self.clean_since is not None
            else None,
        }

    def invalidate(self, reason: str) -> dict:
        self.ready = False
        self.pending_count = None
        self.count_since = None
        self.clean_candidate = None
        self.clean_since = None
        self.cleanliness = "unknown"
        self.items = []
        self.reason = reason
        return self.snapshot()

    def correct(self, action: str) -> dict:
        self.manual_clean = None if action == "automatic" else action
        self.clean_candidate = None
        self.clean_since = None
        self.cleanliness = (
            "not_assessed" if self.confirmed_count else self.manual_clean or "unknown"
        )
        return self.snapshot()

    def observe(self, observation: dict, now: float) -> dict:
        if self.last_seen is not None and now - self.last_seen > OBSERVATION_TIMEOUT_SECONDS:
            self.invalidate("Observation gap; confirming again")
        if not observation["valid"]:
            return self.invalidate(observation["reason"])
        self.last_seen = now
        count = observation["count"]
        self.items = observation["items"].copy()
        if count != self.confirmed_count or not self.ready:
            if self.pending_count != count:
                self.pending_count, self.count_since = count, now
            delay = (
                self.calibration.occupancy_increase_seconds
                if count > (self.confirmed_count or 0) or (not self.ready and count > 0)
                else self.calibration.occupancy_decrease_seconds
            )
            if now - self.count_since >= delay:
                if count > 0 and self.arrival_at is None:
                    self.arrival_at = self.count_since
                elif count == 0:
                    self.arrival_at = None
                if count > (self.confirmed_count or 0):
                    self.manual_clean = None
                self.confirmed_count = count
                self.ready = True
                self.pending_count = None
                self.count_since = None
                self.clean_candidate = None
                self.clean_since = None
            else:
                self.reason = "Confirming occupancy"
        else:
            self.pending_count = None
            self.count_since = None
        if not self.ready:
            return self.snapshot()
        self.reason = "Confirming occupancy" if count != self.confirmed_count else ""
        if count > 0 or self.confirmed_count > 0:
            self.cleanliness = "not_assessed"
            self.clean_candidate = None
            self.clean_since = None
        elif self.manual_clean:
            self.cleanliness = self.manual_clean
        else:
            candidate = (
                "needs_cleaning"
                if self.items
                else ("looks_clear" if observation["clear_view"] else None)
            )
            if candidate != self.clean_candidate:
                self.clean_candidate, self.clean_since = candidate, now
                self.cleanliness = "unknown"
            if candidate is None:
                self.cleanliness = "unknown"
                self.reason = "Tabletop is obscured"
            elif now - self.clean_since >= (
                self.calibration.cleaning_seconds
                if candidate == "needs_cleaning"
                else self.calibration.clear_seconds
            ):
                self.cleanliness = candidate
        return self.snapshot()
