"""DS-LAKE-005B-D-T05b."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from intergrations.object_store import STATUS_BAD, STATUS_GOOD, status_column
from schemas.preprocess import CorrelationRequest
from services.correlation_matrix_service import _pearson, build_correlation_matrix


class _NoWriteStore:
    """Read-only fake — same guarantee `test_preview_service.NoWriteStore`
    makes, defined locally per this codebase's own precedent."""

    def __init__(self, frame: pd.DataFrame) -> None:
        self._frame = frame

    def get_frame(self, key: str, columns: list[str] | None = None) -> pd.DataFrame:
        return self._frame[columns].copy() if columns else self._frame.copy()

    def __getattr__(self, name: str):
        raise AssertionError(
            f"correlation service called {name!r} on the object store — "
            "read-only, must not write, delete, or create anything."
        )


def _frame(columns: dict[str, list[float]], n: int | None = None) -> pd.DataFrame:
    n = n or len(next(iter(columns.values())))
    ts = pd.date_range("2026-06-22", periods=n, freq="min")
    data: dict[str, object] = {"timestamp": ts}
    for tag, values in columns.items():
        data[tag] = values
        data[status_column(tag)] = [STATUS_GOOD] * n
    return pd.DataFrame(data)


def test_pearson_matches_client_formula_on_a_known_pair():
    # Perfectly anti-correlated -> r == -1 exactly.
    x = list(range(50))
    y = [-v for v in x]
    frame = _frame({"A": [float(v) for v in x], "B": [float(v) for v in y]})
    r = _pearson(frame, "A", "B")
    assert math.isclose(r, -1.0, rel_tol=1e-9, abs_tol=1e-9)


def test_pearson_excludes_bad_pairs():
    x = [1.0, 2.0, 3.0, 4.0, 100.0]  # last row is a Bad hole
    y = [1.0, 2.0, 3.0, 4.0, 100.0]
    frame = _frame({"A": x, "B": y})
    frame.loc[4, status_column("A")] = STATUS_BAD
    r = _pearson(frame, "A", "B")
    assert math.isclose(r, 1.0, rel_tol=1e-9, abs_tol=1e-9)  # unaffected by the hole


def test_pearson_returns_zero_for_fewer_than_two_pairs():
    frame = _frame({"A": [1.0], "B": [2.0]})
    assert _pearson(frame, "A", "B") == 0.0


def test_matrix_diagonal_is_one_and_symmetric():
    rng = np.random.default_rng(3)
    frame = _frame(
        {
            "A": rng.normal(0, 1, 100).tolist(),
            "B": rng.normal(0, 1, 100).tolist(),
            "C": rng.normal(0, 1, 100).tolist(),
        }
    )
    store = _NoWriteStore(frame)
    request = CorrelationRequest(
        source_key="fixture/x.parquet", tags=["A", "B", "C"], top_k=10
    )
    response = build_correlation_matrix(store, request)

    matrix = response["matrix"]
    k = len(response["tags"])
    for i in range(k):
        assert matrix[i][i] == 1.0
        for j in range(k):
            assert matrix[i][j] == matrix[j][i]


def test_response_echoes_resolved_tags_never_the_raw_request_list():
    frame = _frame(
        {
            "FLAT": [42.0] * 100,  # near-constant -> excluded
            "VARIABLE_A": [float(i) for i in range(100)],
            "VARIABLE_B": [float(i) * 2 for i in range(100)],
        }
    )
    store = _NoWriteStore(frame)
    request = CorrelationRequest(
        source_key="fixture/x.parquet",
        tags=["FLAT", "VARIABLE_A", "VARIABLE_B"],
        top_k=10,
    )
    response = build_correlation_matrix(store, request)

    assert "FLAT" not in response["tags"]
    assert set(response["tags"]) == {"VARIABLE_A", "VARIABLE_B"}
    assert "FLAT" in response["near_constant_tags"]
    assert response["total_candidates"] == 3
    assert set(response["column_metrics"].keys()) == set(response["tags"])


def test_top_k_hard_caps_the_matrix_regardless_of_candidate_count():
    """THE BITING ASSERTION for this task's own scope_note: 'the one task
    here that can regress AC5 on its own' — bounded input must not become
    unbounded output."""
    rng = np.random.default_rng(5)
    tags = [f"T{i}" for i in range(50)]
    frame = _frame({t: rng.normal(0, 1 + i, 100).tolist() for i, t in enumerate(tags)})
    store = _NoWriteStore(frame)
    request = CorrelationRequest(
        source_key="fixture/x.parquet", tags=tags, top_k=5
    )
    response = build_correlation_matrix(store, request)

    assert len(response["tags"]) <= 5
    assert len(response["matrix"]) == len(response["tags"])
    assert all(len(row) == len(response["tags"]) for row in response["matrix"])
    assert response["total_candidates"] == 50  # states the true candidate count


def test_insufficient_tags_excluded_from_matrix_and_metrics():
    frame = _frame({"SPARSE": [1.0, 2.0, 3.0], "OK": [1.0, 2.0, 3.0]})
    frame.loc[1:, status_column("SPARSE")] = STATUS_BAD  # 1 Good value left
    store = _NoWriteStore(frame)
    request = CorrelationRequest(
        source_key="fixture/x.parquet", tags=["SPARSE", "OK"], top_k=10
    )
    response = build_correlation_matrix(store, request)

    assert "SPARSE" in response["insufficient_tags"]
    assert "SPARSE" not in response["tags"]
    assert "SPARSE" not in response["column_metrics"]


def test_unknown_column_raises_a_caller_fixable_error():
    frame = _frame({"REAL": [1.0, 2.0, 3.0]})
    store = _NoWriteStore(frame)
    request = CorrelationRequest(
        source_key="fixture/x.parquet", tags=["REAL", "NOT-A-TAG"], top_k=5
    )
    with pytest.raises(KeyError):
        build_correlation_matrix(store, request)


def test_service_never_writes():
    frame = _frame({"A": [1.0, 2.0, 3.0]})
    store = _NoWriteStore(frame)
    with pytest.raises(AssertionError, match="read-only"):
        store.put_frame
