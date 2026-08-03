"""Direct pins for the browser quirks the fixtures do NOT discriminate.

Why this file exists
--------------------
The golden fixtures in `packages/parity-fixtures` are end-to-end: they run a
whole pipeline over 40 rows and compare grids. That catches gross divergence,
but it was MEASURED to miss three of four deliberately injected regressions:

* swapping JS half-up rounding for Python's banker's rounding      -> not caught
* swapping floor-index quartiles for `numpy.quantile`              -> not caught
* swapping population std for sample std in `zscore`               -> not caught

On that particular data the alternatives happen to classify the same cells, so
the suite stayed green. Anyone later "tidying" the implementation into
idiomatic numpy would see no failure, and real data with a different
distribution would silently diverge.

These tests pin each choice directly, on inputs constructed so the alternatives
PROVABLY differ. Each also asserts that the tempting substitute really is
different, so the pin cannot rot into a tautology.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from intergrations.object_store import STATUS_BAD, STATUS_GOOD
from services.cleaning_service import (
    CleaningError,
    _build_step,
    _js_round,
    _median_sorted,
    _round_to,
    apply_operations,
    preprocess_pipelines,
)


def frame(values: list[float], statuses: list[int] | None = None) -> pd.DataFrame:
    statuses = statuses or [STATUS_GOOD] * len(values)
    return pd.DataFrame(
        {
            "timestamp": pd.to_datetime(
                [f"2026-06-22 00:{i:02d}:00" for i in range(len(values))]
            ),
            "TI-101": [float(v) for v in values],
            "TI-101__status": pd.array(statuses, dtype="int8"),
        }
    )


def run(df: pd.DataFrame, step: dict, precision: int = 2) -> list[float]:
    out = preprocess_pipelines(df, {"TI-101": [step]}, {"TI-101": precision})
    return out["TI-101"].tolist()


# ── quirk 1: JS Math.round, not Python round ─────────────────────────────


@pytest.mark.parametrize(
    "value,js_expected",
    [
        (2.5, 3),  # Python round() gives 2
        (0.5, 1),  # Python round() gives 0
        (3.5, 4),
        (1.5, 2),  # Python round() gives 2
        (-2.5, -2),
    ],
)
def test_js_round_is_half_up_not_bankers(value: float, js_expected: int) -> None:
    assert _js_round(value) == js_expected


def test_js_round_actually_differs_from_python_round() -> None:
    """Keeps the pin above from becoming a tautology."""
    diverging = [v for v in (0.5, 1.5, 2.5, 4.5) if _js_round(v) != round(v)]
    assert diverging, "expected JS half-up to differ from banker's rounding"


def test_rounding_quirk_is_visible_through_a_real_operation() -> None:
    """A smoothing window whose mean lands exactly on .5 at 0 decimals.

    Three values averaging 2.5 at precision 0: JS gives 3, banker's gives 2.
    """
    assert run(frame([2.5, 2.5, 2.5]), {"method": "moving_avg", "param": 3}, 0) == [
        3.0,
        3.0,
        3.0,
    ]
    assert round(2.5) == 2  # the substitute would have produced 2.0


# ── quirk 2: floor-index quartiles, not interpolated quantiles ───────────


def test_floor_index_quartiles_differ_from_numpy_quantile() -> None:
    values = np.array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 100.0])
    ordered = np.sort(values)
    n = ordered.size

    floor_q1 = float(ordered[math.floor(n * 0.25)])
    floor_q3 = float(ordered[math.floor(n * 0.75)])

    assert (floor_q1, floor_q3) == (3.0, 7.0)
    assert (
        float(np.quantile(ordered, 0.25)),
        float(np.quantile(ordered, 0.75)),
    ) != (floor_q1, floor_q3), (
        "numpy interpolates between order statistics; the browser indexes "
        "directly. If these ever match, this pin tests nothing."
    )


def test_iqr_operation_uses_the_floor_index_fences() -> None:
    """12.0 sits INSIDE the floor-index fence (13.0) but OUTSIDE numpy's (11.5).

    Chosen deliberately: with a far-out value like 100.0 both definitions agree
    it is an outlier, so the test would pass under either implementation and
    prove nothing. This input makes the choice observable.
    """
    values = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 12.0]
    out = run(frame(values), {"method": "outlier_median"}, 2)

    # Our implementation must LEAVE 12.0 alone.
    assert out[7] == 12.0

    ordered = np.sort(np.array(values))
    n = ordered.size
    q1 = float(ordered[math.floor(n * 0.25)])
    q3 = float(ordered[math.floor(n * 0.75)])
    iqr = q3 - q1
    lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    med = _median_sorted(ordered.tolist())

    expected = [_round_to(med, 2) if (v < lo or v > hi) else v for v in values]
    assert out == expected

    n_q1 = float(np.quantile(ordered, 0.25))
    n_q3 = float(np.quantile(ordered, 0.75))
    n_iqr = n_q3 - n_q1
    numpy_expected = [
        _round_to(med, 2) if (v < n_q1 - 1.5 * n_iqr or v > n_q3 + 1.5 * n_iqr) else v
        for v in values
    ]
    assert numpy_expected != expected, "the two fence definitions must diverge here"


# ── quirk 3: population std in zscore ────────────────────────────────────


def test_zscore_uses_population_std() -> None:
    """The convention must change the CLASSIFICATION, not merely the value.

    n is deliberately small so the sqrt(n/(n-1)) factor can move a point across
    the threshold.
    """
    values = [10.0, 10.0, 10.0, 16.0]
    good = np.array(values)

    mean = float(good.mean())
    pop_std = float(good.std(ddof=0))
    sample_std = float(good.std(ddof=1))
    assert pop_std != sample_std

    threshold = 1.7
    outlier = 16.0
    pop_flags = abs((outlier - mean) / pop_std) > threshold
    sample_flags = abs((outlier - mean) / sample_std) > threshold
    assert pop_flags != sample_flags, (
        "the threshold must sit between the two conventions, otherwise this "
        "test cannot tell them apart"
    )

    out = run(frame(values), {"method": "zscore", "param": threshold}, 2)
    assert (out[3] != outlier) == pop_flags


# ── quirk 4: fills flip status even without a donor ──────────────────────


def test_forward_fill_marks_good_with_no_donor() -> None:
    """A leading Bad cell has nothing to copy from, yet still becomes Good."""
    out = preprocess_pipelines(
        frame([5.0, 6.0], [STATUS_BAD, STATUS_GOOD]),
        {"TI-101": [{"method": "forward"}]},
        {"TI-101": 2},
    )
    assert out["TI-101"].tolist() == [5.0, 6.0]  # value untouched
    assert out["TI-101__status"].tolist() == [STATUS_GOOD, STATUS_GOOD]


def test_backward_fill_marks_good_with_no_donor() -> None:
    out = preprocess_pipelines(
        frame([5.0, 6.0], [STATUS_GOOD, STATUS_BAD]),
        {"TI-101": [{"method": "backward"}]},
        {"TI-101": 2},
    )
    assert out["TI-101"].tolist() == [5.0, 6.0]
    assert out["TI-101__status"].tolist() == [STATUS_GOOD, STATUS_GOOD]


# ── quirk 5: zscore replaces, never removes ──────────────────────────────


def test_zscore_replaces_rather_than_removes() -> None:
    values = [10.0, 10.0, 10.0, 10.0, 200.0]
    out = run(frame(values), {"method": "zscore", "param": 1.5}, 2)

    assert len(out) == len(values), "zscore must never change the row count"
    assert out[4] != 200.0, "the outlier should have been replaced"


# ── quirk 6: clip neither rounds nor touches status ──────────────────────


def test_clip_leaves_status_and_precision_alone() -> None:
    out = preprocess_pipelines(
        frame([1.23456, 500.0], [STATUS_GOOD, STATUS_BAD]),
        {"TI-101": [{"method": "clip", "paramLow": 0, "param": 100}]},
        {"TI-101": 2},
    )

    # In range -> untouched, and NOT rounded to 2dp despite the precision map.
    assert out["TI-101"].tolist() == [1.23456, 100.0]
    assert out["TI-101__status"].tolist() == [STATUS_GOOD, STATUS_BAD]


# ── quirk 7: moving average shrinks at the edges ─────────────────────────


def test_moving_average_shrinks_at_the_edges() -> None:
    """pandas rolling(center=True) would emit NaN at the boundaries."""
    values = [1.0, 2.0, 3.0]
    out = run(frame(values), {"method": "moving_avg", "param": 3}, 6)

    assert out[0] == pytest.approx((1.0 + 2.0) / 2)  # window clipped to 2
    assert out[1] == pytest.approx((1.0 + 2.0 + 3.0) / 3)
    assert out[2] == pytest.approx((2.0 + 3.0) / 2)

    rolled = pd.Series(values).rolling(3, center=True).mean()
    assert bool(rolled.isna().iloc[0]), "the substitute would produce NaN here"


# ── quirk 8: drop removes the UNION across tags ──────────────────────────


def test_drop_removes_the_union_across_tags() -> None:
    """A drop on one tag still removes that whole row for every other tag."""
    df = pd.DataFrame(
        {
            "timestamp": pd.to_datetime(
                ["2026-06-22 00:00:00", "2026-06-22 00:01:00", "2026-06-22 00:02:00"]
            ),
            "A": [1.0, 2.0, 3.0],
            "A__status": pd.array([STATUS_GOOD, STATUS_BAD, STATUS_GOOD], dtype="int8"),
            "B": [10.0, 20.0, 30.0],
            "B__status": pd.array([STATUS_BAD, STATUS_GOOD, STATUS_GOOD], dtype="int8"),
        }
    )

    both = preprocess_pipelines(
        df, {"A": [{"method": "drop"}], "B": [{"method": "drop"}]}, {}
    )
    assert both["A"].tolist() == [3.0], "the union of rows 0 and 1 should go"

    only_a = preprocess_pipelines(df, {"A": [{"method": "drop"}]}, {})
    assert only_a["A"].tolist() == [1.0, 3.0]
    # B keeps its Bad cell: the row survived because only A drove the drop.
    assert only_a["B__status"].tolist() == [STATUS_BAD, STATUS_GOOD]


# ── emergent: zscore imputes a Bad 0.0 hole ──────────────────────────────


def test_zscore_imputes_a_bad_hole() -> None:
    """Documents an interaction the browser's own fixtures cannot produce.

    `zscore` derives mean/std from Good cells but tests EVERY cell (faithful to
    the client). Our holes are stored as 0.0/Bad, so a hole among readings near
    72 scores as a massive outlier and gets replaced by the mean and marked
    Good — i.e. it is imputed. The browser never hit this because its Bad cells
    hold plausible values, not zeros.

    Pinned deliberately: if this ever changes it should be a decision, not a
    surprise discovered from wrong numbers downstream.
    """
    out = preprocess_pipelines(
        frame(
            [72.0, 72.5, 0.0, 71.8, 72.2],
            [STATUS_GOOD, STATUS_GOOD, STATUS_BAD, STATUS_GOOD, STATUS_GOOD],
        ),
        {"TI-101": [{"method": "zscore", "param": 2}]},
        {"TI-101": 1},
    )

    assert out["TI-101"].tolist()[2] != 0.0, "the hole should have been replaced"
    assert out["TI-101__status"].tolist()[2] == STATUS_GOOD
    # The surrounding Good readings are untouched.
    assert out["TI-101"].tolist()[0] == 72.0
    assert out["TI-101"].tolist()[4] == 72.2


# ── apply_operations: the request-shaped entry point F4 will call ────────


def test_apply_operations_matches_the_pipeline_path() -> None:
    """The request API and the engine must not be able to diverge.

    Every parity guarantee is proven through `preprocess_pipelines`; if
    `apply_operations` took a different route, F4 would ship an endpoint whose
    behaviour was never verified.
    """
    df = frame([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 100.0])

    via_request = apply_operations(
        df, [{"type": "remove_outlier", "method": "iqr", "tags": ["*"]}], {"TI-101": 2}
    )
    via_engine = preprocess_pipelines(
        df, {"TI-101": [{"method": "outlier_median"}]}, {"TI-101": 2}
    )
    assert via_request.equals(via_engine)


def test_apply_operations_rejects_unknown_tags_everywhere() -> None:
    df = frame([1.0, 2.0])

    with pytest.raises(CleaningError, match="unknown columns"):
        apply_operations(df, [{"type": "drop_missing", "tags": ["GHOST"]}], {})

    # remove_duplicates is frame-wide and cannot be scoped by tag, but a typo
    # must still surface rather than silently succeeding.
    with pytest.raises(CleaningError, match="unknown columns"):
        apply_operations(df, [{"type": "remove_duplicates", "tags": ["GHOST"]}], {})


def test_apply_operations_rejects_unsupported_operations() -> None:
    df = frame([1.0, 2.0])
    with pytest.raises(CleaningError, match="Unsupported operation"):
        apply_operations(df, [{"type": "teleport"}], {})
    with pytest.raises(CleaningError, match="needs a 'type'"):
        apply_operations(df, [{}], {})


def test_param_alias_precedence_is_explicit() -> None:
    """`param` wins over friendlier aliases, and the order is not dict luck."""
    assert _build_step("moving_avg", {"param": 5, "window": 3})["param"] == 5
    assert _build_step("moving_avg", {"window": 3})["param"] == 3
    assert _build_step("zscore", {"threshold": 2})["param"] == 2
    assert _build_step("exponential", {"alpha": 0.7})["param"] == 0.7
    # clip takes both bounds, in either spelling.
    assert _build_step("clip", {"min": 0, "max": 100}) == {
        "method": "clip",
        "param": 100,
        "paramLow": 0,
    }


def test_remove_duplicates_keeps_the_first_row() -> None:
    """No browser counterpart, so the semantics are defined here: keep-first."""
    df = pd.DataFrame(
        {
            "timestamp": pd.to_datetime(
                [
                    "2026-06-22 00:00:00",
                    "2026-06-22 00:00:00",  # duplicate
                    "2026-06-22 00:01:00",
                ]
            ),
            "TI-101": [1.0, 999.0, 2.0],
            "TI-101__status": pd.array(
                [STATUS_GOOD, STATUS_GOOD, STATUS_GOOD], dtype="int8"
            ),
        }
    )

    out = apply_operations(df, [{"type": "remove_duplicates"}], {})
    assert out["TI-101"].tolist() == [1.0, 2.0], "the FIRST duplicate must survive"


def test_operations_chain_in_order() -> None:
    """Later operations see the output of earlier ones."""
    df = frame([10.0, 10.0, 10.0, 200.0])

    out = apply_operations(
        df,
        [
            {"type": "remove_outlier", "method": "zscore", "threshold": 1.5},
            {"type": "clip", "min": 0, "max": 5},
        ],
        {"TI-101": 2},
    )
    # zscore pulls 200 back to the mean, then clip caps everything at 5.
    assert out["TI-101"].tolist() == [5.0, 5.0, 5.0, 5.0]
