"""MODEL-SERVE-001-T17. `_psi_histograms`/`_scaled_feature_stats` — the two
helpers that turn one materialized window's cleaned, RAW frame into the
window-plane counterparts of `PredictionLog.featureHistograms`/
`featureStats`.

The single defect these tests exist to catch: `_scaled_feature_stats`
silently RE-FITTING a scaler on the window's own few rows instead of
applying the model's actual trained parameters (DS-LAKE-018-T02's failure
shape, one layer over) — a wrong-but-plausible number with nothing on
screen to say so. `test_uses_FITTED_params_not_a_re_fit` proves this
directly: it asserts the exact scaled values the frozen params produce,
which a re-fit would NOT produce (pinned alongside it as a sabotage check,
the same discipline `test_feature_quirks.py` uses for its own quirks).
"""

from __future__ import annotations

import pandas as pd
import pytest

from intergrations.object_store import STATUS_GOOD
from services.inference_window_service import (
    _column_aggregate,
    _psi_histograms,
    _scaled_feature_stats,
)


def frame(tags: list[str], rows: list[dict]) -> pd.DataFrame:
    """Same builder `test_feature_quirks.py::frame` uses — every cell Good,
    since both helpers under test run AFTER `drop_bad_feature_rows`."""
    data: dict[str, list] = {
        "timestamp": [f"2026-09-15 00:{i:02d}:00" for i in range(len(rows))]
    }
    for tag in tags:
        data[tag] = [r[tag] for r in rows]
        data[f"{tag}__status"] = pd.array([STATUS_GOOD] * len(rows), dtype="int8")
    return pd.DataFrame(data)


class TestPsiHistograms:
    def test_bins_a_tag_with_a_frozen_reference(self):
        spec = {
            "psiRefEdges": {"T1": [0.0, 5.0, 10.0]},
            "psiBinCount": {"T1": 2},
            "psiBinMode": {"T1": "continuous"},
        }
        f = frame(["T1"], [{"T1": 2.0}, {"T1": 7.0}])

        result = _psi_histograms(f, ["T1"], spec)

        assert result == {"T1": {"counts": [1, 1], "below": 0, "above": 0}}

    def test_skips_a_tag_missing_ANY_of_the_three_spec_fields(self):
        # T2 has edges but no binCount entry — a malformed/partial spec,
        # never assembled from whichever fields happen to be present.
        spec = {
            "psiRefEdges": {"T1": [0.0, 5.0, 10.0], "T2": [0.0, 1.0]},
            "psiBinCount": {"T1": 2},
            "psiBinMode": {"T1": "continuous", "T2": "continuous"},
        }
        f = frame(["T1", "T2"], [{"T1": 2.0, "T2": 0.5}])

        result = _psi_histograms(f, ["T1", "T2"], spec)

        assert result is not None
        assert "T2" not in result

    def test_returns_None_when_NO_tag_has_a_reference(self):
        # TM2's own live shape: featureVersion 2, no psiRefEdges at all.
        spec = {"featureVersion": 2}
        f = frame(["T1"], [{"T1": 2.0}])

        assert _psi_histograms(f, ["T1"], spec) is None

    def test_bins_a_BELOW_FLOOR_window_the_same_as_a_full_one(self):
        # No row-count gate lives in this function — the sample floor is a
        # TS-layer concern (MODEL-SERVE-001-T17's own basis disclosure).
        # One row still produces a real, non-fabricated histogram.
        spec = {
            "psiRefEdges": {"T1": [0.0, 5.0, 10.0]},
            "psiBinCount": {"T1": 2},
            "psiBinMode": {"T1": "continuous"},
        }
        f = frame(["T1"], [{"T1": 2.0}])

        result = _psi_histograms(f, ["T1"], spec)

        assert result == {"T1": {"counts": [1, 0], "below": 0, "above": 0}}


