"""DS-LAKE-005B-D-T02/T04 chart parity gate.

Same two-layer shape as `test_parity.py`, applied to the chart services
(`histogram_service.py`, `boxplot_service.py`, `scatter_service.py`)
instead of the cleaning engine:

1. **Fixture integrity** — the golden `packages/parity-fixtures/charts/*.json`
   files exist, are well-formed, and cover every engine.
2. **Parity assertions** — build the REAL `HistogramRequest`/`BoxplotRequest`/
   `ScatterRequest` from each fixture's `config`, run it through
   `build_histogram`/`build_boxplot`/`build_scatter` against a read-only
   fake store seeded with the fixture's `input`, and compare the result to
   `expected` within tolerance.

SCATTER is a narrower parity check than histogram/boxplot: `points`/
`downsampled` have no client equivalent (decimation is server-only,
ADR-DS-LAKE-005B-D-scatter-decimation — see `scatter_service.py`'s own
docstring), so only the regression fields (`n`/`slope`/`intercept`/`r2`)
are compared — `_project_for_comparison` strips the rest before the
generic deep-compare runs.

SCOPE: this proves the STATISTICS/REGRESSION match for a fixed, empty-
operations window — not reactivity to a live rule edit
(DS-LAKE-005B-D-V02, a separate, not-yet-built item). See
`chart-parity-fixtures.test.ts`'s own header for the full quirk list this
pins.

Regenerate the fixtures with:  pnpm --filter client test
Run this suite with:          apps/python/.venv/bin/python -m pytest tests -q
"""

from __future__ import annotations

import copy
import json
import math
from typing import Any

import pandas as pd
import pytest

from conftest import CHART_FIXTURE_DIR, chart_fixture_paths, load_fixture
from schemas.preprocess import BoxplotRequest, HistogramRequest, ScatterRequest
from services.boxplot_service import build_boxplot
from services.histogram_service import build_histogram
from services.scatter_service import build_scatter
from test_parity import wide_to_frame


class _ReadOnlyStore:
    """Read-only fake object store. Mirrors the guarantee
    `test_preview_service.NoWriteStore` makes for `/preview` — defined
    locally rather than cross-imported, matching this codebase's own
    precedent of each service test owning its store fake
    (`test_artifact_service.RecordingStore` does the same).

    Deliberately NOT a `MagicMock`: anything outside the read allowlist
    falls through to `__getattr__` and raises, so a chart service that
    started writing would be caught here even if nobody remembered to add
    an assertion for it.
    """

    def __init__(self, frame: pd.DataFrame) -> None:
        self._frame = frame
        self.reads: list[tuple[str, list[str] | None]] = []

    def get_frame(self, key: str, columns: list[str] | None = None) -> pd.DataFrame:
        self.reads.append((key, columns))
        if columns is None:
            return self._frame.copy()
        missing = [c for c in columns if c not in self._frame.columns]
        if missing:
            raise ValueError(f"No match for FieldRef.Name({missing[0]!r}) in schema")
        return self._frame[columns].copy()

    def __getattr__(self, name: str):
        raise AssertionError(
            f"chart service called {name!r} on the object store. Chart "
            "endpoints are read-only: they must not write, delete, or "
            "create anything."
        )


def _run_case(fixture: dict[str, Any]) -> dict[str, Any]:
    frame = wide_to_frame(fixture["input"])
    store = _ReadOnlyStore(frame)
    config = fixture["config"]
    engine = fixture["engine"]

    if engine == "histogram":
        request = HistogramRequest(
            source_key=config["source_key"],
            tags=config["tags"],
            bin_count=config["bin_count"],
            kde_samples=config["kde_samples"],
        )
        return build_histogram(store, request)
    if engine == "boxplot":
        request = BoxplotRequest(
            source_key=config["source_key"],
            tags=config["tags"],
            outlier_cap=config["outlier_cap"],
        )
        return build_boxplot(store, request)
    if engine == "scatter":
        request = ScatterRequest(
            source_key=config["source_key"],
            x_tag=config["x_tag"],
            y_tag=config["y_tag"],
            max_points=config["max_points"],
        )
        return build_scatter(store, request)
    raise AssertionError(f"unknown chart engine {engine!r}")


def _project_for_comparison(engine: str, response: dict[str, Any]) -> dict[str, Any]:
    """Scatter's `points`/`downsampled` have no client equivalent — the
    client plots every point, decimation is server-only
    (ADR-DS-LAKE-005B-D-scatter-decimation). Parity is checked on the
    regression fields only, not the plotted sample."""
    if engine == "scatter":
        return {k: v for k, v in response.items() if k not in ("points", "downsampled")}
    return response


