"""DS-LAKE-018-T06: `artifact_service.resplit_holdout` — re-splitting an
EXISTING, PRISTINE BRONZE against a holdout window without re-fetching from
the source (the holdout picker moved from Step 2 to Step 3.1, which mounts
after the bronze warm has already run once with no holdout).

Same reasoning as `test_artifact_service_replay_holdout.py`: storage is
faked (`RecordingStore`), never skipped. `_daily_frame` is reused from
`test_artifact_service.py` — a daily-spaced, value-equals-day-index frame is
exactly what makes row-count and content assertions checkable by VALUE.
"""

from __future__ import annotations

import pytest

from intergrations.object_store import STATUS_BAD, missing_pct
from schemas.preprocess import HoldoutSplitRequest, ResplitHoldoutRequest
from services import artifact_service
from tests.test_artifact_service import RecordingStore, _daily_frame


def test_resplit_cuts_the_window_from_train_and_builds_validate_with_lead_in() -> None:
    """Same split shape `_split_holdout` itself already proves — this test is
    about `resplit_holdout` wiring that function up and committing both
    sides, not re-proving the lead-in math."""
    src = _daily_frame(15)  # day0 (2026-01-01) .. day14 (2026-01-15)
    store = RecordingStore({"ds-1/artifacts/bronze-1/data.parquet": src})

    result = artifact_service.resplit_holdout(
        store,
        ResplitHoldoutRequest(
            source_key="ds-1/artifacts/bronze-1/data.parquet",
            target_key="ds-1/artifacts/bronze-2/data.parquet",
            holdout=HoldoutSplitRequest(
                from_time="2026-01-11", to_time="2026-01-13"  # day10-day12
            ),
        ),
    )

    train = store.objects["ds-1/artifacts/bronze-2/data.parquet"]
    validate = store.objects[
        "ds-1/artifacts/bronze-2/validate_data.parquet"
    ]

    # Holdout rows (day10-12) are gone from train.
    assert set(train["TI-101"]) == {
        0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 13.0, 14.0,
    }
    # validate = 7-day lead-in (day3-day9) then the holdout (day10-day12).
    assert list(validate["TI-101"]) == [
        3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0,
    ]
    assert result["row_count"] == len(train)
    assert result["validation_row_count"] == len(validate)
    assert result["validation_holdout_from"] == "2026-01-11 00:00:00"


def test_resplit_captures_the_holdouts_missing_rate() -> None:
    """MODEL-FLOW-010-T06: `validation_missing_pct` on the result must equal
    `missing_pct(validate_frame)` — computed once, while the frame is still
    in memory, not a compute-on-read scan against `validate_data.parquet`
    later (the DS-LAKE-012 trap at wide tag counts)."""
    src = _daily_frame(15)
    # day10 and day11 sit inside the validate window (day3-day12) built by
    # the same window as the test above — mark them Bad so the expected
    # rate is checkable by value: 2 of 10 validate rows -> 20%.
    src.loc[src["TI-101"].isin([10.0, 11.0]), "TI-101__status"] = STATUS_BAD
    store = RecordingStore({"ds-1/artifacts/bronze-1/data.parquet": src})

    result = artifact_service.resplit_holdout(
        store,
        ResplitHoldoutRequest(
            source_key="ds-1/artifacts/bronze-1/data.parquet",
            target_key="ds-1/artifacts/bronze-2/data.parquet",
            holdout=HoldoutSplitRequest(
                from_time="2026-01-11", to_time="2026-01-13"
            ),
        ),
    )

    validate = store.objects["ds-1/artifacts/bronze-2/validate_data.parquet"]
    assert result["validation_missing_pct"] == missing_pct(validate)
    assert result["validation_missing_pct"] == 20.0


def test_resplit_train_plus_validate_accounts_for_every_original_row() -> None:
    """Lead-in rows are COPIED into validate, not moved, so train ∪ validate
    (by content, ignoring the lead-in overlap) reconstructs every row the
    pristine source had — none silently dropped by the split itself."""
    src = _daily_frame(15)
    store = RecordingStore({"ds-1/artifacts/bronze-1/data.parquet": src})

    artifact_service.resplit_holdout(
        store,
        ResplitHoldoutRequest(
            source_key="ds-1/artifacts/bronze-1/data.parquet",
            target_key="ds-1/artifacts/bronze-2/data.parquet",
            holdout=HoldoutSplitRequest(
                from_time="2026-01-11", to_time="2026-01-13"
            ),
        ),
    )

    train = store.objects["ds-1/artifacts/bronze-2/data.parquet"]
    validate = store.objects[
        "ds-1/artifacts/bronze-2/validate_data.parquet"
    ]
    union = set(train["TI-101"]) | set(validate["TI-101"])
    assert union == set(src["TI-101"])


