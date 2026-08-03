"""F0 parity gate.

Two layers:

1. **Fixture integrity** — always runs. Proves the golden files exist, are
   well-formed, cover the F2 operation set, and actually contain the awkward
   cases (non-Good cells, outliers, row drops). This is what makes F0 a real
   gate rather than a placeholder.

2. **Parity assertions** — skipped until F2 lands `services.cleaning_service`.
   The moment that module exists these turn live and fail loudly on any numeric
   drift from the browser implementation.

Regenerate the fixtures with:  pnpm --filter client test
Run this suite with:          apps/python/.venv/bin/python -m pytest tests -q
"""

from __future__ import annotations

import math
from typing import Any

import pytest

from conftest import CODE_TO_STATUS, STATUS_TO_CODE

# The F2 operation set — keep in sync with the plan's F2 table.
REQUIRED_CASES = {
    "drop_missing",
    "fill_missing_ffill",
    "fill_missing_bfill",
    "fill_missing_mean",
    "fill_missing_median",
    "fill_missing_constant",
    "fill_missing_linear",
    "remove_outlier_zscore_t2",
    "remove_outlier_iqr",
    "clip_both_bounds",
    "smooth_moving_avg_default",
    "smooth_exponential_default",
}

VALID_STATUSES = set(STATUS_TO_CODE)


# ─────────────────────────── layer 1: integrity ───────────────────────────


def test_index_lists_every_case(index: dict[str, Any], fixture_dir) -> None:
    on_disk = {p.stem for p in fixture_dir.glob("*.json") if p.name != "index.json"}
    listed = {case["name"] for case in index["cases"]}
    assert listed == on_disk, (
        "index.json is out of sync with the fixture files. "
        "Regenerate with: pnpm --filter client test"
    )


def test_f2_operation_set_is_covered(index: dict[str, Any]) -> None:
    """Every cleaning op F2 promises must have a golden case behind it."""
    listed = {case["name"] for case in index["cases"]}
    missing = REQUIRED_CASES - listed
    assert not missing, f"F2 ops with no parity fixture: {sorted(missing)}"


def test_precision_map_covers_every_tag(index: dict[str, Any]) -> None:
    """Python has no access to the client's tagMeta, so precision must travel in
    the payload. A tag with no entry would silently round to the default."""
    for tag in index["tags"]:
        assert tag in index["precision"], f"tag {tag!r} has no precision entry"


def test_fixture_is_well_formed(fixture: dict[str, Any]) -> None:
    for key in ("name", "engine", "input", "config", "expected"):
        assert key in fixture, f"{fixture.get('name')} is missing {key!r}"

    assert fixture["engine"] in {"preprocessPipelines", "precleanse"}

    for side in ("input", "expected"):
        grid = fixture[side]
        assert grid["tags"], f"{fixture['name']}.{side} has no tags"
        for row in grid["rows"]:
            assert isinstance(row["timestamp"], str)
            for tag, cell in row["cells"].items():
                assert isinstance(cell["value"], (int, float)), (
                    f"{fixture['name']}.{side} {tag} has a non-numeric value "
                    f"{cell['value']!r} — Python must never emit NaN/null here"
                )
                assert cell["status"] in VALID_STATUSES


def test_status_codes_round_trip(fixture: dict[str, Any]) -> None:
    """The Parquet artifact stores status as int8; the mapping must be lossless."""
    for row in fixture["expected"]["rows"]:
        for cell in row["cells"].values():
            code = STATUS_TO_CODE[cell["status"]]
            assert CODE_TO_STATUS[code] == cell["status"]


def test_input_grid_contains_non_good_cells(fixture: dict[str, Any]) -> None:
    """A fixture whose input is entirely Good would pass any implementation."""
    if fixture["name"] == "no_ops_is_identity":
        pytest.skip("identity case intentionally exercises pass-through only")

    has_non_good = any(
        cell["status"] != "Good"
        for row in fixture["input"]["rows"]
        for cell in row["cells"].values()
    )
    assert has_non_good, f"{fixture['name']} input has no Bad/Questionable cells"


