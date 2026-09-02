"""softsensor_scaling — the training-time transform, extracted.

MODEL-SERVE-002 decisions.serving_transform_is_an_extracted_module. Moved
verbatim out of `apps/python/services/feature_service.py`,
`services/cleaning_service.py`, and `intergrations/object_store.py` so that
training (`apps/python`) and serving (`apps/serving`) import the SAME code
rather than two copies that can drift — see that decision's own rationale
for why "call it" (the feature's original audit answer) stopped being
reachable once serving became a separate process.

This package has NO project-specific import (no `config`, no `intergrations`,
no `services`) — only `numpy`/`pandas` — precisely so `apps/serving` can
depend on it without pulling in `apps/python`'s PI/MinIO/DB-credentialed
import chain (`intergrations.object_store` imports `config.settings`, which
requires `SYS_USER`/`SYS_PASS`/`PI_NAME` at import time).

`apps/python` re-exports these same names from their original locations
(`object_store.STATUS_GOOD`, `feature_service.to_model_ready`, ...) so every
existing caller in that codebase is unchanged.
"""

from __future__ import annotations

from .constants import (
    STATUS_BAD,
    STATUS_GOOD,
    STATUS_QUESTIONABLE,
    STATUS_SUFFIX,
    TIMESTAMP_COLUMN,
    status_column,
    tag_columns,
)
from .rounding import _js_round, _median_sorted, _round_to
from .scaling import (
    DEFAULT_SCALER,
    FeatureError,
    _scale_column,
    _welford_population_std,
    assert_scaling_coverage,
    to_model_ready,
)

__all__ = [
    "STATUS_BAD",
    "STATUS_GOOD",
    "STATUS_QUESTIONABLE",
    "STATUS_SUFFIX",
    "TIMESTAMP_COLUMN",
    "status_column",
    "tag_columns",
    "_js_round",
    "_median_sorted",
    "_round_to",
    "DEFAULT_SCALER",
    "FeatureError",
    "_scale_column",
    "_welford_population_std",
    "assert_scaling_coverage",
    "to_model_ready",
]