def assert_close(actual: Any, expected: Any, path: str) -> None:
    """Structural deep-compare with float tolerance — the chart-response
    analogue of `test_parity.assert_grids_match`, generalised over an
    arbitrary JSON shape instead of a fixed grid. Same tolerance (`rel_tol
    1e-9, abs_tol 1e-12`) so a KDE curve's last-ulp IEEE-754 noise never
    manufactures a false failure, while a real divergence (wrong bandwidth,
    wrong quartile convention) still moves a value far more than that.
    """
    if isinstance(expected, dict):
        assert isinstance(actual, dict), f"{path}: expected dict, got {type(actual)}"
        assert actual.keys() == expected.keys(), (
            f"{path}: key mismatch — {sorted(actual.keys())} != {sorted(expected.keys())}"
        )
        for key in expected:
            assert_close(actual[key], expected[key], f"{path}.{key}")
    elif isinstance(expected, list):
        assert isinstance(actual, list), f"{path}: expected list, got {type(actual)}"
        assert len(actual) == len(expected), (
            f"{path}: length differs — {len(actual)} vs {len(expected)}"
        )
        for i, (a, e) in enumerate(zip(actual, expected)):
            assert_close(a, e, f"{path}[{i}]")
    elif expected is None:
        assert actual is None, f"{path}: expected None, got {actual!r}"
    elif isinstance(expected, float):
        assert actual is not None, f"{path}: expected {expected!r}, got None"
        assert math.isclose(actual, expected, rel_tol=1e-9, abs_tol=1e-12), (
            f"{path}: {actual!r} != {expected!r}. Match the browser bug-for-bug "
            "(see the quirk table in chart-parity-fixtures.test.ts) — do not "
            "'correct' it here."
        )
    else:
        assert actual == expected, f"{path}: {actual!r} != {expected!r}"


# ─────────────────────────── layer 1: integrity ───────────────────────────


def test_chart_index_lists_every_case() -> None:
    idx_path = CHART_FIXTURE_DIR / "index.json"
    if not idx_path.exists():
        pytest.fail(
            f"Missing {idx_path}. Generate it with: pnpm --filter client test"
        )
    with idx_path.open(encoding="utf-8") as fh:
        idx = json.load(fh)

    on_disk = {p.stem for p in chart_fixture_paths()}
    listed = {case["name"] for case in idx["cases"]}
    assert listed == on_disk, (
        "charts/index.json is out of sync with the fixture files. "
        "Regenerate with: pnpm --filter client test"
    )


def test_chart_covers_every_engine() -> None:
    engines = {load_fixture(p)["engine"] for p in chart_fixture_paths()}
    assert engines == {"histogram", "boxplot", "scatter"}, (
        f"expected histogram, boxplot and scatter fixtures, got {engines}"
    )


def test_chart_fixture_is_well_formed(chart_fixture: dict[str, Any]) -> None:
    for key in ("name", "engine", "input", "config", "expected"):
        assert key in chart_fixture, f"{chart_fixture.get('name')} is missing {key!r}"
    assert chart_fixture["engine"] in {"histogram", "boxplot", "scatter"}
    assert chart_fixture["input"]["tags"], f"{chart_fixture['name']}.input has no tags"


# ───────────────────── layer 2: parity ─────────────────────


def test_chart_matches_client_output(chart_fixture: dict[str, Any]) -> None:
    actual = _run_case(chart_fixture)
    projected = _project_for_comparison(chart_fixture["engine"], actual)
    assert_close(projected, chart_fixture["expected"], chart_fixture["name"])


def test_chart_service_never_writes(chart_fixture: dict[str, Any]) -> None:
    """Same read-only guarantee `test_preview_service` asserts for
    `/preview` — a chart request must not create, delete, or mutate any
    object. `_ReadOnlyStore.__getattr__` already enforces this during
    `_run_case`; this test just proves the guard is armed for THIS
    fixture's own request shape, not only in the abstract."""
    frame = wide_to_frame(chart_fixture["input"])
    store = _ReadOnlyStore(frame)
    with pytest.raises(AssertionError, match="read-only"):
        store.put_frame


def test_sabotage_probe_catches_a_mutated_value() -> None:
    """DS-LAKE-006-V01's standard, required by this task's own scope_note:
    'a gate that only reports green proves nothing.' Runs the real
    histogram case, confirms it genuinely passes, then deep-copies the
    expected output, mutates one number, and confirms the comparator FAILS.
    Never touches the fixture file on disk — nothing needs restoring."""
    paths = chart_fixture_paths()
    histogram_path = next(
        p for p in paths if p.stem == "histogram_two_tags_default"
    )
    fixture = load_fixture(histogram_path)

    actual = _run_case(fixture)
    # Prove the real output matches BEFORE sabotaging — a probe against an
    # already-broken fixture would prove nothing about the comparator.
    assert_close(actual, fixture["expected"], fixture["name"])

    sabotaged = copy.deepcopy(fixture["expected"])
    sabotaged["tags"][0]["mean"] += 1000.0

    with pytest.raises(AssertionError, match="mean"):
        assert_close(actual, sabotaged, fixture["name"])

    # A status-list-shaped divergence (wrong tag count) must also be caught,
    # not just a numeric drift — proves the structural branches, not only
    # the float branch.
    truncated = copy.deepcopy(fixture["expected"])
    truncated["tags"].pop()
    with pytest.raises(AssertionError, match="length differs"):
        assert_close(actual, truncated, fixture["name"])
