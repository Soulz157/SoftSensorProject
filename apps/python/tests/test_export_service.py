import io

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from services.export_service import export_artifact_csv
from schemas.preprocess import ExportRequest
from intergrations.object_store import ObjectStoreError, STATUS_BAD, STATUS_GOOD


class RecordingStore:
    """Minimal in-memory ObjectStore stand-in, mirroring the pattern already
    used across apps/python/tests/test_artifact_service*.py."""

    def __init__(self, objects: dict[str, bytes] | None = None) -> None:
        self.raw_objects: dict[str, bytes] = dict(objects or {})
        self.writes: list[str] = []

    def get_object_bytes(self, key: str) -> bytes:
        if key not in self.raw_objects:
            raise ObjectStoreError(f"Could not read '{key}': NoSuchKey")
        return self.raw_objects[key]

    def put_object_bytes(self, key: str, data: bytes) -> None:
        self.writes.append(key)
        self.raw_objects[key] = data

    def checksum_of(self, key: str) -> str:
        import hashlib

        return hashlib.sha256(self.raw_objects[key]).hexdigest()


def _parquet_bytes(df: pd.DataFrame) -> bytes:
    buf = io.BytesIO()
    pq.write_table(pa.Table.from_pandas(df, preserve_index=False), buf)
    return buf.getvalue()


def test_bad_cell_exports_as_empty_not_zero():
    """V01: a Bad-status cell must never appear as the string '0.0'."""
    df = pd.DataFrame(
        {
            "timestamp": pd.to_datetime(["2026-01-01T00:00:00", "2026-01-01T00:01:00"]),
            "TI-101": [12.5, 0.0],
            "TI-101__status": [STATUS_GOOD, STATUS_BAD],
        }
    )
    store = RecordingStore({"ds-1/artifacts/a-1/data.parquet": _parquet_bytes(df)})

    result = export_artifact_csv(
        store, ExportRequest(source_key="ds-1/artifacts/a-1/data.parquet")
    )

    csv_bytes = store.raw_objects["ds-1/artifacts/a-1/export.csv"]
    csv_text = csv_bytes.decode("utf-8")
    rows = csv_text.strip().split("\n")
    assert rows[0] == "timestamp,TI-101"
    assert rows[1] == "2026-01-01 00:00:00,12.5"
    assert rows[2] == "2026-01-01 00:01:00,"  # empty field, not "0.0"
    assert result.row_count == 2
    assert result.column_count == 1  # TI-101 only — __status dropped
    assert result.object_key == "ds-1/artifacts/a-1/export.csv"


def test_questionable_cell_stays_numeric():
    from intergrations.object_store import STATUS_QUESTIONABLE

    df = pd.DataFrame(
        {
            "timestamp": pd.to_datetime(["2026-01-01T00:00:00"]),
            "TI-101": [7.2],
            "TI-101__status": [STATUS_QUESTIONABLE],
        }
    )
    store = RecordingStore({"ds-1/artifacts/a-1/data.parquet": _parquet_bytes(df)})

    export_artifact_csv(
        store, ExportRequest(source_key="ds-1/artifacts/a-1/data.parquet")
    )

    csv_text = store.raw_objects["ds-1/artifacts/a-1/export.csv"].decode("utf-8")
    assert "7.2" in csv_text


def test_missing_source_raises_object_store_error():
    store = RecordingStore({})

    with pytest.raises(ObjectStoreError):
        export_artifact_csv(
            store, ExportRequest(source_key="ds-1/artifacts/missing/data.parquet")
        )
