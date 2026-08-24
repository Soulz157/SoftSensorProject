import hashlib
import io
import tracemalloc

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from services import export_service
from services.export_service import export_artifact_csv
from schemas.preprocess import ExportRequest
from intergrations.object_store import ObjectStoreError, STATUS_BAD, STATUS_GOOD

#: Small on purpose — a real MinIO chunk is 8MB (object_store.py's
#: download_to_fileobj default), but these fixtures are KB-sized; a small
#: chunk size here is what actually forces the mock's read/write loops to
#: run more than once, exercising the same chunked-not-monolithic contract
#: the real ObjectStore methods have.
CHUNK_BYTES = 4096


class RecordingStore:
    """Minimal in-memory ObjectStore stand-in, mirroring the pattern already
    used across apps/python/tests/test_artifact_service*.py.

    Mirrors ObjectStore's real `download_to_fileobj`/`put_object_stream`
    contract, including their CHUNKED read/write discipline — a naive
    single `fileobj.write(all_bytes)` here would let a test see a bounded
    peak that only holds because of the mock's own shortcut, not because
    `export_artifact_csv` is actually memory-bounded.
    """

    def __init__(self, objects: dict[str, bytes] | None = None) -> None:
        self.raw_objects: dict[str, bytes] = dict(objects or {})
        self.writes: list[str] = []

    def download_to_fileobj(
        self, key: str, fileobj: io.IOBase, *, chunk_bytes: int = CHUNK_BYTES
    ) -> int:
        if key not in self.raw_objects:
            raise ObjectStoreError(f"Could not read '{key}': NoSuchKey")
        data = self.raw_objects[key]
        written = 0
        for offset in range(0, len(data), chunk_bytes):
            chunk = data[offset : offset + chunk_bytes]
            fileobj.write(chunk)
            written += len(chunk)
        return written

    def put_object_stream(
        self,
        key: str,
        stream: io.IOBase,
        length: int,
        *,
        content_type: str = "application/octet-stream",
        tags=None,
    ) -> None:
        chunks: list[bytes] = []
        while True:
            chunk = stream.read(CHUNK_BYTES)
            if not chunk:
                break
            chunks.append(chunk)
        self.writes.append(key)
        self.raw_objects[key] = b"".join(chunks)


class DiscardingStore(RecordingStore):
    """Same read side as `RecordingStore`; the write side discards each
    chunk immediately after hashing/counting it instead of retaining the
    full output in `raw_objects`.

    `RecordingStore`'s retention is itself O(output size) and would mask
    the very peak-memory regression V02 exists to catch — a test using
    `RecordingStore` for a large fixture would see `raw_objects` growing
    with row count regardless of whether `export_artifact_csv` itself is
    memory-bounded.
    """

    def __init__(self, objects: dict[str, bytes] | None = None) -> None:
        super().__init__(objects)
        self.last_write_length = 0
        self.last_write_sha256: str | None = None

    def put_object_stream(
        self,
        key: str,
        stream: io.IOBase,
        length: int,
        *,
        content_type: str = "application/octet-stream",
        tags=None,
    ) -> None:
        digest = hashlib.sha256()
        total = 0
        while True:
            chunk = stream.read(CHUNK_BYTES)
            if not chunk:
                break
            digest.update(chunk)
            total += len(chunk)
        self.writes.append(key)
        self.last_write_length = total
        self.last_write_sha256 = digest.hexdigest()


def _parquet_bytes(df: pd.DataFrame) -> bytes:
    buf = io.BytesIO()
    pq.write_table(pa.Table.from_pandas(df, preserve_index=False), buf)
    return buf.getvalue()


def _fixture_bytes(n_rows: int, n_tags: int = 5) -> bytes:
    data: dict[str, object] = {
        "timestamp": pd.date_range("2026-01-01", periods=n_rows, freq="min"),
    }
    for i in range(n_tags):
        data[f"TAG-{i}"] = [float(r) + i * 0.01 for r in range(n_rows)]
    return _parquet_bytes(pd.DataFrame(data))


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