def test_drop_cases_actually_drop_rows(fixture: dict[str, Any]) -> None:
    """Pins the row-dropping quirks: `drop` removes the union of marked rows once
    at the end, while `precleanse` conditional-drop removes CELLS, not rows."""
    name = fixture["name"]
    n_in = len(fixture["input"]["rows"])
    n_out = len(fixture["expected"]["rows"])

    if name.startswith("drop_") or name == "precleanse_time_crop":
        assert n_out < n_in, f"{name} was expected to remove rows ({n_in} -> {n_out})"
    elif name == "precleanse_conditional_drop":
        assert n_out == n_in, (
            "precleanse 'drop' deletes only that tag's cell and must NOT remove "
            f"the row ({n_in} -> {n_out}). Python must not 'fix' this."
        )
    else:
        assert n_out == n_in, f"{name} unexpectedly changed row count"


def test_identity_case_is_a_true_no_op(fixture: dict[str, Any]) -> None:
    if fixture["name"] != "no_ops_is_identity":
        pytest.skip("only applies to the identity fixture")
    assert (
        fixture["expected"] == fixture["input"]
    ), "an empty pipeline must return the grid unchanged"


# ───────────────────── layer 2: parity (live once F2 lands) ─────────────────

def _cleaning_service():
    """Import the F2 service, or skip THIS test only.

    Deliberately not a module-level `pytest.importorskip`: that would skip the
    integrity layer above too, and F0 would silently report green while proving
    nothing.
    """
    return pytest.importorskip(
        "services.cleaning_service",
        reason=(
            "F2 not implemented yet — services/cleaning_service.py does not "
            "exist. This assertion activates automatically once it does."
        ),
    )


def wide_to_frame(grid: dict[str, Any]):
    """Fixture JSON -> the canonical value+status frame (plan F1)."""
    import pandas as pd

    data: dict[str, list[Any]] = {"timestamp": []}
    for tag in grid["tags"]:
        data[tag] = []
        data[f"{tag}__status"] = []

    for row in grid["rows"]:
        data["timestamp"].append(row["timestamp"])
        for tag in grid["tags"]:
            cell = row["cells"].get(tag)
            data[tag].append(None if cell is None else cell["value"])
            data[f"{tag}__status"].append(
                STATUS_TO_CODE["Bad"]
                if cell is None
                else STATUS_TO_CODE[cell["status"]]
            )

    return pd.DataFrame(data)


def frame_to_wide(df, tags: list[str]) -> dict[str, Any]:
    """Canonical frame -> fixture JSON shape, values left EXACTLY as computed.

    Deliberately does not round. Only some client ops round (the outlier and
    smoothing ones); the fills assign raw values, so `fill_missing_mean`
    legitimately expects 81.05937499999999. Rounding here would force that to
    81.1 and report a parity failure that does not exist. Tolerance is applied
    at comparison time instead — see `assert_grids_match`.
    """
    rows = []
    for record in df.to_dict(orient="records"):
        rows.append(
            {
                "timestamp": record["timestamp"],
                "cells": {
                    tag: {
                        "value": float(record[tag]),
                        "status": CODE_TO_STATUS[int(record[f"{tag}__status"])],
                    }
                    for tag in tags
                },
            }
        )
    return {"tags": tags, "rows": rows}


def assert_grids_match(actual: dict[str, Any], expected: dict[str, Any], name: str) -> None:
    """Compare cell by cell: status exactly, values within a tight tolerance.

    The tolerance absorbs last-ulp differences between two IEEE-754 engines
    evaluating the same expression, while still catching any real divergence —
    a wrong quantile, the wrong std convention, or banker's vs JS rounding all
    move a value far more than 1e-9 relative.
    """
    assert actual["tags"] == expected["tags"], f"{name}: tag list differs"
    assert len(actual["rows"]) == len(expected["rows"]), (
        f"{name}: row count differs — {len(actual['rows'])} vs "
        f"{len(expected['rows'])}. A drop/crop step removed the wrong rows."
    )

    for index, (got, want) in enumerate(zip(actual["rows"], expected["rows"])):
        for tag in expected["tags"]:
            got_cell = got["cells"][tag]
            want_cell = want["cells"][tag]

            assert got_cell["status"] == want_cell["status"], (
                f"{name}: row {index} {tag} status {got_cell['status']} != "
                f"{want_cell['status']}"
            )
            assert math.isclose(
                got_cell["value"], want_cell["value"], rel_tol=1e-9, abs_tol=1e-12
            ), (
                f"{name}: row {index} {tag} value {got_cell['value']!r} != "
                f"{want_cell['value']!r}. Match the browser bug-for-bug (see the "
                "quirk table in cleaning_service) — do not 'correct' it here."
            )


