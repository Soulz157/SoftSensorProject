"""MODEL-FLOW-009-T04. LSTM/GRU regressor, sklearn-shaped.

Ships in its OWN importable module rather than defined inline in train.py —
decided in the T01-T03 pass, built here: `joblib.dump(model, ...)` pickles a
class by reference to its import path, and a future MODEL-SERVE process
loading a saved model.joblib needs `sequence_model` importable on its own
path, not embedded in a script entrypoint it may never run.

`.fit(X, y)` / `.predict(X)` on a (n, sequence_length, n_features) array —
the SAME calling convention every other build_model branch already uses, so
train.py's generic `model.fit(...)` / `model.predict(...)` call sites need
no special-casing for this algorithm beyond what lightgbm/xgboost already
get for `eval_set`.

CPU-only, hardcoded: `torch.device('cpu')` is not a fallback branch, because
this container has no GPU passthrough configured anywhere
(trainning-container.authorized.service.ts) — detecting a device that can
never be present would be dead code, not defensive code.
"""

from __future__ import annotations

import os
from typing import Any

import numpy as np
import torch
from torch import nn

DEVICE = torch.device("cpu")

# MODEL-FLOW-009-T04. LIVE-VERIFIED necessary, not precautionary: torch's
# default intra-op thread pool sizes itself off every LOGICAL core the
# kernel reports, which under `docker run --cpus=N` is still the HOST's
# full core count — cgroups throttle CPU TIME, they do not shrink what
# `os.cpu_count()`/`sched_getaffinity` report inside the container. A
# first benchmark run against this image, on a host with more cores than
# the production NanoCpus=2 budget, measured 500 windows x 3 epochs taking
# 10+ minutes pegged at ~196% CPU — thread-count oversubscription thrashing
# the 2-CPU quota, not real fit time. Capped to the SAME 2 the production
# container's own NanoCpus is set to (trainning-container.authorized.
# service.ts) — a container given a different CPU budget should still get
# this right, but 2 is what this trainer's own resource comments already
# treat as the fixed production number, not a value read from the
# environment at every call site.
_TORCH_THREADS = int(os.environ.get("TRAINER_CPU_BUDGET", "2"))
torch.set_num_threads(_TORCH_THREADS)
torch.set_num_interop_threads(1)