def test_export_leaves_source_untouched():
    """V03: exporting does not mutate the source object, and writes
    exactly one new object — the RecordingStore pattern DS-LAKE-007-V02
    already established."""
    source_key = "ds-1/artifacts/a-1/data.parquet"
    df = pd.DataFrame(
        {
            "timestamp": pd.to_datetime(["2026-01-01T00:00:00"]),
            "TI-101": [1.0],
            "TI-101__status": [STATUS_GOOD],
        }
    )
    original_bytes = _parquet_bytes(df)
    store = RecordingStore({source_key: original_bytes})

    result = export_artifact_csv(store, ExportRequest(source_key=source_key))

    assert store.raw_objects[source_key] == original_bytes
    assert store.writes == [result.object_key]  # exactly one write, not the source
    assert source_key not in store.writes


def test_multi_batch_export_has_one_header_and_all_rows(monkeypatch):
    """The multi-batch path (header_written toggle, cross-batch row
    accumulation) was previously untested — every fixture in this file
    fits in a single iter_batches() batch at the production
    BATCH_ROWS=50,000. Monkeypatching it down forces >1 batch and a
    non-multiple final batch, proving neither the header nor any row is
    duplicated or dropped at a batch boundary."""
    monkeypatch.setattr(export_service, "BATCH_ROWS", 10)
    n_rows = 37  # not a multiple of BATCH_ROWS — exercises a short final batch
    payload = _fixture_bytes(n_rows=n_rows, n_tags=2)
    store = RecordingStore({"ds-1/artifacts/a-1/data.parquet": payload})

    result = export_artifact_csv(
        store, ExportRequest(source_key="ds-1/artifacts/a-1/data.parquet")
    )

    csv_text = store.raw_objects["ds-1/artifacts/a-1/export.csv"].decode("utf-8")
    lines = csv_text.strip().split("\n")
    header = "timestamp," + ",".join(f"TAG-{i}" for i in range(2))
    assert lines.count(header) == 1  # header written once, not once per batch
    assert len(lines) == n_rows + 1  # header + every row, none dropped/duplicated
    assert result.row_count == n_rows


def test_peak_memory_does_not_scale_with_row_count(monkeypatch):
    """V02: export against a 100x-larger artifact and confirm peak traced
    memory stays far below a 100x growth ceiling — the batched-decode,
    batched-write property this feature exists to guarantee. Asserting
    only that the file appears cannot catch a full-frame materialisation
    (DS-LAKE-021-V02).

    `_peak_rss_kb` (routers/preprocess.py) uses `ru_maxrss`, a
    PROCESS-LIFETIME high-water mark that never decreases — it cannot
    express a per-call assertion inside one pytest process sharing an
    interpreter with every other test here. This uses `tracemalloc`
    deltas instead, scoped tightly around the call under test.
    """
    monkeypatch.setattr(export_service, "BATCH_ROWS", 50)
    monkeypatch.setattr(export_service, "SPOOL_MAX_BYTES", 1024)

    small_bytes = _fixture_bytes(n_rows=200)
    large_bytes = _fixture_bytes(n_rows=20_000)  # 100x the row count

    def _peak_for(payload: bytes) -> int:
        store = DiscardingStore({"ds-1/artifacts/a-1/data.parquet": payload})
        request = ExportRequest(source_key="ds-1/artifacts/a-1/data.parquet")
        tracemalloc.start()
        try:
            export_artifact_csv(store, request)
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
        return peak

    peak_small = _peak_for(small_bytes)
    peak_large = _peak_for(large_bytes)

    # A ceiling far below the 100x row-count ratio proves peak memory
    # tracks batch size, not artifact size: if the old
    # get_object_bytes/io.StringIO/getvalue().encode() triple-buffer ever
    # regressed back in, this would fail by roughly the row-count ratio,
    # not by this generous margin.
    GROWTH_CEILING = 5
    assert peak_large < peak_small * GROWTH_CEILING, (
        f"peak_small={peak_small} peak_large={peak_large} "
        f"(ratio={peak_large / peak_small:.1f}x) for a 100x row-count increase"
    )
