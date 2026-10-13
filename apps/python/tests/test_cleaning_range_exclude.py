"""DS-LAKE-038 - the `range_exclude` cleaning op behind the Preset range card's "Exclude".

The same treatment the cleaning toolkit's `exclude` (Exclude Range) gives a
reading - status Bad, value KEPT, only this tag - applied to what lies outside
the preset's kept window, with strict bounds. The parity fixtures prove the op
agrees with the browser end to end; these pin the rules the grid cannot reach
(a value exactly ON a bound) and the request-shaped entry point.
"""

from __future__ import annotations

import pandas as pd

from intergrations.object_store import STATUS_BAD, STATUS_GOOD
from services.cleaning_service import apply_operations, preprocess_pipelines


def frame(**tags: list[float]) -> pd.DataFrame:
    size = len(next(iter(tags.values())))
    stamps = [f"2026-01-01 0{h}:00:00" for h in range(size)]
    data: dict = {"timestamp": pd.to_datetime(stamps)}
    for tag, values in tags.items():
        data[tag] = [float(v) for v in values]
        data[f"{tag}__status"] = pd.array([STATUS_GOOD] * len(values), dtype="int8")
    return pd.DataFrame(data)


def run(values: list[float], **step) -> pd.DataFrame:
    return preprocess_pipelines(
        frame(T=values), {"T": [{"method": "range_exclude", **step}]}
    )


def test_out_of_range_readings_are_marked_bad_and_keep_their_value() -> None:
    out = run([10, 30, 60, 100, 130], paramLow=30, param=100)

    assert out["T"].tolist() == [10.0, 30.0, 60.0, 100.0, 130.0]
    assert out["T__status"].tolist() == [
        STATUS_BAD,
        STATUS_GOOD,
        STATUS_GOOD,
        STATUS_GOOD,
        STATUS_BAD,
    ]


def test_a_value_exactly_on_a_bound_is_in_range() -> None:
    # 30 and 100 are the bounds themselves: strict comparison keeps them Good,
    # unlike `exclude`, whose inclusive band would mark them.
    out = run([30, 100], paramLow=30, param=100)
    assert set(out["T__status"].tolist()) == {STATUS_GOOD}


def test_open_ended_bounds() -> None:
    assert run([1, 5, 9], paramLow=4)["T__status"].tolist() == [
        STATUS_BAD,
        STATUS_GOOD,
        STATUS_GOOD,
    ]
    assert run([1, 5, 9], param=6)["T__status"].tolist() == [
        STATUS_GOOD,
        STATUS_GOOD,
        STATUS_BAD,
    ]


def test_no_bounds_is_a_no_op() -> None:
    out = run([1, 50, 999])
    assert out["T"].tolist() == [1.0, 50.0, 999.0]
    assert set(out["T__status"].tolist()) == {STATUS_GOOD}


def test_rows_are_kept_and_other_tags_are_untouched() -> None:
    out = preprocess_pipelines(
        frame(T=[10, 50, 130], U=[1, 2, 3]),
        {"T": [{"method": "range_exclude", "paramLow": 30, "param": 100}]},
    )
    assert len(out) == 3
    assert out["U"].tolist() == [1.0, 2.0, 3.0]
    assert out["U__status"].tolist() == [STATUS_GOOD] * 3


def test_a_later_fill_step_imputes_the_excluded_reading() -> None:
    out = preprocess_pipelines(
        frame(T=[10, 20, 130]),
        {
            "T": [
                {"method": "range_exclude", "paramLow": 0, "param": 100},
                {"method": "interpolate"},
            ]
        },
    )
    # Bad, so interpolation fills it from the Good neighbour.
    assert out["T__status"].tolist() == [STATUS_GOOD] * 3
    assert out["T"].tolist()[2] == 20.0


def test_request_shaped_operation_reaches_the_op() -> None:
    out = apply_operations(
        frame(T=[10, 50, 130]),
        [{"type": "range_exclude", "tags": ["T"], "paramLow": 30, "param": 100}],
    )
    assert out["T__status"].tolist() == [STATUS_BAD, STATUS_GOOD, STATUS_BAD]
    assert out["T"].tolist() == [10.0, 50.0, 130.0]


def test_range_drop_is_gone() -> None:
    # Replaced by range_exclude before it shipped; keep the name from creeping back.
    from services.cleaning_service import CLEANING_OPS

    assert "range_drop" not in CLEANING_OPS
    assert "range_exclude" in CLEANING_OPS