class _RNNHead(nn.Module):
    """Single-layer LSTM/GRU -> last hidden state -> linear(1).

    Intentionally the simplest architecture that fits build_windows' output
    shape — no stacking, no dropout, no bidirectionality. This trainer's
    other 10 algorithms all take a comparably small, fixed set of
    hyperparameters (see training-config.ts); a model this deep would need
    hyperparameters this catalogue does not collect.
    """

    def __init__(self, cell: str, n_features: int, hidden_size: int) -> None:
        super().__init__()
        rnn_cls = nn.LSTM if cell == "lstm" else nn.GRU
        self.rnn = rnn_cls(
            input_size=n_features, hidden_size=hidden_size, batch_first=True
        )
        self.head = nn.Linear(hidden_size, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # output: (batch, seq, hidden); take the LAST timestep's hidden
        # state — the window's own final position, matching build_windows'
        # nowcast convention (window i predicts the target AT row i).
        output, _ = self.rnn(x)
        last = output[:, -1, :]
        return self.head(last).squeeze(-1)


class SequenceRegressor:
    """sklearn-shaped wrapper around `_RNNHead`.

    `algorithm` is 'lstm' or 'gru' — this class implements both, selected by
    the cell type passed at construction, rather than being two near-
    identical classes.
    """

    def __init__(
        self,
        algorithm: str,
        hidden_size: int,
        epochs: int,
        batch_size: int,
        seed: int,
    ) -> None:
        if algorithm not in ("lstm", "gru"):
            raise ValueError(f"SequenceRegressor does not support '{algorithm}'.")
        self.algorithm = algorithm
        self.hidden_size = hidden_size
        self.epochs = epochs
        self.batch_size = batch_size
        self.seed = seed
        self._model: _RNNHead | None = None
        # Populated by fit(); read by train.py's extract_loss_history the
        # same way every other algorithm exposes ITS native trajectory
        # attribute (model.loss_curve_, model.train_score_, ...).
        self.train_loss_: list[float] = []
        self.validation_loss_: list[float] = []

    def fit(
        self,
        X: np.ndarray,
        y: np.ndarray,
        eval_set: list[tuple[np.ndarray, np.ndarray]] | None = None,
    ) -> "SequenceRegressor":
        torch.manual_seed(self.seed)
        n_features = X.shape[2]
        self._model = _RNNHead(self.algorithm, n_features, self.hidden_size).to(
            DEVICE
        )
        optimizer = torch.optim.Adam(self._model.parameters())
        loss_fn = nn.MSELoss()

        X_t = torch.as_tensor(X, dtype=torch.float32, device=DEVICE)
        y_t = torch.as_tensor(y, dtype=torch.float32, device=DEVICE)
        n = X_t.shape[0]

        val_X_t: torch.Tensor | None = None
        val_y_t: torch.Tensor | None = None
        if eval_set:
            # main() passes [(train...), (test...)] to mirror lightgbm/
            # xgboost's own eval_set shape — index 1 is the held-out side.
            val_X, val_y = eval_set[1]
            val_X_t = torch.as_tensor(val_X, dtype=torch.float32, device=DEVICE)
            val_y_t = torch.as_tensor(val_y, dtype=torch.float32, device=DEVICE)

        generator = torch.Generator().manual_seed(self.seed)
        for _epoch in range(self.epochs):
            self._model.train()
            permutation = torch.randperm(n, generator=generator)
            epoch_losses: list[float] = []
            for start in range(0, n, self.batch_size):
                idx = permutation[start: start + self.batch_size]
                optimizer.zero_grad()
                pred = self._model(X_t[idx])
                loss = loss_fn(pred, y_t[idx])
                loss.backward()
                optimizer.step()
                epoch_losses.append(float(loss.item()))
            self.train_loss_.append(float(np.mean(epoch_losses)))

            if val_X_t is not None and val_y_t is not None:
                self._model.eval()
                with torch.no_grad():
                    val_pred = self._model(val_X_t)
                    val_loss = float(loss_fn(val_pred, val_y_t).item())
                self.validation_loss_.append(val_loss)

        return self

    def predict(self, X: np.ndarray) -> np.ndarray:
        if self._model is None:
            raise RuntimeError("SequenceRegressor.predict called before fit().")
        self._model.eval()
        X_t = torch.as_tensor(X, dtype=torch.float32, device=DEVICE)
        with torch.no_grad():
            pred = self._model(X_t)
        return pred.cpu().numpy()

    def __getstate__(self) -> dict[str, Any]:
        # nn.Module is picklable directly, but going through its own
        # state_dict is the documented-stable path across torch versions —
        # the same "don't trust bare pickling of a live framework object"
        # discipline MODEL-FLOW-007-T11's framework_versions manifest field
        # exists to make visible for every algorithm, applied here at the
        # object level for the one algorithm where it is a live risk.
        state = self.__dict__.copy()
        state["_model_state_dict"] = (
            self._model.state_dict() if self._model is not None else None
        )
        state["_n_features"] = (
            self._model.rnn.input_size if self._model is not None else None
        )
        del state["_model"]
        return state

    def __setstate__(self, state: dict[str, Any]) -> None:
        model_state_dict = state.pop("_model_state_dict")
        n_features = state.pop("_n_features")
        self.__dict__.update(state)
        if model_state_dict is not None:
            self._model = _RNNHead(self.algorithm, n_features, self.hidden_size)
            self._model.load_state_dict(model_state_dict)
            self._model.to(DEVICE)
        else:
            self._model = None
