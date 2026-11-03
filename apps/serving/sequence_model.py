"""MODEL-SERVE-045. The import path lstm/gru model.joblib files pickled
their class under (`sequence_model.SequenceRegressor`), re-exported from the
shared `softsensor_scaling.sequence` — the SAME class the trainer image
uses, so serving cannot unpickle into a different implementation.

Keep this module and its name: `joblib.load` resolves the pickled class by
this exact path (sys.path[0] is this directory, see main.py's docstring).

One torch thread per process: this is a request server with its own
concurrency, not a fit with a CPU budget; set before any torch work runs.
"""

from __future__ import annotations

import torch

torch.set_num_threads(1)
torch.set_num_interop_threads(1)

from softsensor_scaling.sequence import (  # noqa: E402,F401
    DEVICE,
    SequenceRegressor,
    _RNNHead,
)
