from typing import Annotated

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints

Username = Annotated[
    str,
    StringConstraints(min_length=3, max_length=64, pattern=r"^[a-z0-9_.-]+$"),
    BeforeValidator(lambda value: value.strip().lower() if isinstance(value, str) else value),
]
DisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
NewPassword = Annotated[str, Field(min_length=12, max_length=1024, repr=False)]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)


class LoginInput(Input):
    username: Username
    password: str = Field(min_length=1, max_length=1024, repr=False)


class PasswordInput(Input):
    current_password: str = Field(min_length=1, max_length=1024, repr=False)
    new_password: NewPassword


class StaffInput(Input):
    username: Username
    display_name: DisplayName


class StaffPatch(Input):
    username: Username | None = None
    display_name: DisplayName | None = None
    active: bool | None = None
