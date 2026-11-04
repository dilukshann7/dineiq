from typing import Literal

from pydantic import Field

from app.auth.contracts import DisplayName, Input, NewPassword, Username


class AccessInput(Input):
    code: str = Field(min_length=1, max_length=128, repr=False)


class AdminInput(Input):
    username: Username
    display_name: DisplayName
    password: NewPassword


class ProgressInput(Input):
    checkpoint: Literal["camera", "tables", "staff", "review"]


class CompleteInput(Input):
    session_id: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    expected_revision: int = Field(ge=1)


class ResetInput(Input):
    current_password: str = Field(min_length=1, max_length=1024, repr=False)
    confirmation: Literal["RESET DINEIQ"]
    expected_generation: int = Field(ge=0)
