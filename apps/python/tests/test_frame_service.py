"""Normalisation of PI (tag-major) and SQL (row-major) into one frame.

Pure and offline — no MinIO, no PI, no database. The invariant under test is
the missing-cell convention inherited from the browser: a hole is
``{value: 0.0, status: Bad}``, never NaN and never a dropped row. Cleaning ops
downstream act on Bad cells, so turning holes into NaN or silently shortening
the grid would change results without failing anything.
"""

from __future__ import annotations

import pytest

from intergrations.object_store import (
    STATUS_BAD,
    STATUS_GOOD,
    STATUS_QUESTIONABLE,
    assert_frame_shape,
    tag_columns,
)
from services.frame_service import (
    MISSING_VALUE,
    from_pi_response,
    from_sql_response,
    mark_questionable,
)


def pi_tag(name: str, points: list[tuple[str, object]], status: str = "ok") -> dict:
    return {
        "tag_name": name,
        "status": status,
        "data": [{"timestamp": ts, "value": v} for ts, v in points],
    }


# ── PI: tag-major, no shared time axis ───────────────────────────────────


def test_ragged_tags_are_unioned_onto_one_axis() -> None:
    """The reason this module exists.

    TI-101 samples at :00 and :02, VI-202 at :01 and :02. Neither tag covers
    the other's stamps, so the frame must span the union and fill the gaps.
    """
    payload = {
        "results": [
            pi_tag(
                "TI-101",
                [("2026-06-22 00:00:00", 72.4), ("2026-06-22 00:02:00", 73.0)],
            ),
            pi_tag(
                "VI-202",
                [("2026-06-22 00:01:00", 4.5), ("2026-06-22 00:02:00", 4.7)],
            ),
        ]
    }
    frame = from_pi_response(payload)

    assert len(frame) == 3
    assert tag_columns(frame) == ["TI-101", "VI-202"]

    # The hole is addressable, not absent.
    assert frame.loc[1, "TI-101"] == MISSING_VALUE
    assert frame.loc[1, "TI-101__status"] == STATUS_BAD
    assert frame.loc[0, "VI-202__status"] == STATUS_BAD
    # Real readings survive untouched.
    assert frame.loc[0, "TI-101"] == 72.4
    assert frame.loc[2, "VI-202"] == 4.7


def test_rows_are_sorted_by_timestamp() -> None:
    payload = {
        "results": [
            pi_tag(
                "TI-101",
                [
                    ("2026-06-22 00:05:00", 3.0),
                    ("2026-06-22 00:01:00", 1.0),
                    ("2026-06-22 00:03:00", 2.0),
                ],
            )
        ]
    }
    frame = from_pi_response(payload)
    assert frame["TI-101"].tolist() == [1.0, 2.0, 3.0]
    assert frame["timestamp"].is_monotonic_increasing


def test_digital_state_strings_become_bad_holes() -> None:
    """PI returns `float | str | None`; strings must not poison the column."""
    payload = {
        "results": [
            pi_tag(
                "TI-101",
                [
                    ("2026-06-22 00:00:00", "Pt Created"),
                    ("2026-06-22 00:01:00", None),
                    ("2026-06-22 00:02:00", 72.4),
                ],
            )
        ]
    }
    frame = from_pi_response(payload)

    assert frame["TI-101"].tolist() == [MISSING_VALUE, MISSING_VALUE, 72.4]
    assert frame["TI-101__status"].tolist() == [STATUS_BAD, STATUS_BAD, STATUS_GOOD]
    # No NaN anywhere — the whole point of the 0.0 convention.
    assert not frame["TI-101"].isna().any()


def test_numeric_strings_are_accepted() -> None:
    payload = {"results": [pi_tag("TI-101", [("2026-06-22 00:00:00", " 72.4 ")])]}
    frame = from_pi_response(payload)
    assert frame.loc[0, "TI-101"] == 72.4
    assert frame.loc[0, "TI-101__status"] == STATUS_GOOD


def test_booleans_are_not_treated_as_numbers() -> None:
    """bool subclasses int in Python; True must not silently become 1.0."""
    payload = {"results": [pi_tag("TI-101", [("2026-06-22 00:00:00", True)])]}
    frame = from_pi_response(payload)
    assert frame.loc[0, "TI-101__status"] == STATUS_BAD


def test_failed_tag_keeps_its_column_all_bad() -> None:
    """A failed tag must stay visible, not disappear from the dataset."""
    payload = {
        "results": [
            pi_tag("TI-101", [("2026-06-22 00:00:00", 72.4)]),
            pi_tag("FI-404", [("2026-06-22 00:00:00", 120.0)], status="failed"),
        ]
    }
    frame = from_pi_response(payload)

    assert "FI-404" in tag_columns(frame)
    assert set(frame["FI-404__status"].tolist()) == {STATUS_BAD}
    assert frame.loc[0, "FI-404"] == MISSING_VALUE


def test_unparseable_timestamps_are_skipped() -> None:
    payload = {
        "results": [
            pi_tag("TI-101", [("not-a-date", 1.0), ("2026-06-22 00:00:00", 72.4)])
        ]
    }
    frame = from_pi_response(payload)
    assert len(frame) == 1
    assert frame.loc[0, "TI-101"] == 72.4


def test_empty_pi_response_yields_an_empty_frame() -> None:
    frame = from_pi_response({"results": []})
    assert len(frame) == 0
    assert tag_columns(frame) == []


def test_pi_frame_satisfies_the_storage_contract() -> None:
    payload = {"results": [pi_tag("TI-101", [("2026-06-22 00:00:00", 72.4)])]}
    assert_frame_shape(from_pi_response(payload))