def test_resplitting_the_same_pristine_source_twice_never_sheds_rows() -> None:
    """The regression that matters (plan's own verification note): two edits
    to the holdout, BOTH reading the same never-split source, must each
    independently reconstruct the full original row content — no cumulative
    loss across edits, because neither split reads the other's output.

    NOT asserted as `row_count + validation_row_count == len(src)`: that sum
    double-counts the lead-in overlap (present in both train and validate by
    design), and the overlap's SIZE varies with how much lead-in the window's
    position actually has available — it is not the same between two
    different holdout windows, even over the same source. The invariant that
    actually holds regardless of window position is the UNION (by content).
    """
    src = _daily_frame(15)
    store = RecordingStore({"ds-1/artifacts/bronze-1/data.parquet": src})

    artifact_service.resplit_holdout(
        store,
        ResplitHoldoutRequest(
            source_key="ds-1/artifacts/bronze-1/data.parquet",
            target_key="ds-1/artifacts/bronze-2/data.parquet",
            holdout=HoldoutSplitRequest(
                from_time="2026-01-11", to_time="2026-01-13"
            ),
        ),
    )
    artifact_service.resplit_holdout(
        store,
        ResplitHoldoutRequest(
            source_key="ds-1/artifacts/bronze-1/data.parquet",  # same pristine root
            target_key="ds-1/artifacts/bronze-3/data.parquet",
            holdout=HoldoutSplitRequest(
                from_time="2026-01-05", to_time="2026-01-07"  # different window
            ),
        ),
    )

    for target in (
        "ds-1/artifacts/bronze-2/data.parquet",
        "ds-1/artifacts/bronze-3/data.parquet",
    ):
        train = store.objects[target]
        validate = store.objects[target.replace("data.parquet", "validate_data.parquet")]
        union = set(train["TI-101"]) | set(validate["TI-101"])
        assert union == set(src["TI-101"]), (
            f"{target}: split did not reconstruct every original row"
        )


def test_resplit_refuses_when_the_holdout_matches_no_rows() -> None:
    """Same refusal `materialize()` applies after `_split_holdout` — cutting
    the holdout can, in principle, leave nothing on either side."""
    src = _daily_frame(5)
    store = RecordingStore({"ds-1/artifacts/bronze-1/data.parquet": src})

    with pytest.raises(ValueError, match="matched no rows"):
        artifact_service.resplit_holdout(
            store,
            ResplitHoldoutRequest(
                source_key="ds-1/artifacts/bronze-1/data.parquet",
                target_key="ds-1/artifacts/bronze-2/data.parquet",
                holdout=HoldoutSplitRequest(
                    from_time="2027-01-01", to_time="2027-01-02"
                ),
            ),
        )
    assert store.writes == [], "a refused resplit must write nothing"


def test_resplit_refuses_when_the_holdout_covers_the_whole_source() -> None:
    """Mirrors `test_split_holdout_on_the_whole_fetch_window_leaves_train_empty`
    — `_split_holdout` itself stays an unconditional split, so this endpoint
    (like `materialize()`) is what turns an empty train into a loud refusal
    via `assert_frame_is_usable`, never a silently committed 0-row artifact."""
    src = _daily_frame(5)
    store = RecordingStore({"ds-1/artifacts/bronze-1/data.parquet": src})

    with pytest.raises(ValueError):
        artifact_service.resplit_holdout(
            store,
            ResplitHoldoutRequest(
                source_key="ds-1/artifacts/bronze-1/data.parquet",
                target_key="ds-1/artifacts/bronze-2/data.parquet",
                holdout=HoldoutSplitRequest(
                    from_time="2026-01-01", to_time="2026-01-05"
                ),
            ),
        )
    assert store.writes == [], "a refused resplit must write nothing"
