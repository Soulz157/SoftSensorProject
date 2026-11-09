"""MODEL-FLOW-009-T04 / MODEL-SERVE-045. Re-export of the shared
`softsensor_scaling.sequence` module under the import path every
model.joblib saved before the move pickled (`sequence_model.SequenceRegressor`).

Keep this module, and keep its name: deleting or renaming it makes every
lstm/gru model trained before MODEL-SERVE-045 unloadable. apps/serving ships
an identical shim for the same reason.

The thread budget is this image's own (TRAINER_CPU_BUDGET, matching the
container's NanoCpus), set here before any torch work runs.
"""

from __future__ import annotations

import os

import torch

torch.set_num_threads(int(os.environ.get("TRAINER_CPU_BUDGET", "2")))
torch.set_num_interop_threads(1)

from softsensor_scaling.sequence import (  # noqa: E402,F401
    DEVICE,
    SequenceRegressor,
    _RNNHead,
)
