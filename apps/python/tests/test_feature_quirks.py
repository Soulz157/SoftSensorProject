"""Direct pins for the feature_service quirks the fixtures do NOT discriminate.

Same reasoning as `test_cleaning_quirks.py`: the golden fixtures compare whole
grids end-to-end, which catches gross divergence but can pass by coincidence
when two conventions happen to agree on that particular data. These tests are
built on inputs chosen so the alternatives PROVABLY differ, and each pin also
proves its own premise (the substitute really would diverge) so it cannot rot
into a tautology.

DS-LAKE-006-T03-V02: rounding convention, scaler denominators, column
ordering. DS-LAKE-006-T03-V01: a real fixture, sabotaged in memory, must make
the suite fail — proven at the bottom of this file, alongside proof that the
comparison against the REAL expected grid still passes (nothing was left
mutated on disk).
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import numpy as np
import pytest

from conftest import FIXTURE_DIR
from services.cleaning_service import _median_sorted, _round_to
from services.feature_service import (
    _scale_column,
    _welford_population_std,
    apply_features,
    to_model_ready,
)
from intergrations.object_store import STATUS_GOOD, tag_columns


def frame(tags: list[str], rows: list[dict]) -> "pd.DataFrame":
    import pandas as pd

    data: dict[str, list] = {
        "timestamp": [f"2026-06-22 00:{i:02d}:00" for i in range(len(rows))]
    }
    for tag in tags:
        data[tag] = [r[tag] for r in rows]
        data[f"{tag}__status"] = pd.array(
            [STATUS_GOOD] * len(rows), dtype="int8"
        )
    return pd.DataFrame(data)


# ── quirk: unconditional 3-decimal rounding uses JS half-up, not Python's ──


def test_round_to_diverges_from_python_round_at_a_real_half_tie() -> None:
    """0.0045 is the premise: Python's `round` and `_round_to` (JS `Math.round`
    convention) must disagree here, or the pin below tests nothing."""
    v = 0.0045
    assert round(v, 3) != _round_to(v, 3), (
        "expected Python round() and _round_to() to diverge at this value"
    )


def test_scale_column_none_uses_round_to_not_python_round() -> None:
    v = 0.0045
    out = _scale_column(np.array([v]), "none")
    assert out[0] == _round_to(v, 3)
    assert out[0] != round(v, 3), "the scaler must not use Python's round()"


# ── quirk: standard scaling is POPULATION std, not SAMPLE std ─────────────


def test_standard_scaling_uses_population_std_not_sample() -> None:
    values = [1.0, 2.0, 3.0, 4.0]
    n = len(values)
    mean = sum(values) / n
    population_std = (sum((v - mean) ** 2 for v in values) / n) ** 0.5
    sample_std = (sum((v - mean) ** 2 for v in values) / (n - 1)) ** 0.5
    assert population_std != sample_std, (
        "premise: population and sample std must differ for this input"
    )

    out = _scale_column(np.array(values), "standard")
    # The scaled value for the first element, hand-computed both ways.
    expected_population = _round_to((values[0] - mean) / population_std, 3)
    expected_sample = _round_to((values[0] - mean) / sample_std, 3)
    assert expected_population != expected_sample
    assert out[0] == expected_population
    assert out[0] != expected_sample


def test_welford_matches_naive_population_std() -> None:
    """Welford is an ONLINE algorithm; this proves it lands on the same
    mathematical answer as the direct formula, not just "a" std."""
    values = [72.0, 68.5, 75.1, 70.0, 71.25, 500.0, 69.9]
    mean, std = _welford_population_std(values)
    naive_mean = sum(values) / len(values)
    naive_std = (sum((v - naive_mean) ** 2 for v in values) / len(values)) ** 0.5
    assert mean == pytest.approx(naive_mean, rel=1e-9)
    assert std == pytest.approx(naive_std, rel=1e-9)


# ── quirk: rolling.std is SAMPLE std — the OPPOSITE of toModelReady.standard ─


def test_rolling_std_and_scaler_standard_use_opposite_conventions() -> None:
    """Two different std conventions coexist on purpose (module docstring).
    This proves they are not accidentally the same code path."""
    from services.feature_service import _aggregate

    values = [1.0, 2.0, 3.0, 4.0]
    rolling_std = _aggregate(values, "std")  # sample, /(n-1)

    n = len(values)
    mean = sum(values) / n
    sample_std = (sum((v - mean) ** 2 for v in values) / (n - 1)) ** 0.5
    population_std = (sum((v - mean) ** 2 for v in values) / n) ** 0.5

    assert rolling_std == pytest.approx(sample_std)
    assert rolling_std != pytest.approx(population_std)


# ── quirk: robust IQR is Tukey's exclusive hinges, not numpy.percentile ────


def test_robust_iqr_uses_tukey_hinges_not_numpy_percentile() -> None:
    values = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0]  # odd count: hinges exclude the middle
    ordered = sorted(values)
    k = len(ordered)

    tukey_med = _median_sorted(ordered)
    tukey_upper = _median_sorted(ordered[-((k) // 2) :])
    tukey_lower = _median_sorted(ordered[: k // 2])
    tukey_iqr = tukey_upper - tukey_lower

    np_arr = np.array(values)
    numpy_iqr = float(np.percentile(np_arr, 75) - np.percentile(np_arr, 25))

    assert tukey_iqr != numpy_iqr, (
        "premise: Tukey exclusive hinges and numpy's interpolated quartiles "
        "must differ for this odd-count input"
    )

    out = _scale_column(np_arr, "robust")
    expected = _round_to((values[0] - tukey_med) / tukey_iqr, 3)
    assert out[0] == expected


def test_robust_skips_a_tag_with_zero_finite_values_entirely() -> None:
    """Unlike minmax/standard, which force (0, Good); robust leaves the
    column byte-identical when nothing finite exists to compute a median from."""
    values = np.array([np.nan, np.inf, -np.inf])
    out = _scale_column(values, "robust")
    assert np.array_equal(out, values, equal_nan=True)


# ── quirk: derived-feature column order follows config order, not sorted ──


def test_applied_feature_columns_preserve_config_order_not_alphabetical() -> None:
    df = frame(
        ["TI-101", "XX-999"],
        [{"TI-101": 1.0, "XX-999": 2.0}, {"TI-101": 1.5, "XX-999": 2.5}],
    )
    # Config order deliberately reversed from alphabetical: XX-999 first,
    # TI-101 second. If output were alphabetically sorted, TI-101's derived
    # column would appear first — it must not.
    configs = [
        {"id": "f1", "kind": "lag", "tag": "XX-999", "k": 1},
        {"id": "f2", "kind": "lag", "tag": "TI-101", "k": 1},
    ]
    out = apply_features(df, configs)
    tags = tag_columns(out)
    assert tags[-2:] == ["XX-999__lag1", "TI-101__lag1"], (
        f"expected config order preserved, got {tags[-2:]!r}"
    )


# ── V01: prove the gate bites — sabotage a real fixture's expected grid ───


def _load_fixture(name: str) -> dict:
    with (FIXTURE_DIR / f"{name}.json").open(encoding="utf-8") as fh:
        return json.load(fh)


def test_gate_bites_on_a_sabotaged_real_fixture() -> None:
    """Mutate ONE value in a real T01 fixture's expected grid (in memory
    only — the file on disk is never touched) and confirm the real service's
    output no longer matches. Then confirm the SAME service output still
    matches the TRUE, un-sabotaged expected grid, proving nothing about the
    comparison itself is broken — only the deliberately wrong copy fails.
    """
    from tests.test_parity import assert_grids_match, frame_to_wide, wide_to_frame

    fixture = _load_fixture("scaler_minmax")
    src = wide_to_frame(fixture["input"])
    result = to_model_ready(src, tag_columns(src), fixture["config"]["scalers"])
    actual = frame_to_wide(result, fixture["expected"]["tags"])

    # The real comparison passes.
    assert_grids_match(actual, fixture["expected"], "scaler_minmax")

    # A sabotaged COPY — one value nudged well outside tolerance — must fail.
    sabotaged = copy.deepcopy(fixture["expected"])
    tag = sabotaged["tags"][0]
    sabotaged["rows"][0]["cells"][tag]["value"] += 999.0
    with pytest.raises(AssertionError, match="value"):
        assert_grids_match(actual, sabotaged, "scaler_minmax-sabotaged")

    # Restored: the untouched fixture on disk still matches, proving the
    # sabotage above only ever existed in the in-memory deep copy.
    reloaded = _load_fixture("scaler_minmax")
    assert reloaded["expected"] == fixture["expected"]
    assert_grids_match(actual, reloaded["expected"], "scaler_minmax-reloaded")
