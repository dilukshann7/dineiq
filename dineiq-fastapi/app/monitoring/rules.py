from dataclasses import dataclass, field

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


def observe_tables(tables: list[dict], detections: list[dict]) -> dict[str, dict]:
    import cv2
    import numpy as np

    table_masks = {table["id"]: polygon_mask(table["polygon"]) for table in tables}
    people = [item for item in detections if item["label"] == "person"]
    detected_tables = [item for item in detections if item["label"] == "dining table"]
    person_masks = [polygon_mask(p.get("polygon") or box_polygon(p["box"])) for p in people]
    obstruction = (
        np.logical_or.reduce(person_masks) if person_masks else np.zeros((GRID, GRID), dtype=bool)
    )
    output = {}
    assignments: dict[int, list[tuple[str, str]]] = {}
    seat_people: dict[tuple[str, str], list[int]] = {}
    table_matches: dict[int, list[str]] = {}
    for table in tables:
        table_id = table["id"]
        mask = table_masks[table_id]
        area = max(1, mask.sum())
        coverages = [
            float((mask & polygon_mask(item.get("polygon"))).sum() / area)
            for item in detected_tables
        ]
        best = max(range(len(coverages)), key=coverages.__getitem__) if coverages else None
        coverage = coverages[best] if best is not None else 0
        if best is not None and coverage >= 0.2:
            table_matches.setdefault(best, []).append(table_id)
        output[table_id] = {
            "count": 0,
            "items": [],
            "valid": coverage >= 0.2,
            "clear_view": bool(coverage >= 0.8 and (mask & obstruction).sum() / area < 0.1),
            "reason": "" if coverage >= 0.2 else "Table not visible",
        }
        for seat in table["seats"]:
            seat_mask = polygon_mask(seat["polygon"])
            seat_area = max(1, seat_mask.sum())
            seat_height = max(p[1] for p in seat["polygon"]) - min(p[1] for p in seat["polygon"])
            contour = np.array(seat["polygon"], dtype=np.float32)
            for index, person in enumerate(people):
                left, top, right, bottom = person["box"]
                center = ((left + right) / 2, (top + bottom) / 2)
                if cv2.pointPolygonTest(contour, center, False) < 0:
                    continue
                if bottom - top > 1.35 * seat_height:
                    continue
                if (seat_mask & polygon_mask(box_polygon(person["box"]))).sum() / seat_area < 0.25:
                    continue
                pair = (table_id, seat["id"])
                assignments.setdefault(index, []).append(pair)
                seat_people.setdefault(pair, []).append(index)

    for candidates in table_matches.values():
        if len(candidates) > 1:
            for table_id in candidates:
                output[table_id].update(valid=False, reason="Table outlines overlap ambiguously")
    for seats in assignments.values():
        ambiguous = len(seats) != 1 or any(len(seat_people[seat]) != 1 for seat in seats)
        for table_id, _ in seats:
            if ambiguous:
                output[table_id].update(valid=False, reason="Ambiguous seat assignment")
            else:
                output[table_id]["count"] += 1

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
            table_id for table_id, overlap in overlaps.items() if has_mask and overlap / area >= 0.5
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
            "count": count,
            "capacity": self.capacity,
            "occupancy": occupancy,
            "cleanliness": self.cleanliness if self.ready else "unknown",
            "manual": self.manual_clean is not None,
            "valid": self.ready,
            "reason": self.reason,
            "evidence": self.items.copy(),
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
        if self.last_seen is not None and now - self.last_seen > 2:
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
                10 if count > (self.confirmed_count or 0) or (not self.ready and count > 0) else 30
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
            elif now - self.clean_since >= (5 if candidate == "needs_cleaning" else 10):
                self.cleanliness = candidate
        return self.snapshot()
