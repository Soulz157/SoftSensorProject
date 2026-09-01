"""MODEL-FLOW-014-T03/V01/V02.

V01's own claim: a dense-target dataset would pass either a correct
(labelled-frame) or a naive (row-count) cut rule and prove nothing — the
sparse-target fixtures here are deliberate, matching this system's own
worst case (MODEL-FLOW-000-T02: a lab target sampled far sparser than the
grid).
"""

from __future__ import annotations

import pytest
import pandas as pd

from intergrations.object_store import STATUS_BAD, STATUS_GOOD, status_column
from schemas.preprocess import SplitStatsRequest
from services.split_stats_service import (
    MIN_LABELLED_ROWS,
    build_split_stats,
    labelled_mask,
)


class _NoWriteStore:
    """Read-only fake — same guarantee `test_correlation_matrix_service.
    _NoWriteStore` and `test_preview_service.NoWriteStore` make, defined
    locally per this codebase's own precedent."""

    def __init__(self, frame: pd.DataFrame) -> None:
        self._frame = frame

    def get_frame(self, key: str, columns: list[str] | None = None) -> pd.DataFrame:
        return self._frame[columns].copy() if columns else self._frame.copy()

    def __getattr__(self, name: str):
        raise AssertionError(
            f"split-stats service called {name!r} on the object store — "
            "read-only, must not write, delete, or create anything."
        )


def _sparse_target_frame(
    n_rows: int, label_every: int, feature_tags: tuple[str, ...] = ("TI-101",)
) -> pd.DataFrame:
    """A 1-minute grid, `n_rows` long, with `Y` Good only every `label_every`
    rows and Bad everywhere else — the sparse-lab-target shape V01 requires
    to actually distinguish a labelled-frame cut from a naive row-count cut.
    Feature tags are Good on every row (a PI-grid tag, densely sampled).
    """
    ts = pd.date_range("2026-01-01", periods=n_rows, freq="min")
    data: dict[str, object] = {"timestamp": ts, "Y": list(range(n_rows))}
    statuses = [STATUS_BAD] * n_rows
    for i in range(0, n_rows, label_every):
        statuses[i] = STATUS_GOOD
    data[status_column("Y")] = statuses
    for tag in feature_tags:
        data[tag] = list(range(n_rows))
        data[status_column(tag)] = [STATUS_GOOD] * n_rows
    return pd.DataFrame(data)


def _request(**overrides) -> SplitStatsRequest:
    defaults = dict(
        source_key="ds/final.parquet",
        tags=["TI-101"],
        target_y="Y",
        split_ratio=0.8,
    )
    defaults.update(overrides)
    return SplitStatsRequest(**defaults)


# ── V01: the cut rule bites ─────────────────────────────────────────────


def test_cut_is_on_labelled_rows_not_row_count():
    # 12,000 rows, Y Good every 37th row -> a label_every that does NOT
    # divide evenly into the ratio, so the correct (labelled-frame) cut and
    # a naive (row-count) cut land on genuinely different source rows.
    frame = _sparse_target_frame(n_rows=12_000, label_every=37)
    store = _NoWriteStore(frame)
    request = _request(split_ratio=0.8)

    result = build_split_stats(store, request)

    labelled_rows = frame.loc[
        frame[status_column("Y")] == STATUS_GOOD
    ].sort_values("timestamp").reset_index(drop=True)
    correct_cut_idx = int(len(labelled_rows) * 0.8)
    correct_cut_timestamp = str(labelled_rows.loc[correct_cut_idx, "timestamp"])

    naive_cut_idx = int(len(frame) * 0.8)
    naive_cut_timestamp = str(frame.loc[naive_cut_idx, "timestamp"])

    assert result["cut_timestamp"] == correct_cut_timestamp
    assert result["cut_timestamp"] != naive_cut_timestamp
    assert result["train_labelled_rows"] == correct_cut_idx
    assert result["test_labelled_rows"] == len(labelled_rows) - correct_cut_idx
    assert result["source_rows"] == 12_000


def test_labelled_mask_matches_status_good_and_notna():
    frame = _sparse_target_frame(n_rows=100, label_every=10)
    mask = labelled_mask(frame, "Y")
    assert mask.sum() == 10
    assert list(frame.loc[mask].index) == [i * 10 for i in range(10)]