class TestScaledFeatureStats:
    def test_uses_FITTED_params_not_a_re_fit(self):
        """T1 is minmax-scaled with a FROZEN train-time range [0, 10] — far
        wider than this window's own [5, 7]. A re-fit on the window's own
        values would span exactly [5, 7] and produce scaled [0.0, 1.0]
        (sum 1.0). Applying the frozen params instead produces [0.5, 0.7]
        (sum 1.2). Asserting the SECOND is what actually distinguishes
        "used the trained transform" from "silently re-fit"."""
        spec = {"scaling": [], "scalingParams": {"T1": {"min": 0.0, "max": 10.0}}}
        f = frame(["T1"], [{"T1": 5.0}, {"T1": 7.0}])

        result = _scaled_feature_stats(f, ["T1"], spec)

        assert result is not None
        stats = result["T1"]
        assert stats["n"] == 2
        assert stats["sum"] == pytest.approx(1.2)
        assert stats["min"] == pytest.approx(0.5)
        assert stats["max"] == pytest.approx(0.7)
        # The re-fit result this test exists to rule out.
        assert stats["sum"] != pytest.approx(1.0)

    def test_a_none_scaled_tag_is_included_using_raw_values(self):
        spec = {
            "scaling": [{"tag": "T2", "method": "none"}],
            "scalingParams": {},
        }
        f = frame(["T2"], [{"T2": 3.0}, {"T2": 4.0}])

        result = _scaled_feature_stats(f, ["T2"], spec)

        assert result == {
            "T2": {"n": 2, "sum": 7.0, "sumsq": 25.0, "min": 3.0, "max": 4.0}
        }

    def test_excludes_a_scaled_tag_with_NO_scalingParams_entry(self):
        # T3 defaults to minmax (absent from `scaling`, same as every real
        # spec in this system — `scaling` empty, `scalingParams` populated)
        # but has no scalingParams entry at all: a legacy/malformed gap.
        # Must be excluded, never scaled with re-fit params.
        spec = {"scaling": [], "scalingParams": {"T1": {"min": 0.0, "max": 10.0}}}
        f = frame(["T1", "T3"], [{"T1": 5.0, "T3": 9.0}])

        result = _scaled_feature_stats(f, ["T1", "T3"], spec)

        assert result is not None
        assert "T3" not in result
        assert "T1" in result

    def test_returns_None_when_NO_tag_is_coverable(self):
        spec = {"scaling": [], "scalingParams": {}}
        f = frame(["T3"], [{"T3": 9.0}])

        assert _scaled_feature_stats(f, ["T3"], spec) is None

    def test_a_below_floor_window_still_produces_real_stats(self):
        spec = {"scaling": [], "scalingParams": {"T1": {"min": 0.0, "max": 10.0}}}
        f = frame(["T1"], [{"T1": 5.0}])

        result = _scaled_feature_stats(f, ["T1"], spec)

        assert result == {
            "T1": {"n": 1, "sum": 0.5, "sumsq": 0.25, "min": 0.5, "max": 0.5}
        }


class TestColumnAggregate:
    def test_empty_series_is_a_real_zero_not_an_error(self):
        assert _column_aggregate(pd.Series([], dtype=float)) == {
            "n": 0,
            "sum": 0.0,
            "sumsq": 0.0,
            "min": 0.0,
            "max": 0.0,
        }

    def test_sufficient_statistics_are_exact(self):
        result = _column_aggregate(pd.Series([1.0, 2.0, 3.0]))

        assert result == {"n": 3, "sum": 6.0, "sumsq": 14.0, "min": 1.0, "max": 3.0}


# ── MODEL-SERVE-009-T02: per-tag current state ─────────────────────────────


def _frame_with_status(values, statuses):
    """A frame shaped like the one materialize_window holds just before its
    own Bad-row drop: one tag column plus its `__status` sidecar."""
    import pandas as pd

    from intergrations.object_store import TIMESTAMP_COLUMN, status_column

    return pd.DataFrame(
        {
            TIMESTAMP_COLUMN: pd.date_range(
                "2026-09-17 08:00", periods=len(values), freq="1min"
            ),
            "TI202.PV": values,
            status_column("TI202.PV"): statuses,
        }
    )


def test_tag_observations_reads_the_last_row():
    from services.inference_window_service import _tag_observations

    frame = _frame_with_status([1.0, 2.0, 3.5], [0, 0, 0])
    out = _tag_observations(frame, ["TI202.PV"])

    assert out["TI202.PV"]["last_value"] == 3.5
    assert out["TI202.PV"]["last_status"] == 0
    assert out["TI202.PV"]["observed_at"].startswith("2026-09-17T08:02")


def test_tag_observations_reports_a_bad_last_cell_as_bad():
    """A Bad cell still carries a NUMBER. The value is reported as-is and the
    status says which it was — the caller decides, because treating a Bad
    cell's number as a reading is the trade this ledger keeps refusing."""
    from services.inference_window_service import _tag_observations

    frame = _frame_with_status([1.0, 2.0, 999.0], [0, 0, 1])
    out = _tag_observations(frame, ["TI202.PV"])

    assert out["TI202.PV"]["last_value"] == 999.0
    assert out["TI202.PV"]["last_status"] == 1


def test_tag_observations_omits_a_tag_absent_from_the_frame():
    """Absence of evidence is not evidence — the same rule
    `detectFrozenColumns` guard (5) applies when it skips an absent column
    rather than reading it as flat."""
    from services.inference_window_service import _tag_observations

    frame = _frame_with_status([1.0], [0])
    out = _tag_observations(frame, ["TI202.PV", "NOT_FETCHED.PV"])

    assert "TI202.PV" in out
    assert "NOT_FETCHED.PV" not in out


def test_tag_observations_is_empty_on_an_empty_frame():
    import pandas as pd

    from services.inference_window_service import _tag_observations

    assert _tag_observations(pd.DataFrame(), ["TI202.PV"]) == {}
