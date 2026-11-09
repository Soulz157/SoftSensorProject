"""MODEL-SERVE-045. LSTM/GRU regressor, sklearn-shaped — shared by the
trainer image and apps/serving so the class that pickles a sequence model
and the class that unpickles it are one implementation.

Moved verbatim from images/trainer/app/sequence_model.py (MODEL-FLOW-009-T04),
which now re-exports it. Saved model.joblib files reference the class as
`sequence_model.SequenceRegressor` (pre-move) or
`softsensor_scaling.sequence.SequenceRegressor` (post-move); both runtimes
ship a top-level `sequence_model` shim, so either path resolves.

Requires torch, unlike the rest of this package: it is NEVER imported by
`softsensor_scaling/__init__.py`, so apps/python (no torch) is unaffected.
Thread counts are the importing process's choice (the trainer's CPU budget,
one thread per request in serving), set in its own shim, not here.

`.fit(X, y)` / `.predict(X)` on a (n, sequence_length, n_features) array.
CPU-only by design: no container here has a GPU.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import torch
from torch import nn

DEVICE = torch.device("cpu")


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
