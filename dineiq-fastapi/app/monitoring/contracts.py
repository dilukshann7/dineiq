from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

Coordinate = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
Point = tuple[Coordinate, Coordinate]
Polygon = Annotated[list[Point], Field(min_length=3, max_length=64)]
Identifier = Annotated[str, Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")]


def validate_polygon(points: list[Point]) -> list[Point]:
    import cv2
    import numpy as np

    contour = np.array(points, dtype=np.float32)
    if len(set(points)) != len(points) or cv2.contourArea(contour) < 0.0001:
        raise ValueError("Polygon must enclose a visible region with distinct vertices.")
    # Convex regions avoid self-intersections and make seat/table geometry predictable.
    if not cv2.isContourConvex(contour):
        raise ValueError("Use a convex polygon without crossing edges.")
    return points


class SeatInput(BaseModel):
    id: Identifier
    polygon: Polygon

    _polygon = field_validator("polygon")(validate_polygon)


class TableInput(BaseModel):
    id: Identifier
    name: str = Field(min_length=1, max_length=80)
    polygon: Polygon
    seats: list[SeatInput] = Field(min_length=1, max_length=32)

    _polygon = field_validator("polygon")(validate_polygon)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Enter a table name.")
        return value.strip()


class LayoutInput(BaseModel):
    camera_id: Identifier = "main"
    expected_revision: int = Field(default=0, ge=0)
    expected_position_version: int = Field(default=0, ge=0)
    width: int = Field(ge=1, le=4096)
    height: int = Field(ge=1, le=4096)
    tables: list[TableInput] = Field(min_length=1, max_length=16)
    frame: str = Field(max_length=2_800_000, min_length=4)

    @model_validator(mode="after")
    def unique_ids(self):
        ids = [table.id for table in self.tables]
        ids += [seat.id for table in self.tables for seat in table.seats]
        if len(ids) != len(set(ids)):
            raise ValueError("Table and seat IDs must be unique within the layout.")
        return self


class StartInput(BaseModel):
    camera_id: Identifier = "main"
    expected_revision: int | None = Field(default=None, ge=0)


class CorrectionInput(BaseModel):
    camera_id: Identifier = "main"
    action: Literal["looks_clear", "needs_cleaning", "automatic"]


class ServiceInput(BaseModel):
    camera_id: Identifier = "main"
    visit_id: Identifier


class AcknowledgeInput(BaseModel):
    camera_id: Identifier = "main"
