"""DS-LAKE-023-T03/D4: `train.py`'s `labelled_mask` — the non-Good-target
mask shared between the train/test split (steps 6-7) and holdout scoring.

No existing test infrastructure covers this file (it is a standalone Docker
training-container entrypoint, never imported outside its own container) —
this is new coverage for the ONE pure function this fix introduces/extracts,
not an attempt to test the whole training flow (which needs a live PI
container, S3 credentials, and a real training run to exercise end to end).

`train.py` reads RUN_ID/RUN_TOKEN/API_BASE from the environment at module
scope, so those are set to synthetic placeholders before import.
"""

import os
import sys
from pathlib import Path

os.environ.setdefault("RUN_ID", "test-run")
os.environ.setdefault("RUN_TOKEN", "test-token")
os.environ.setdefault("API_BASE", "http://localhost:0")

sys.path.insert(0, str(Path(__file__).parent))

import pandas as pd  # noqa: E402

from train import STATUS_GOOD, labelled_mask, status_column  # noqa: E402


def _frame(target_values: list[float | None], statuses: list[int] | None = None) -> pd.DataFrame:
    data: dict[str, object] = {
        "timestamp": pd.date_range("2026-01-01", periods=len(target_values), freq="D"),
        "TI-101": target_values,
    }
    if statuses is not None:
        data[status_column("TI-101")] = statuses
    return pd.DataFrame(data)


def test_labelled_mask_uses_status_good_when_sidecar_present():
    # Good/Bad/Good, with the middle row's Bad status overriding its
    # non-null value — proves this reads the SIDECAR, not just notna().
    frame = _frame([1.0, 2.0, 3.0], statuses=[STATUS_GOOD, 99, STATUS_GOOD])
    mask = labelled_mask(frame, "TI-101")
    assert mask.tolist() == [True, False, True]


def test_labelled_mask_falls_back_to_notna_when_no_status_sidecar():
    frame = _frame([1.0, None, 3.0])
    warnings = []
    mask = labelled_mask(
        frame, "TI-101", log_fn=lambda msg, level="info": warnings.append((msg, level))
    )
    assert mask.tolist() == [True, False, True]
    assert warnings and warnings[0][1] == "warn"


def test_labelled_mask_combines_status_and_notna():
    # Good status but a null value (a real gap in the sidecar's own
    # bookkeeping) must still be excluded — `& frame[target_y].notna()`.
    frame = _frame([1.0, None, 3.0], statuses=[STATUS_GOOD, STATUS_GOOD, STATUS_GOOD])
    mask = labelled_mask(frame, "TI-101")
    assert mask.tolist() == [True, False, True]


def test_labelled_mask_all_good_keeps_every_row():
    frame = _frame([1.0, 2.0, 3.0], statuses=[STATUS_GOOD, STATUS_GOOD, STATUS_GOOD])
    mask = labelled_mask(frame, "TI-101")
    assert mask.tolist() == [True, True, True]


if __name__ == "__main__":
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