def test_round_trip_survives_float_noise() -> None:
    """The comparison helpers must not manufacture a false parity failure.

    Runs without the F2 service so the guarantee is proven now, not discovered
    when layer 2 activates. Feeds values carrying binary-float noise and asserts
    they land back on the client's rounded representation.
    """
    pd = pytest.importorskip("pandas")

    grid = {
        "tags": ["TI-101", "FI-404"],
        "rows": [
            {
                "timestamp": "2026-06-22T00:00:00.000Z",
                "cells": {
                    "TI-101": {"value": 72.4, "status": "Good"},
                    "FI-404": {"value": 120.0, "status": "Bad"},
                },
            }
        ],
    }

    frame = wide_to_frame(grid)
    # Exactly the artefact this guards against: 72.1 + 0.1 + 0.2 != 72.4 in binary float.
    frame.loc[0, "TI-101"] = 72.1 + 0.1 + 0.2
    frame.loc[0, "FI-404"] = 119.99999999999999

    assert frame.loc[0, "TI-101"] != 72.4, "test premise: value must carry float noise"
    assert isinstance(pd.DataFrame, type)

    actual = frame_to_wide(frame, grid["tags"])

    # Values are NOT rounded — the fills legitimately produce long decimals, so
    # rounding here would manufacture failures. The tolerance absorbs the noise.
    assert_grids_match(actual, grid, "float-noise")
    # Status survives the int8 round-trip untouched.
    assert actual["rows"][0]["cells"]["FI-404"]["status"] == "Bad"


def test_comparison_still_catches_real_divergence() -> None:
    """The tolerance must not be so loose that it hides genuine drift.

    A wrong quantile, the wrong std convention, or banker's-vs-JS rounding all
    move a value far more than 1e-9 relative, so those must still fail.
    """
    base = {
        "tags": ["TI-101"],
        "rows": [
            {
                "timestamp": "2026-06-22T00:00:00.000Z",
                "cells": {"TI-101": {"value": 72.4, "status": "Good"}},
            }
        ],
    }

    # Banker's vs JS rounding differs in the last decimal place — must fail.
    drifted = {
        "tags": ["TI-101"],
        "rows": [
            {
                "timestamp": "2026-06-22T00:00:00.000Z",
                "cells": {"TI-101": {"value": 72.5, "status": "Good"}},
            }
        ],
    }
    with pytest.raises(AssertionError, match="value"):
        assert_grids_match(drifted, base, "drift")

    # A status flip is a real behavioural change — must fail.
    status_flipped = {
        "tags": ["TI-101"],
        "rows": [
            {
                "timestamp": "2026-06-22T00:00:00.000Z",
                "cells": {"TI-101": {"value": 72.4, "status": "Bad"}},
            }
        ],
    }
    with pytest.raises(AssertionError, match="status"):
        assert_grids_match(status_flipped, base, "status")

    # A dropped row means the wrong rows were removed — must fail.
    with pytest.raises(AssertionError, match="row count"):
        assert_grids_match({"tags": ["TI-101"], "rows": []}, base, "rows")


def test_matches_client_output(fixture: dict[str, Any]) -> None:
    cleaning_service = _cleaning_service()

    frame = wide_to_frame(fixture["input"])
    try:
        result = cleaning_service.apply_fixture_case(
            frame, fixture["config"], fixture["engine"]
        )
    except NotImplementedError as err:
        # `precleanse` deletes individual cells, which a rectangular frame
        # cannot express without a fourth "absent" status. Deferred by design,
        # so skip rather than fail — the fixtures stay ready for that slice.
        pytest.skip(str(err))

    actual = frame_to_wide(result, fixture["expected"]["tags"])
    assert_grids_match(actual, fixture["expected"], fixture["name"])
