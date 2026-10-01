"""DS-LAKE-032-T03 — per-step tag scope and the clip/crop/exclude time window.

Mirrors apps/client/lib/__tests__/cleaning-step-scope.test.ts case for case,
so the browser preview and the server clean agree on the same inputs. The
parity fixtures (T04) prove the same thing end to end; these pin the rules
directly.
"""

from __future__ import annotations

import pandas as pd
import pytest

from intergrations.object_store import STATUS_BAD, STATUS_GOOD
from services.cleaning_service import (
    CleaningError,
    apply_operations,
    preprocess_pipelines,
)

STAMPS = [
    "2026-01-01 00:00:00",
    "2026-01-01 06:00:00",
    "2026-01-01 12:00:00",
    "2026-01-01 18:00:00",
]
WINDOW = {"startTime": "2026-01-01T06:00", "endTime": "2026-01-01T12:00"}


def frame(**tags: list[float]) -> pd.DataFrame:
    data: dict = {"timestamp": pd.to_datetime(STAMPS)}
    for tag, values in tags.items():
        data[tag] = [float(v) for v in values]
        data[f"{tag}__status"] = pd.array([STATUS_GOOD] * len(values), dtype="int8")
    return pd.DataFrame(data)


def test_clip_only_inside_window() -> None:
    out = preprocess_pipelines(
        frame(T=[10, 50, 90, 130]),
        {"T": [{"method": "clip", "paramLow": 60, "param": 80, **WINDOW}]},
    )
    assert out["T"].tolist() == [10, 60, 80, 130]


def test_crop_never_drops_rows_outside_window() -> None:
    out = preprocess_pipelines(
        frame(T=[10, 50, 90, 130]),
        {"T": [{"method": "crop", "paramLow": 40, "param": 60, **WINDOW}]},
    )
    assert out["T"].tolist() == [10, 50, 130]


def test_exclude_only_inside_window() -> None:
    out = preprocess_pipelines(
        frame(T=[10, 50, 90, 130]),
        {"T": [{"method": "exclude", "paramLow": 0, "param": 200, **WINDOW}]},
    )
    assert out["T__status"].tolist() == [
        STATUS_GOOD,
        STATUS_BAD,
        STATUS_BAD,
        STATUS_GOOD,
    ]


def test_minute_only_end_covers_its_whole_minute() -> None:
    df = frame(T=[100, 100, 100, 100])
    df.loc[2, "timestamp"] = pd.Timestamp("2026-01-01 12:00:59.5")
    out = preprocess_pipelines(
        df, {"T": [{"method": "clip", "param": 1, **WINDOW}]}
    )
    assert out["T"].tolist() == [100, 1, 1, 100]


def test_server_form_bounds_mean_the_same_window() -> None:
    op = {
        "type": "clip",
        "tags": ["T"],
        "paramLow": 60,
        "param": 80,
        "startTime": "2026-01-01 06:00:00",
        "endTime": "2026-01-01 12:00:59.999999",
    }
    out = apply_operations(frame(T=[10, 50, 90, 130]), [op])
    assert out["T"].tolist() == [10, 60, 80, 130]


def test_window_ignored_by_non_windowed_methods() -> None:
    out = preprocess_pipelines(
        frame(T=[10, 50, 90, 130]),
        {"T": [{"method": "constant", "param": 0, **WINDOW}]},
    )
    assert out["T"].tolist() == [10, 50, 90, 130]


def test_step_scoped_to_other_tags_skips_this_one() -> None:
    step = {"method": "clip", "paramLow": 60, "param": 80, "tags": ["A"]}
    out = preprocess_pipelines(
        frame(A=[10, 50, 90, 130], B=[10, 50, 90, 130]), {"A": [step], "B": [step]}
    )
    assert out["A"].tolist() == [60, 60, 80, 80]
    assert out["B"].tolist() == [10, 50, 90, 130]


def test_tz_aware_bound_is_refused() -> None:
    with pytest.raises(CleaningError):
        preprocess_pipelines(
            frame(T=[1, 2, 3, 4]),
            {"T": [{"method": "clip", "param": 1, "startTime": "2026-01-01T06:00Z"}]},
        )
