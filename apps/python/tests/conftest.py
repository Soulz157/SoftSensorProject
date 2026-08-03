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
    if "fixture" not in metafunc.fixturenames:
        return

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
