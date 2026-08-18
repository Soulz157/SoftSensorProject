"""Shared fixtures for the parity suite.

Loads the golden JSON written by
`apps/client/lib/__tests__/parity-fixtures.test.ts` (regenerate with
`pnpm --filter client test`). Those fixtures are the contract: they encode what
the browser does today, quirks included, and Python must match them exactly.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest

# apps/python/tests -> apps/python -> apps -> repo root
SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_ROOT.parents[1]
FIXTURE_DIR = REPO_ROOT / "packages" / "parity-fixtures"

# DS-LAKE-005B-D-T02 — chart (histogram/boxplot) fixtures live in a SIBLING
# subdirectory, not mixed into FIXTURE_DIR itself. `FIXTURE_DIR.glob("*.json")`
# above is non-recursive, so this directory is already invisible to the F0
# grid suite's own `fixture_paths()`/`pytest_generate_tests` branch — no
# widening of that suite's `engine` enum or grid-shaped assertions.
CHART_FIXTURE_DIR = FIXTURE_DIR / "charts"

# The suite imports top-level service packages (`intergrations`, `services`).
# pytest only puts the *test* directory on sys.path, so those resolve when the
# suite runs from apps/python but NOT from the repo root or CI. Insert the
# service root explicitly so the working directory stops mattering.
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

# Wire encoding for Cell.status in the Parquet artifact (see plan F1).
STATUS_TO_CODE = {"Good": 0, "Bad": 1, "Questionable": 2}
CODE_TO_STATUS = {v: k for k, v in STATUS_TO_CODE.items()}


def fixture_paths() -> list[Path]:
    """Every case file, excluding the index manifest."""
    return sorted(p for p in FIXTURE_DIR.glob("*.json") if p.name != "index.json")


def chart_fixture_paths() -> list[Path]:
    """Every chart case file, excluding the index manifest. Separate glob
    root (`CHART_FIXTURE_DIR`, not `FIXTURE_DIR`) so this never overlaps
    `fixture_paths()` above."""
    return sorted(
        p for p in CHART_FIXTURE_DIR.glob("*.json") if p.name != "index.json"
    )


def load_fixture(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def load_index() -> dict[str, Any]:
    with (FIXTURE_DIR / "index.json").open(encoding="utf-8") as fh:
        return json.load(fh)


@pytest.fixture(scope="session")
def fixture_dir() -> Path:
    if not FIXTURE_DIR.exists():
        pytest.fail(
            f"Fixture directory missing: {FIXTURE_DIR}\n"
            "Generate it with: pnpm --filter client test"
        )
    return FIXTURE_DIR


@pytest.fixture(scope="session")
def index(fixture_dir: Path) -> dict[str, Any]:
    return load_index()


def pytest_generate_tests(metafunc: pytest.Metafunc) -> None:
    """Parametrize any test asking for `fixture` over every golden case."""
    if "fixture" in metafunc.fixturenames:
        paths = fixture_paths()
        if not paths:
            pytest.fail(
                f"No fixtures found in {FIXTURE_DIR}. "
                "Generate them with: pnpm --filter client test"
            )

        metafunc.parametrize(
            "fixture",
            [load_fixture(p) for p in paths],
            ids=[p.stem for p in paths],
        )

    # DS-LAKE-005B-D-T02 — same mechanism, separate argname and separate
    # directory, so a test can ask for `chart_fixture` without pulling in
    # every grid case (and vice versa).
    if "chart_fixture" in metafunc.fixturenames:
        chart_paths = chart_fixture_paths()
        if not chart_paths:
            pytest.fail(
                f"No chart fixtures found in {CHART_FIXTURE_DIR}. "
                "Generate them with: pnpm --filter client test"
            )

        metafunc.parametrize(
            "chart_fixture",
            [load_fixture(p) for p in chart_paths],
            ids=[p.stem for p in chart_paths],
        )
