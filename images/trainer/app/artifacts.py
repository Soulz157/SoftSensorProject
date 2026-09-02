"""What a run writes to /scratch, and under what name.

An `ArtifactSet` rather than a bare dict because the original built
`{filename: (path, content_type)}` by hand while separately calling
`.write_text(json.dumps(...))` on the same paths — two steps that must agree, in
two places, with the content type restated as a literal each time. Adding a file
to the dict but forgetting to write it produces a KeyError at upload; writing it
but forgetting the dict entry produces a run that succeeds with a missing
artifact and no error at all.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterator, Mapping

import pandas as pd

JSON_CONTENT_TYPE = "application/json"
PARQUET_CONTENT_TYPE = "application/vnd.apache.parquet"
BINARY_CONTENT_TYPE = "application/octet-stream"

MODEL_FILENAME = "model.joblib"
METRICS_FILENAME = "metrics.json"
MANIFEST_FILENAME = "run_manifest.json"
PREDICTIONS_FILENAME = "predictions.parquet"
LOSS_HISTORY_FILENAME = "loss_history.json"
# MODEL-FLOW-016-T04. Mirrored in apps/python's object_store.py
# (CV_FOLDS_FILENAME) and artifact-keys.ts — change all three, per
# MODEL-FLOW-013-T05's own note on what happens when one is missed. See
# MIRRORS.md.
CV_FOLDS_FILENAME = "cv_folds.json"


class ArtifactSet:
    """Write-and-register, as one call per artifact.

    Iteration order is insertion order, which is the order the upload loop PUTs
    them in — model.joblib first, deliberately, so the artifact a deployment
    depends on lands before the reporting extras.
    """

    def __init__(self, scratch: Path):
        self.scratch = scratch
        self._outputs: dict[str, tuple[Path, str]] = {}

    def add_existing(
        self, filename: str, path: Path, content_type: str = BINARY_CONTENT_TYPE
    ) -> Path:
        """Register a file some other component already wrote (model.joblib,
        which joblib.dump produces, is the only such case today)."""
        self._outputs[filename] = (path, content_type)
        return path

    def add_json(self, filename: str, payload: Any) -> Path:
        path = self.scratch / filename
        path.write_text(json.dumps(
            payload, indent=2, sort_keys=True, default=str))
        self._outputs[filename] = (path, JSON_CONTENT_TYPE)
        return path

    def add_parquet(self, filename: str, frame: pd.DataFrame) -> Path:
        path = self.scratch / filename
        frame.to_parquet(path, index=False)
        self._outputs[filename] = (path, PARQUET_CONTENT_TYPE)
        return path

    def as_outputs(self) -> Mapping[str, tuple[Path, str]]:
        return dict(self._outputs)

    def __contains__(self, filename: object) -> bool:
        return filename in self._outputs

    def __iter__(self) -> Iterator[str]:
        return iter(self._outputs)

    def __len__(self) -> int:
        return len(self._outputs)