def test_reserved_tag_name_is_rejected() -> None:
    payload = {"results": [pi_tag("FOO__status", [("2026-06-22 00:00:00", 1.0)])]}
    with pytest.raises(ValueError, match="reserved"):
        from_pi_response(payload)


# ── SQL: row-major, already aligned ──────────────────────────────────────


def sql_payload() -> dict:
    return {
        "columns": ["ts", "TI-101", "FI-404"],
        "rows": [
            {"ts": "2026-06-22 00:00:00", "TI-101": 72.4, "FI-404": 120.0},
            {"ts": "2026-06-22 00:01:00", "TI-101": None, "FI-404": 121.0},
        ],
        "row_count": 2,
    }


def test_sql_rows_map_straight_across() -> None:
    frame = from_sql_response(sql_payload(), timestamp_column="ts")

    assert tag_columns(frame) == ["TI-101", "FI-404"]
    assert len(frame) == 2
    assert frame.loc[0, "TI-101"] == 72.4
    # NULL becomes the same Bad hole the PI path produces.
    assert frame.loc[1, "TI-101"] == MISSING_VALUE
    assert frame.loc[1, "TI-101__status"] == STATUS_BAD
    assert "ts" not in frame.columns


def test_sql_tag_subset_is_honoured() -> None:
    frame = from_sql_response(sql_payload(), timestamp_column="ts", tags=["FI-404"])
    assert tag_columns(frame) == ["FI-404"]


def test_sql_missing_timestamp_column_is_an_actionable_error() -> None:
    with pytest.raises(ValueError, match="not in the result set"):
        from_sql_response(sql_payload(), timestamp_column="nope")


def test_sql_unknown_requested_column_is_an_actionable_error() -> None:
    with pytest.raises(ValueError, match="not in the result set"):
        from_sql_response(sql_payload(), timestamp_column="ts", tags=["GHOST"])


def test_both_sources_produce_the_same_shape() -> None:
    """PI and SQL disagree on the wire; downstream must not be able to tell."""
    pi = from_pi_response(
        {"results": [pi_tag("TI-101", [("2026-06-22 00:00:00", 72.4)])]}
    )
    sql = from_sql_response(
        {
            "columns": ["ts", "TI-101"],
            "rows": [{"ts": "2026-06-22 00:00:00", "TI-101": 72.4}],
            "row_count": 1,
        },
        timestamp_column="ts",
    )

    assert list(pi.columns) == list(sql.columns)
    assert pi["TI-101"].tolist() == sql["TI-101"].tolist()
    assert pi["TI-101__status"].tolist() == sql["TI-101__status"].tolist()


# ── quality overlay ──────────────────────────────────────────────────────


def test_mark_questionable_changes_status_not_values() -> None:
    frame = from_pi_response(
        {
            "results": [
                pi_tag(
                    "TI-101",
                    [("2026-06-22 00:00:00", 72.4), ("2026-06-22 00:01:00", 73.0)],
                )
            ]
        }
    )
    out = mark_questionable(frame, "TI-101", [False, True])

    assert out["TI-101"].tolist() == frame["TI-101"].tolist()
    assert out["TI-101__status"].tolist() == [STATUS_GOOD, STATUS_QUESTIONABLE]
    # Original is untouched — callers chain these.
    assert frame["TI-101__status"].tolist() == [STATUS_GOOD, STATUS_GOOD]


def test_mark_questionable_selects_positionally_not_by_label() -> None:
    """Regression: an int mask used to mark the WRONG cells, silently.

    `.loc[[1, 0, 0]]` is read by pandas as row LABELS, so a caller passing an
    int mask meaning "row 0 only" marked rows 1 and 0 — [2,2,0] instead of
    [2,0,0], with no exception. The length check cannot catch it because the
    length is correct.
    """
    frame = from_pi_response(
        {
            "results": [
                pi_tag(
                    "TI-101",
                    [
                        ("2026-06-22 00:00:00", 0.0),
                        ("2026-06-22 00:01:00", 1.0),
                        ("2026-06-22 00:02:00", 2.0),
                    ],
                )
            ]
        }
    )

    expected = [STATUS_QUESTIONABLE, STATUS_GOOD, STATUS_GOOD]
    assert (
        mark_questionable(frame, "TI-101", [True, False, False])[
            "TI-101__status"
        ].tolist()
        == expected
    )
    # Truthy ints must mean the same thing as bools, not label lookups.
    assert (
        mark_questionable(frame, "TI-101", [1, 0, 0])["TI-101__status"].tolist()
        == expected
    )


def test_mark_questionable_handles_a_non_contiguous_index() -> None:
    """An upstream row drop can leave labels like [1, 2] rather than [0, 1]."""
    frame = from_pi_response(
        {
            "results": [
                pi_tag(
                    "TI-101",
                    [
                        ("2026-06-22 00:00:00", 0.0),
                        ("2026-06-22 00:01:00", 1.0),
                        ("2026-06-22 00:02:00", 2.0),
                    ],
                )
            ]
        }
    ).iloc[1:]

    assert frame.index.tolist() == [1, 2]
    out = mark_questionable(frame, "TI-101", [True, False])
    assert out["TI-101__status"].tolist() == [STATUS_QUESTIONABLE, STATUS_GOOD]


def test_mark_questionable_rejects_a_mismatched_mask() -> None:
    frame = from_pi_response(
        {"results": [pi_tag("TI-101", [("2026-06-22 00:00:00", 72.4)])]}
    )
    with pytest.raises(ValueError, match="mask length"):
        mark_questionable(frame, "TI-101", [True, False])
    with pytest.raises(ValueError, match="Unknown tag"):
        mark_questionable(frame, "GHOST", [True])
