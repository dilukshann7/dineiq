import json
from pathlib import Path

import pytest

from app.monitoring.rules import TableMachine, observe_tables


def rectangle(left, top, right, bottom):
    return [[left, top], [right, top], [right, bottom], [left, bottom]]


def detection(label, left, top, right, bottom, *, segmented=True):
    item = {"label": label, "confidence": 0.9, "box": [left, top, right, bottom]}
    if segmented:
        item["polygon"] = rectangle(left, top, right, bottom)
    return item


TABLE = {"id": "table", "polygon": rectangle(0.1, 0.1, 0.9, 0.9), "seats": []}


def test_supplied_distant_empty_tables_become_looks_clear():
    fixture = json.loads(
        (Path(__file__).parent / "fixtures" / "distant_empty_tables.json").read_text(
            encoding="utf-8"
        )
    )
    observations = observe_tables(fixture["tables"], fixture["detections"])

    for table in fixture["tables"]:
        observation = observations[table["id"]]
        assert observation["valid"], table["name"]
        assert observation["clear_view"], table["name"]
        machine = TableMachine(capacity=5)
        for second in range(41):
            state = machine.observe(observation, second)
        assert state["occupancy"] == "empty"
        assert state["cleanliness"] == "looks_clear"
        assert state["reason"] == ""


@pytest.mark.parametrize(
    "obstructions",
    [
        [],
        [detection("chair", 0.1, 0.7, 0.9, 1.0, segmented=False)],
        [detection("chair", 0.1, 0.3, 0.9, 1.0)],
        [
            detection("chair", 0.1, 0.7, 0.9, 1.0),
            detection("person", 0.1, 0.7, 0.9, 1.0),
        ],
    ],
    ids=["unexplained-surface-loss", "chair-box-only", "excessive-chair-cover", "person"],
)
def test_chair_tolerance_keeps_obscured_tables_unknown(obstructions):
    observations = observe_tables(
        [TABLE], [detection("dining table", 0.1, 0.1, 0.9, 0.7), *obstructions]
    )

    assert observations["table"]["valid"]
    assert not observations["table"]["clear_view"]


def test_chair_masks_do_not_substitute_for_a_missing_table():
    observation = observe_tables([TABLE], [detection("chair", 0.1, 0.1, 0.9, 0.9)])["table"]

    assert not observation["valid"]
    assert not observation["clear_view"]


def test_chair_tolerance_still_requires_most_of_the_full_tabletop():
    observation = observe_tables(
        [TABLE],
        [
            detection("dining table", 0.1, 0.1, 0.9, 0.62),
            detection("chair", 0.1, 0.7, 0.9, 1.0),
        ],
    )["table"]

    assert observation["valid"]
    assert not observation["clear_view"]


@pytest.mark.parametrize("segmented", [True, False], ids=["segmented-cup", "cup-box-only"])
def test_chair_tolerance_preserves_cleaning_item_evidence(segmented):
    observation = observe_tables(
        [TABLE],
        [
            detection("dining table", 0.1, 0.1, 0.9, 0.7),
            detection("chair", 0.1, 0.7, 0.9, 1.0),
            detection("cup", 0.4, 0.4, 0.5, 0.5, segmented=segmented),
        ],
    )["table"]
    machine = TableMachine(capacity=5)
    for second in range(41):
        state = machine.observe(observation, second)

    assert state["cleanliness"] == ("needs_cleaning" if segmented else "unknown")
    assert state["evidence"] == (["cup"] if segmented else [])
