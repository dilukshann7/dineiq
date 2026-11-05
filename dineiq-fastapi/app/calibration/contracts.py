from pydantic import ConfigDict, Field, field_validator, model_validator

from app.auth.contracts import Input
from app.monitoring.contracts import Identifier


def control(default, minimum, maximum, group, label, description, unit="ratio"):
    return Field(
        default=default,
        ge=minimum,
        le=maximum,
        description=description,
        json_schema_extra={"group": group, "label": label, "unit": unit},
    )


class Calibration(Input):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)
    person_confidence: float = control(
        0.2,
        0.05,
        0.95,
        "Detection",
        "Person confidence",
        "Lower values retain more possible people.",
    )
    table_confidence: float = control(
        0.2, 0.05, 0.95, "Detection", "Table confidence", "Minimum confidence for table detections."
    )
    chair_confidence: float = control(
        0.2, 0.05, 0.95, "Detection", "Chair confidence", "Minimum confidence for chair detections."
    )
    object_confidence: float = control(
        0.2,
        0.05,
        0.95,
        "Detection",
        "Cleaning-object confidence",
        "Minimum confidence for leftover objects.",
    )
    layout_confidence: float = control(
        0.35,
        0.05,
        0.95,
        "Detection",
        "Layout matching confidence",
        "Additional confidence required for table and chair layout candidates.",
    )
    seat_overlap: float = control(
        0.25,
        0.05,
        0.95,
        "Seat matching",
        "Minimum seat overlap",
        "Fraction of the seat region covered by a person's box.",
    )
    person_height_ratio: float = control(
        1.35,
        0.5,
        3,
        "Seat matching",
        "Maximum person height",
        "Maximum person height divided by seat-region height.",
        "multiple",
    )
    minimum_table_coverage: float = control(
        0.2,
        0.05,
        0.8,
        "Visibility",
        "Minimum table coverage",
        "Required detected coverage to trust a configured table.",
    )
    clear_table_coverage: float = control(
        0.7,
        0.5,
        0.95,
        "Visibility",
        "Clear-view table coverage",
        "Required table coverage before assessing an empty surface.",
    )
    visible_surface: float = control(
        0.7,
        0.5,
        0.95,
        "Visibility",
        "Visible surface",
        "Minimum surface remaining after excluding segmented chairs.",
    )
    surface_coverage: float = control(
        0.8,
        0.5,
        0.95,
        "Visibility",
        "Detected surface coverage",
        "Required detection coverage of the remaining surface.",
    )
    maximum_obstruction: float = control(
        0.1,
        0.01,
        0.5,
        "Visibility",
        "Maximum person obstruction",
        "Maximum table area obscured by people for a clear view.",
    )
    object_overlap: float = control(
        0.5,
        0.3,
        0.95,
        "Visibility",
        "Cleaning-object overlap",
        "Fraction of an object's mask inside one table.",
    )
    occupancy_increase_seconds: float = control(
        10,
        1,
        120,
        "Timing",
        "Occupancy increase",
        "Continuous evidence required before increasing occupancy.",
        "seconds",
    )
    occupancy_decrease_seconds: float = control(
        30,
        1,
        180,
        "Timing",
        "Occupancy decrease",
        "Continuous evidence required before decreasing occupancy.",
        "seconds",
    )
    cleaning_seconds: float = control(
        5,
        1,
        120,
        "Timing",
        "Cleaning needed",
        "Continuous leftover-object evidence required.",
        "seconds",
    )
    clear_seconds: float = control(
        10, 1, 120, "Timing", "Looks clear", "Continuous clear-view evidence required.", "seconds"
    )
    camera_displacement: float = control(
        0.02,
        0.005,
        0.05,
        "Camera alignment",
        "Camera displacement",
        "Maximum displacement as a fraction of the image diagonal.",
    )
    mismatch_seconds: float = control(
        10,
        1,
        60,
        "Camera alignment",
        "Layout mismatch delay",
        "Persistent mismatch before requiring recalibration.",
        "seconds",
    )

    @model_validator(mode="after")
    def coverage_order(self):
        if self.clear_table_coverage < self.minimum_table_coverage:
            raise ValueError("Clear-view coverage must be at least minimum table coverage.")
        return self

    def threshold(self, label):
        return {
            "person": self.person_confidence,
            "dining table": self.table_confidence,
            "chair": self.chair_confidence,
        }.get(label, self.object_confidence)

    def filter(self, detections):
        return [item for item in detections if item["confidence"] >= self.threshold(item["label"])]


def defaults(settings):
    return Calibration(
        **{
            name: settings.yolo_confidence
            for name in (
                "person_confidence",
                "table_confidence",
                "chair_confidence",
                "object_confidence",
            )
        }
    )


class ApplyCalibration(Input):
    settings: Calibration
    expected_revision: int = Field(ge=1)

    @field_validator("settings", mode="before")
    @classmethod
    def require_complete_settings(cls, value):
        if isinstance(value, dict) and set(value) != set(Calibration.model_fields):
            raise ValueError("Apply requires the complete calibration settings.")
        return value


class PreviewInput(Input):
    settings: Calibration
    camera_id: Identifier = "main"
    expected_layout_revision: int | None = Field(default=None, ge=1)