def test_labelled_mask_falls_back_to_notna_when_status_column_absent():
    frame = pd.DataFrame(
        {
            "timestamp": pd.date_range("2026-01-01", periods=5, freq="min"),
            "Y": [1.0, None, 3.0, None, 5.0],
        }
    )
    mask = labelled_mask(frame, "Y")
    assert mask.tolist() == [True, False, True, False, True]


# ── V02 (via T02's own sampling): sample_rows never touches the cut ────


def test_sample_rows_never_determines_the_cut():
    frame = _sparse_target_frame(n_rows=5_000, label_every=7)
    store = _NoWriteStore(frame)

    full = build_split_stats(store, _request(split_ratio=0.7, sample_rows=50_000))
    tiny_sample = build_split_stats(store, _request(split_ratio=0.7, sample_rows=3))

    # The cut and the labelled row counts must be identical regardless of
    # sample_rows — only the per-tag box statistics may differ.
    assert full["cut_timestamp"] == tiny_sample["cut_timestamp"]
    assert full["train_labelled_rows"] == tiny_sample["train_labelled_rows"]
    assert full["test_labelled_rows"] == tiny_sample["test_labelled_rows"]


# ── Refusals: ValueError, not RuntimeError (router has no RuntimeError
# branch — T01 finding) ─────────────────────────────────────────────────


def test_ratio_that_leaves_one_side_empty_raises_value_error():
    # SplitStatsRequest's own schema bound (0.5-0.95, matching
    # CreateTrainingRunSchema) means this branch is unreachable through a
    # normally-validated request: int(n * ratio) < n for any ratio < 1, so
    # the cut can never reach or exceed len(labelled) under the schema's own
    # ceiling. The check is kept as DEFENSE IN DEPTH, mirroring
    # train.py::chronological_split's own unconditional guard (which carries
    # no upstream bound of its own to rely on either) — exercised here via
    # `model_construct`, which bypasses Pydantic validation, to prove the
    # service's OWN logic refuses an emptying ratio regardless of what the
    # DTO happens to allow today.
    frame = _sparse_target_frame(n_rows=1_000, label_every=20)  # 50 labelled
    store = _NoWriteStore(frame)
    request = SplitStatsRequest.model_construct(
        source_key="ds/final.parquet",
        tags=["TI-101"],
        target_y="Y",
        split_ratio=1.0,
        sample_rows=5_000,
        outlier_cap=50,
    )

    with pytest.raises(ValueError, match="leaves one side empty"):
        build_split_stats(store, request)


def test_too_few_labelled_rows_raises_value_error():
    frame = _sparse_target_frame(n_rows=500, label_every=50)  # 10 labelled
    assert 10 < MIN_LABELLED_ROWS
    store = _NoWriteStore(frame)

    with pytest.raises(ValueError, match="too few to split"):
        build_split_stats(store, _request())


def test_unknown_tag_raises_a_caller_fixable_error():
    frame = _sparse_target_frame(n_rows=200, label_every=5)
    store = _NoWriteStore(frame)

    with pytest.raises((ValueError, KeyError)):
        build_split_stats(store, _request(tags=["NOT-A-REAL-TAG"]))


# ── Per-side insufficiency (V04's own claim, exercised at the service
# layer here; the panel-level render is V04 proper) ─────────────────────


def test_a_tag_insufficient_on_one_side_only_is_labelled_per_side():
    n = 2_000
    ts = pd.date_range("2026-01-01", periods=n, freq="min")
    data: dict[str, object] = {"timestamp": ts, "Y": list(range(n))}
    data[status_column("Y")] = [STATUS_GOOD] * n  # dense target, simple cut

    # Feature tag Good everywhere on train (first 80%), Bad everywhere on
    # test (last 20%) -- exactly the asymmetry the per-side insufficient_tags
    # list exists to surface.
    cut = int(n * 0.8)
    statuses = [STATUS_GOOD] * cut + [STATUS_BAD] * (n - cut)
    data["TI-101"] = list(range(n))
    data[status_column("TI-101")] = statuses
    frame = pd.DataFrame(data)
    store = _NoWriteStore(frame)

    result = build_split_stats(store, _request(split_ratio=0.8, tags=["TI-101"]))

    assert result["train"]["insufficient_tags"] == []
    assert result["test"]["insufficient_tags"] == ["TI-101"]
    assert [t["tag"] for t in result["train"]["tags"]] == ["TI-101"]
    assert result["test"]["tags"] == []
