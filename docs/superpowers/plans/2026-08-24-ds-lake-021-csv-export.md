# DS-LAKE-021 — CSV Export of the Saved Dataset at Step 5 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user export a saved dataset's FINAL artifact as a CSV from Step 5, without loading the frame into the browser or NestJS process.

**Architecture:** A new `EXPORT`-stage `PreprocessingJob` (mirrors the existing CLEAN/FEATURE stages) drives a new Python export service that streams FINAL's parquet row-group by row-group into a sidecar `export.csv` object, dropping `__status` columns and blanking `Bad`-status cells. On success NestJS commits a new `DatasetArtifact{ type: 'EXPORT' }` row. A new browser-facing NestJS route presigns that object fresh on each download click — the existing `presignArtifact` machinery has no browser-facing caller today, every existing use is server-to-server.

**Tech Stack:** NestJS (Fastify), Prisma/Postgres, FastAPI, pandas/pyarrow/duckdb, MinIO, Next.js/React, Jotai, Vitest, Jest, pytest.

**Spec:** `docs/superpowers/specs/2026-08-24-ds-lake-021-csv-export-design.md`

## Global Constraints

- Status columns: `__status` sidecar columns are dropped from the CSV entirely. A `Bad`-status cell exports as an **empty field**, never the numeric `0.0` `frame_service.MISSING_VALUE` stores. `Questionable` and `Good` cells export their numeric value unchanged.
- Exportable stage: **FINAL only** — `startExportService` must assert the resolved artifact's `type === 'FINAL'` and reject otherwise. No stage picker anywhere in the UI.
- Holdout rows: never explicitly handled — FINAL structurally never contains them (cut at BRONZE-split time), so the exported row count equals FINAL's own `rowCount` with no extra logic.
- Reclaim: the export object is a `DatasetArtifactType.EXPORT` row, riding the existing DS-LAKE-014 sweep (`WHERE type: { not: 'FINAL' }, objectReclaimedAt: null`) with zero new sweep code.
- No full-frame materialization anywhere in the export path — Python must stream via `pq.ParquetFile.iter_batches()`, never `store.get_frame(...)` for the whole object.
- Every Python response schema and its NestJS zod mirror must be added together — this codebase enforces "add a field in one file without the other = a parse failure," and that discipline continues here (`ArtifactStatsResponse`/`ArtifactStatsSchema` is the existing precedent).
- Update `feature_list.preprocessing.json`'s DS-LAKE-021 entry (`status`, `progress`, and each `tasks[].status`/`.progress`) as each task below completes — see Task 8.

---

## File Structure

**New files:**

- `packages/prisma/prisma/migrations/<timestamp>_ds_lake_021_export_artifact_type/migration.sql` — enum widening
- `apps/python/services/export_service.py` — streaming CSV export
- `apps/python/tests/test_export_service.py` — export service tests
- `apps/client/hooks/dataset/use-dataset-export.ts` — export action hook
- `apps/client/hooks/dataset/use-dataset-export.test.ts` — hook tests
- `docs/superpowers/specs/2026-08-24-ds-lake-021-csv-export-design.md` — already committed (spec)

**Modified files:**

- `packages/prisma/prisma/schema.prisma` — `DatasetArtifactType`, `DatasetVersionStage` enums
- `apps/python/intergrations/object_store.py` — `EXPORT_CSV_FILENAME` constant, `get_object_bytes`/`put_object_bytes`
- `apps/python/schemas/preprocess.py` — `ExportRequest`, `ExportStatsResponse`
- `apps/python/routers/preprocess.py` — `POST /v1/preprocess/export`
- `apps/backend/src/lib/artifact-keys.ts` — `EXPORT_CSV_FILENAME` mirror
- `apps/backend/src/api/v1/dataset-version/authorized/dto/dataset-version.authorized.dto.ts` — `ExportStatsSchema`
- `apps/backend/src/api/v1/dataset-version/authorized/preprocessing-job.service.ts` — `job.stage === 'EXPORT'` branch, `readExportRequest`
- `apps/backend/src/api/v1/dataset-version/authorized/preprocessing-job.service.spec.ts` — EXPORT branch tests
- `apps/backend/src/api/v1/dataset-version/authorized/dataset-version.authorized.service.ts` — `startExportService`, `getExportDownloadService`
- `apps/backend/src/api/v1/dataset-version/authorized/dataset-version.authorized.service.spec.ts` — tests for the two new methods
- `apps/backend/src/api/v1/dataset-version/authorized/dataset-version.authorized.controller.ts` — `POST /:id/export`, `GET /:id/export/:artifactId/download`
- `apps/backend/src/api/v1/artifact-cleanup/admin/artifact-cleanup.admin.service.spec.ts` — one new EXPORT-typed candidate test
- `apps/client/lib/poll-preprocessing-job.ts` — generalize the poller
- `apps/client/services/dataset-version.ts` — `startExport`, `exportDownload`
- `apps/client/app/(default)/data-studio/create/components/step-5-review-save.tsx` — "Export CSV" control
- `feature_list.preprocessing.json` — DS-LAKE-021 status/progress/tasks

---

## Task 1: Prisma migration — widen `DatasetArtifactType` and `DatasetVersionStage`

**Files:**

- Modify: `packages/prisma/prisma/schema.prisma`
- Create: `packages/prisma/prisma/migrations/<timestamp>_ds_lake_021_export_artifact_type/migration.sql`

**Interfaces:**

- Produces: Prisma enum value `DatasetArtifactType.EXPORT`, `DatasetVersionStage.EXPORT` — every later task's Prisma calls (`type: 'EXPORT'`, `stage: 'EXPORT'`) depend on these existing in the generated client.

- [ ] **Step 1: Edit the schema enums**

In `packages/prisma/prisma/schema.prisma`, find:

```prisma
enum DatasetArtifactType {
  BRONZE
  SILVER
  GOLD
  FINAL
}
```

Change to:

```prisma
enum DatasetArtifactType {
  BRONZE
  SILVER
  GOLD
  FINAL
  EXPORT
}
```

Find:

```prisma
enum DatasetVersionStage {
  RAW
  CLEAN
  FEATURE
}
```

Change to:

```prisma
enum DatasetVersionStage {
  RAW
  CLEAN
  FEATURE
  EXPORT
}
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:migrate:dev --name ds_lake_021_export_artifact_type`

This creates `packages/prisma/prisma/migrations/<timestamp>_ds_lake_021_export_artifact_type/migration.sql`. Verify its contents match exactly:

```sql
-- AlterEnum
ALTER TYPE "DatasetArtifactType" ADD VALUE 'EXPORT';

-- AlterEnum
ALTER TYPE "DatasetVersionStage" ADD VALUE 'EXPORT';
```

(Two enums changed in one schema edit produces two `-- AlterEnum` blocks in one migration file — this matches the existing single-enum precedent at `20260818085151_model_flow_003_draft_trained_status/migration.sql`, just doubled.)

- [ ] **Step 3: Regenerate the Prisma client**

Run: `pnpm db:generate`

- [ ] **Step 4: Verify the backend still typechecks**

Run: `pnpm --filter backend exec tsc --noEmit -p tsconfig.json`
Expected: no new errors (the two new enum values are additive; nothing existing references them yet).

- [ ] **Step 5: Commit**

```bash
git add packages/prisma/prisma/schema.prisma packages/prisma/prisma/migrations/
git commit -m "feat(prisma): add EXPORT to DatasetArtifactType and DatasetVersionStage

DS-LAKE-021-T01 groundwork — the export job and its result artifact
need their own stage/type before either can be built."
```

---

## Task 2: Python — `export_service.py`, schemas, and the `/v1/preprocess/export` route

**Files:**

- Modify: `apps/python/intergrations/object_store.py`
- Modify: `apps/python/schemas/preprocess.py`
- Create: `apps/python/services/export_service.py`
- Modify: `apps/python/routers/preprocess.py`
- Test: `apps/python/tests/test_export_service.py`

**Interfaces:**

- Consumes: `ObjectStore` (existing, `apps/python/intergrations/object_store.py`) — specifically its MinIO client access pattern (`self._client.get_object`, `self._client.put_object`) and `sidecar_key(data_key, filename) -> str`, `checksum_of(key) -> str`, `STATUS_SUFFIX`, `STATUS_BAD = 1`.
- Produces: `export_artifact_csv(store: ObjectStore, request: ExportRequest) -> ExportStatsResponse` — the function Task 3's NestJS caller invokes via `POST /v1/preprocess/export`. `ExportStatsResponse` fields: `object_key: str`, `row_count: int`, `column_count: int`, `size_bytes: int`, `checksum: str`.

### Step 1: Add the filename constant

In `apps/python/intergrations/object_store.py`, find:

```python
#: DS-LAKE-018-T03. The raw validation-holdout sidecar, written beside a
#: BRONZE's own data key via `sidecar_key()` — works for both the legacy
#: `data.parquet` and DS-LAKE-016's stage-suffixed `data_bronze.parquet`,
#: same as every other sidecar. Mirrored in artifact-keys.ts as
#: `VALIDATE_DATA_FILENAME` — change both.
VALIDATE_DATA_FILENAME = "validate_data.parquet"
```

Add immediately after it:

```python
#: DS-LAKE-021-T01. The CSV export sidecar, written beside a committed
#: artifact's data key via `sidecar_key()` — same mechanism as
#: VALIDATE_DATA_FILENAME above. Mirrored in artifact-keys.ts as
#: `EXPORT_CSV_FILENAME` — change both.
EXPORT_CSV_FILENAME = "export.csv"
```

- [ ] **Step 1 done — no test yet, this is a constant.**

### Step 2: Write the failing test for `export_artifact_csv`

Create `apps/python/tests/test_export_service.py`:

```python
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/python && python -m pytest tests/test_export_service.py -v`
Expected: `ModuleNotFoundError: No module named 'services.export_service'` (or `ImportError` for `ExportRequest`).

### Step 3: Add the pydantic schemas

In `apps/python/schemas/preprocess.py`, near `ArtifactStatsResponse` (find that class first with `grep -n "class ArtifactStatsResponse" apps/python/schemas/preprocess.py`), add:

```python
class ExportRequest(BaseModel):
    """DS-LAKE-021-T01. `source_key` is the committed FINAL artifact's
    data.parquet key — NestJS resolves which artifact is FINAL and passes
    its objectKey verbatim, same convention every other *Request here uses."""

    source_key: str


class ExportStatsResponse(BaseModel):
    """What NestJS persists on the new EXPORT DatasetArtifact row."""

    object_key: str
    row_count: int
    #: LOGICAL tag count — __status columns are dropped, so this is the
    #: same count FINAL's own columnCount already records, not 2N+1.
    column_count: int
    size_bytes: int
    checksum: str
```

### Step 4: Write `export_service.py`

Create `apps/python/services/export_service.py`:

```python
"""CSV export of a committed artifact — DS-LAKE-021.

Streams row-group by row-group via pyarrow's ParquetFile.iter_batches(),
never materialising the full frame in memory (the same discipline
validate/materialize already follow, per DS-LAKE-005B-C-T07's own
peak_rss_kb precedent). __status sidecar columns are dropped from the
output; a Bad-status cell writes as an empty CSV field, never the raw
0.0 frame_service.MISSING_VALUE actually stores in the source Parquet
(userDecisions, DS-LAKE-021).
"""

from __future__ import annotations

import io

import pandas as pd
import pyarrow.parquet as pq

from intergrations.object_store import (
    EXPORT_CSV_FILENAME,
    ObjectStore,
    ObjectStoreError,
    STATUS_BAD,
    STATUS_SUFFIX,
    TIMESTAMP_COLUMN,
    sidecar_key,
)
from schemas.preprocess import ExportRequest, ExportStatsResponse

#: Batch size for iter_batches — large enough that a small artifact needs
#: one batch, small enough that a multi-million-row artifact never holds
#: more than this many rows in memory at once.
BATCH_ROWS = 50_000


def export_artifact_csv(
    store: ObjectStore, request: ExportRequest
) -> ExportStatsResponse:
    payload = store.get_object_bytes(request.source_key)
    buffer = io.BytesIO(payload)
    parquet_file = pq.ParquetFile(buffer)

    all_columns = list(parquet_file.schema_arrow.names)
    status_columns = {c for c in all_columns if c.endswith(STATUS_SUFFIX)}
    value_columns = [
        c for c in all_columns if c != TIMESTAMP_COLUMN and c not in status_columns
    ]
    output_columns = [TIMESTAMP_COLUMN, *value_columns]

    out = io.StringIO()
    total_rows = 0
    header_written = False

    for record_batch in parquet_file.iter_batches(batch_size=BATCH_ROWS):
        batch_df = record_batch.to_pandas()

        for tag in value_columns:
            status_col = f"{tag}{STATUS_SUFFIX}"
            if status_col in batch_df.columns:
                bad_mask = batch_df[status_col] == STATUS_BAD
                # object dtype so a blanked cell can hold "" without pandas
                # silently upcasting the whole column back to float NaN,
                # which would round-trip through to_csv as an EMPTY field
                # too — but only by pandas's own convention, not this
                # function's explicit choice. Explicit beats implicit here:
                # a Bad reading must be OBSERVABLY blank, not accidentally so.
                col = batch_df[tag].astype(object)
                col[bad_mask] = ""
                batch_df[tag] = col

        chunk = batch_df[output_columns]
        chunk.to_csv(out, index=False, header=not header_written, mode="a")
        header_written = True
        total_rows += len(batch_df)

    csv_bytes = out.getvalue().encode("utf-8")
    export_key = sidecar_key(request.source_key, EXPORT_CSV_FILENAME)
    store.put_object_bytes(export_key, csv_bytes)

    return ExportStatsResponse(
        object_key=export_key,
        row_count=total_rows,
        column_count=len(value_columns),
        size_bytes=len(csv_bytes),
        checksum=store.checksum_of(export_key),
    )
```

**Note for the implementer:** `ObjectStore` today exposes `get_frame`/`put_frame` (pandas-frame-shaped) and low-level MinIO calls inside `get_frame`'s and `put_frame`'s own bodies (`self._client.get_object`/`put_object`), but no public `get_object_bytes`/`put_object_bytes` pair. Add those two thin methods to `ObjectStore` in `apps/python/intergrations/object_store.py`, factored out of `get_frame`'s and `put_frame`'s existing MinIO-call bodies (same `S3Error` → `ObjectStoreError` wrapping each already does) — `export_artifact_csv` needs raw bytes in and out, not a decoded DataFrame, since it writes CSV text, not Parquet. Keep `get_frame`/`put_frame` calling the new methods internally so there is one code path for the S3 client calls, not two.

- [ ] **Step 4: Run the test again**

Run: `cd apps/python && python -m pytest tests/test_export_service.py -v`
Expected: PASS (all three tests).

### Step 5: Wire the FastAPI route

In `apps/python/routers/preprocess.py`, add the import at the top (alongside the other schema imports):

```python
from schemas.preprocess import ExportRequest, ExportStatsResponse
```

And near the bottom of the file's route definitions (after the last `@router.post`), add:

```python
@router.post(
    "/export",
    response_model=ExportStatsResponse,
    summary="Export a committed artifact as CSV",
    description=(
        "DS-LAKE-021. Streams the source artifact's data.parquet into a "
        "sidecar CSV, row-group by row-group. __status columns are "
        "dropped; a Bad-status cell exports as an empty field, never the "
        "raw 0.0 the Parquet stores."
    ),
)
async def export_pipeline(
    body: ExportRequest,
    store: ObjectStore = Depends(get_object_store),
):
    return await _run(export_artifact_csv, store, body)
```

Add the service import too:

```python
from services.export_service import export_artifact_csv
```

- [ ] **Step 5: Run the full Python test suite for regressions**

Run: `cd apps/python && python -m pytest tests/ -v -k "export or object_store"`
Expected: all PASS, including the new `test_export_service.py` tests and any existing `object_store` tests (confirming the new `get_object_bytes`/`put_object_bytes` refactor didn't break `get_frame`/`put_frame`).

- [ ] **Step 6: Commit**

```bash
git add apps/python/intergrations/object_store.py apps/python/schemas/preprocess.py apps/python/services/export_service.py apps/python/routers/preprocess.py apps/python/tests/test_export_service.py
git commit -m "feat(python): stream CSV export of a committed artifact

DS-LAKE-021-T01. Row-group streaming via ParquetFile.iter_batches — no
full-frame materialisation. __status columns dropped; a Bad-status
cell exports as an empty field, never the stored 0.0."
```

---

## Task 3: NestJS — `readExportRequest`, the EXPORT job branch, and the artifact-key mirror

**Files:**

- Modify: `apps/backend/src/lib/artifact-keys.ts`
- Modify: `apps/backend/src/api/v1/dataset-version/authorized/dto/dataset-version.authorized.dto.ts`
- Modify: `apps/backend/src/api/v1/dataset-version/authorized/preprocessing-job.service.ts`
- Test: `apps/backend/src/api/v1/dataset-version/authorized/preprocessing-job.service.spec.ts`

**Interfaces:**

- Consumes: Python's `POST /v1/preprocess/export` (Task 2) via `postToPython`, response parsed by `ExportStatsSchema` (defined this task).
- Produces: `PreprocessingJobService`'s `run()` now handles `job.stage === 'EXPORT'`, committing a `DatasetArtifact{ type: 'EXPORT', parentArtifactId: <sourceArtifactId> }` row and setting `job.resultArtifactId` — Task 4's `startExportService` relies on this to know when a started job has a downloadable result.

### Step 1: Mirror the filename constant

In `apps/backend/src/lib/artifact-keys.ts`, find:

```ts
/**
 * DS-LAKE-018-T03. The raw validation-holdout sidecar, beside a BRONZE's own
 * data key. Mirrored from `VALIDATE_DATA_FILENAME` in object_store.py —
 * change both.
 */
export const VALIDATE_DATA_FILENAME = 'validate_data.parquet'
```

Add immediately after:

```ts
/**
 * DS-LAKE-021-T01. The CSV export sidecar, beside a committed artifact's own
 * data key. Mirrored from `EXPORT_CSV_FILENAME` in object_store.py — change
 * both.
 */
export const EXPORT_CSV_FILENAME = 'export.csv'
```

### Step 2: Add `ExportStatsSchema`

In `apps/backend/src/api/v1/dataset-version/authorized/dto/dataset-version.authorized.dto.ts`, find `ArtifactStatsSchema`'s definition (`grep -n "export const ArtifactStatsSchema" apps/backend/src/api/v1/dataset-version/authorized/dto/dataset-version.authorized.dto.ts`) and add immediately after its `export type ArtifactStats = z.infer<typeof ArtifactStatsSchema>;` line:

```ts
/** Mirrors apps/python `schemas.preprocess.ExportStatsResponse`. */
export const ExportStatsSchema = z.object({
  object_key: z.string().min(1),
  row_count: z.number().int().nonnegative(),
  column_count: z.number().int().nonnegative(),
  size_bytes: z.number().int().nonnegative(),
  checksum: z.string().length(64),
})
export type ExportStats = z.infer<typeof ExportStatsSchema>
```

### Step 3: Write the failing test for the EXPORT branch

Open `apps/backend/src/api/v1/dataset-version/authorized/preprocessing-job.service.spec.ts`. Find the `buildFeatureJob` helper (around line 533) to see its shape, then add a matching `buildExportJob` helper and the new test cases right after the existing FEAT-05 test (find it with `grep -n "FEAT-05" apps/backend/src/api/v1/dataset-version/authorized/preprocessing-job.service.spec.ts`):

```ts
const EXPORT_ARTIFACT = {
  object_key: 'ds-1/artifacts/a-1/export.csv',
  row_count: 500,
  column_count: 3,
  size_bytes: 20480,
  checksum: 'b'.repeat(64),
}

function buildExportJob(overrides: Record<string, unknown> = {}) {
  return buildJob({
    stage: 'EXPORT',
    operations: { kind: 'export' },
    ...overrides,
  })
}

describe('EXPORT stage', () => {
  it('EXP-01: commits an EXPORT artifact with parentArtifactId set to the source', async () => {
    post.mockResolvedValue(EXPORT_ARTIFACT)
    const { service, tx } = makeService(buildExportJob())
    await (service as unknown as Runnable).run('job-1')

    const artifact = firstWrite(tx.datasetArtifact.create)
    expect(artifact.type).toBe('EXPORT')
    expect(artifact.parentArtifactId).toBe('a-1')
    expect(artifact.objectKey).toBe(EXPORT_ARTIFACT.object_key)
    expect(artifact.rowCount).toBe(500)

    const jobWrite = firstWrite(tx.preprocessingJob.update)
    expect(jobWrite).toMatchObject({ status: 'SUCCEEDED', completedSteps: 1 })
  })

  it('EXP-02: calls /v1/preprocess/export with the source artifact objectKey', async () => {
    post.mockResolvedValue(EXPORT_ARTIFACT)
    const { service } = makeService(buildExportJob())
    await (service as unknown as Runnable).run('job-1')

    const exportCalls = post.mock.calls.filter(
      ([path]) => path === '/v1/preprocess/export',
    )
    expect(exportCalls).toHaveLength(1)
    expect(exportCalls[0]?.[1]).toMatchObject({
      source_key: 'ds-1/artifacts/a-1/data.parquet',
    })
  })

  it('EXP-03: a CLEAN-shaped payload on an EXPORT-stage job FAILS rather than silently exporting nothing', async () => {
    const { service, prisma, tx } = makeService(
      buildExportJob({
        operations: { operations: [{ type: 'drop_missing' }], precision: {} },
      }),
    )
    await (service as unknown as Runnable).run('job-1')

    expect(post).not.toHaveBeenCalled()
    expect(tx.datasetArtifact.create).not.toHaveBeenCalled()
    const final = { data: lastWrite(prisma.preprocessingJob.update) }
    expect(final.data.status).toBe('FAILED')
    expect(final.data.error).toContain('export')
  })

  it('EXP-04: an EXPORT-shaped payload on a CLEAN-stage job FAILS rather than running zero operations', async () => {
    const { service, prisma, tx } = makeService(
      buildJob({ stage: 'CLEAN', operations: { kind: 'export' } }),
    )
    await (service as unknown as Runnable).run('job-1')

    expect(post).not.toHaveBeenCalled()
    expect(tx.datasetArtifact.create).not.toHaveBeenCalled()
    const final = { data: lastWrite(prisma.preprocessingJob.update) }
    expect(final.data.status).toBe('FAILED')
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter backend exec jest preprocessing-job.service.spec.ts -t "EXPORT stage"`
Expected: FAIL — `stage: 'EXPORT'` is not yet a case `run()` handles (EXP-01/EXP-02 will see `post` never called or the wrong branch taken; EXP-03/EXP-04 may pass vacuously or fail differently — the point is none reflect real EXPORT handling yet).

### Step 4: Implement `readExportRequest` and the EXPORT branch

Open `apps/backend/src/api/v1/dataset-version/authorized/preprocessing-job.service.ts`.

Add `readExportRequest`, right after the existing `readFeatureRecipe` method (find it with `grep -n "private readFeatureRecipe" apps/backend/src/api/v1/dataset-version/authorized/preprocessing-job.service.ts`):

```ts
/**
 * `PreprocessingJob.operations` stores `{ kind: 'export' }` for an
 * EXPORT-stage job — nothing else to configure, unlike CLEAN/FEATURE.
 * Never called for a CLEAN or FEATURE job — `run()` branches on
 * `job.stage` before any reader runs — but still actively refuses any
 * other shape rather than coercing, mirroring `readOperations`/
 * `readFeatureRecipe`'s own refusal discipline.
 */
private readExportRequest(raw: PrismaTypes.JsonValue): void {
  const payload = Array.isArray(raw)
    ? null
    : (raw as { kind?: unknown } | null);
  if (!payload || payload.kind !== 'export') {
    throw new AppException({
      statusCode: 500,
      message:
        'Stored job payload is not an export request — refusing to run as EXPORT.',
      type: 'ERROR',
    });
  }
}
```

Now find the `isFeatureJob` declaration inside `run()` (`grep -n "const isFeatureJob" apps/backend/src/api/v1/dataset-version/authorized/preprocessing-job.service.ts`) and add a sibling flag right after it:

```ts
const isExportJob = job.stage === 'EXPORT'
```

Find the block that reads/validates the recipe before the RUNNING transition (`grep -n "if (isFeatureJob) {" apps/backend/src/api/v1/dataset-version/authorized/preprocessing-job.service.ts` — the one inside the `try { ... } catch` right after `let featureRecipe` is declared). Change:

```ts
    try {
      if (isFeatureJob) {
        featureRecipe = this.readFeatureRecipe(job.operations);
      } else {
        operations = this.readOperations(job.operations);
        precision = this.readPrecision(job.operations);
      }
    } catch (err) {
```

to:

```ts
    try {
      if (isFeatureJob) {
        featureRecipe = this.readFeatureRecipe(job.operations);
      } else if (isExportJob) {
        this.readExportRequest(job.operations);
      } else {
        operations = this.readOperations(job.operations);
        precision = this.readPrecision(job.operations);
      }
    } catch (err) {
```

Find `const totalSteps = isFeatureJob ? 1 : operations.length;` and change to:

```ts
const totalSteps = isFeatureJob || isExportJob ? 1 : operations.length
```

Now find the main `if (isFeatureJob) { ... } else { ... }` block inside the second `try` (the one that calls `postToPython('/v1/preprocess/features', ...)` vs the CLEAN loop — `grep -n "if (isFeatureJob) {" apps/backend/src/api/v1/dataset-version/authorized/preprocessing-job.service.ts` again, second match). Restructure it to a three-way branch:

```ts
      if (isFeatureJob) {
        const recipe = featureRecipe!;
        this.assertNotCanceled(controller);
        await this.reportStep(jobId, {
          completedSteps: 0,
          totalSteps: 1,
          currentStep: 'features',
          startedAt,
        });

        stats = ArtifactStatsSchema.parse(
          await postToPython(
            '/v1/preprocess/features',
            {
              source_key: sourceObjectKey,
              target_key: committedKey,
              features: recipe.features,
              selectedColumns: recipe.selectedColumns,
              scalers: recipe.scalers,
              overwrite: false,
              target_y: recipe.targetY,
            },
            PYTHON_TIMEOUT.preprocess,
            controller.signal,
          ),
        );
      } else if (isExportJob) {
        this.assertNotCanceled(controller);
        await this.reportStep(jobId, {
          completedSteps: 0,
          totalSteps: 1,
          currentStep: 'export',
          startedAt,
        });

        const exportStats = ExportStatsSchema.parse(
          await postToPython(
            '/v1/preprocess/export',
            { source_key: sourceObjectKey },
            PYTHON_TIMEOUT.preprocess,
            controller.signal,
          ),
        );
        // Reused as ArtifactStats below (commit() takes one shape) —
        // missing_pct/column_stats_key have no export equivalent, so
        // they're filled with the same "not applicable" defaults every
        // other optional field with nothing to report already uses.
        stats = {
          object_key: exportStats.object_key,
          row_count: exportStats.row_count,
          column_count: exportStats.column_count,
          size_bytes: exportStats.size_bytes,
          missing_pct: 0,
          checksum: exportStats.checksum,
          duration_ms: Date.now() - startedAt,
          column_stats_key: null,
        };
      } else {
```

(The closing brace of the original `else { ... }` CLEAN loop is unchanged — only the `if`/`else` chain above it grew a middle branch.)

Find the `await this.commit(...)` call and its `artifactType` argument — it currently reads `artifactType` from the outer `const artifactType = isFeatureJob ? 'GOLD' : 'SILVER';` declared earlier in `run()`. Find that declaration (`grep -n "const artifactType" apps/backend/src/api/v1/dataset-version/authorized/preprocessing-job.service.ts`) and change:

```ts
const artifactType = isFeatureJob ? 'GOLD' : 'SILVER'
```

to:

```ts
const artifactType = isFeatureJob ? 'GOLD' : isExportJob ? 'EXPORT' : 'SILVER'
```

`commit()`'s own parameter type currently reads `artifactType: 'SILVER' | 'GOLD'` — widen it to `'SILVER' | 'GOLD' | 'EXPORT'` (find with `grep -n "artifactType: 'SILVER' | 'GOLD'" apps/backend/src/api/v1/dataset-version/authorized/preprocessing-job.service.ts`).

Find the `if (!stats) { throw ... }` block's message ternary (`isFeatureJob ? 'Feature engineering produced no result.' : 'A cleaning job needs at least one operation.'`) and widen it:

```ts
message: isFeatureJob
  ? 'Feature engineering produced no result.'
  : isExportJob
    ? 'Export produced no result.'
    : 'A cleaning job needs at least one operation.',
```

Finally, extend the `ExportStatsSchema` import at the top of the file, alongside the existing `ArtifactStatsSchema` import — find its exact current line with `grep -n "ArtifactStatsSchema" apps/backend/src/api/v1/dataset-version/authorized/preprocessing-job.service.ts` and add `ExportStatsSchema` to the same `import { ... } from './dto/dataset-version.authorized.dto';` line.

- [ ] **Step 4: Run the tests again**

Run: `pnpm --filter backend exec jest preprocessing-job.service.spec.ts`
Expected: ALL PASS — the four new EXPORT tests plus every pre-existing CLEAN/FEATURE test (confirming the three-way branch didn't regress the other two stages).

- [ ] **Step 5: Full backend typecheck**

Run: `pnpm --filter backend exec tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/lib/artifact-keys.ts apps/backend/src/api/v1/dataset-version/authorized/dto/dataset-version.authorized.dto.ts apps/backend/src/api/v1/dataset-version/authorized/preprocessing-job.service.ts apps/backend/src/api/v1/dataset-version/authorized/preprocessing-job.service.spec.ts
git commit -m "feat(backend): EXPORT job stage — commits a DatasetArtifact{type: EXPORT}

DS-LAKE-021-T02. Third job.stage branch beside CLEAN/FEATURE, same
refuse-a-wrong-payload-shape discipline readOperations/readFeatureRecipe
already establish."
```

---

## Task 4: NestJS — start-export and download routes

**Files:**

- Modify: `apps/backend/src/api/v1/dataset-version/authorized/dataset-version.authorized.service.ts`
- Modify: `apps/backend/src/api/v1/dataset-version/authorized/dataset-version.authorized.controller.ts`
- Test: `apps/backend/src/api/v1/dataset-version/authorized/dataset-version.authorized.service.spec.ts`

**Interfaces:**

- Consumes: `PreprocessingJobService`'s job model from Task 3 (a `PreprocessingJob` row with `stage: 'EXPORT'`); `presignArtifact` from `apps/backend/src/lib/python-preprocess-client.ts` (existing, signature `presignArtifact(input: { source_key: string; sidecars?: string[] }): Promise<PresignedArtifact>`, where `PresignedArtifact.sidecar_urls: Record<string, string | null>`).
- Produces: `startExportService(user, datasetId): Promise<{ jobId: string }>` and `getExportDownloadService(user, datasetId, artifactId): Promise<{ downloadUrl: string, expiresAt: string }>` — Task 6's client service calls these two HTTP routes directly, not these method names (they're internal), but the response shapes below are the actual contract Task 6 codes against.

### Step 1: Write the failing test

Open `apps/backend/src/api/v1/dataset-version/authorized/dataset-version.authorized.service.spec.ts`. Check its existing mock-building pattern first:

Run: `grep -n "function buildPrisma\|USER =\|DATASET =" apps/backend/src/api/v1/dataset-version/authorized/dataset-version.authorized.service.spec.ts | head -10`

(This file already has `buildPrisma`/`USER`/`DATASET` helpers from earlier work in this codebase — reuse them; do not redefine.) Add near the end of the file:

```ts
describe('DatasetVersionAuthorizedService — startExportService / getExportDownloadService (DS-LAKE-021)', () => {
  beforeEach(() => jest.clearAllMocks())

  it("creates an EXPORT-stage job against the dataset's FINAL artifact", async () => {
    const prisma = buildPrisma()
    prisma.datasetArtifact.findFirst.mockResolvedValueOnce({
      id: 'final-1',
      type: 'FINAL',
      objectKey: 'ds-1/artifacts/final-1/data.parquet',
      runId: 'run-1',
    })
    prisma.preprocessingJob.create.mockResolvedValueOnce({ id: 'job-9' })
    const { service } = makeService(prisma)

    const res = await service.startExportService(USER, 'ds-1')

    expect(res.data.jobId).toBe('job-9')
    const createArgs = prisma.preprocessingJob.create.mock.calls[0][0]
    expect(createArgs.data).toMatchObject({
      stage: 'EXPORT',
      sourceArtifactId: 'final-1',
      operations: { kind: 'export' },
    })
  })

  it('404s when the dataset has no FINAL artifact', async () => {
    const prisma = buildPrisma()
    prisma.datasetArtifact.findFirst.mockResolvedValueOnce(null)
    const { service } = makeService(prisma)

    await expect(service.startExportService(USER, 'ds-1')).rejects.toThrow(
      AppException,
    )
  })

  it('getExportDownloadService presigns the FINAL objectKey with the export sidecar, fresh every call', async () => {
    const prisma = buildPrisma()
    prisma.datasetArtifact.findFirst
      .mockResolvedValueOnce({
        id: 'export-1',
        type: 'EXPORT',
        parentArtifactId: 'final-1',
      })
      .mockResolvedValueOnce({
        id: 'final-1',
        objectKey: 'ds-1/artifacts/final-1/data.parquet',
      })
    post.mockResolvedValue({
      data_url: 'https://minio.example/gold-signed',
      sidecar_urls: { 'export.csv': 'https://minio.example/export-signed' },
      checksum: 'c'.repeat(64),
      row_count: 500,
      expires_at: '2026-08-24T01:00:00Z',
    })
    const { service } = makeService(prisma)

    const res = await service.getExportDownloadService(USER, 'ds-1', 'export-1')

    expect(res.data.downloadUrl).toBe('https://minio.example/export-signed')
    expect(res.data.expiresAt).toBe('2026-08-24T01:00:00Z')
    expect(post).toHaveBeenCalledWith(
      '/v1/preprocess/artifacts/presign',
      {
        source_key: 'ds-1/artifacts/final-1/data.parquet',
        sidecars: ['export.csv'],
      },
      expect.anything(),
    )
  })

  it('getExportDownloadService 404s when the artifact is not type EXPORT', async () => {
    const prisma = buildPrisma()
    prisma.datasetArtifact.findFirst.mockResolvedValueOnce({
      id: 'silver-1',
      type: 'SILVER',
      parentArtifactId: null,
    })
    const { service } = makeService(prisma)

    await expect(
      service.getExportDownloadService(USER, 'ds-1', 'silver-1'),
    ).rejects.toThrow(AppException)
  })
})
```

Check `post` is already an available mocked import in this file (`grep -n "^const post\|postToPython as jest" apps/backend/src/api/v1/dataset-version/authorized/dataset-version.authorized.service.spec.ts`) — reuse it, matching the exact mock-import style the file's own `getArtifactHoldoutService` tests already use (from the earlier holdout work in this codebase).

- [ ] **Step 1: Run it to verify it fails**

Run: `pnpm --filter backend exec jest dataset-version.authorized.service.spec.ts -t "DS-LAKE-021"`
Expected: FAIL — `service.startExportService is not a function`.

### Step 2: Implement `startExportService`

Open `apps/backend/src/api/v1/dataset-version/authorized/dataset-version.authorized.service.ts`. Find `assertDatasetAccess` (`grep -n "private async assertDatasetAccess" apps/backend/src/api/v1/dataset-version/authorized/dataset-version.authorized.service.ts`) to confirm its exact signature, then add near the end of the class (after `getArtifactHoldoutService` — find with `grep -n "async getArtifactHoldoutService" apps/backend/src/api/v1/dataset-version/authorized/dataset-version.authorized.service.ts`):

```ts
/**
 * DS-LAKE-021-T02. The dataset's `currentArtifactId` is stage-polymorphic
 * (per its own doc comment elsewhere in this file) — it is FINAL only once
 * the dataset is fully saved. This looks up the FINAL row explicitly rather
 * than trusting `currentArtifactId`, same discipline
 * `saveDraftAsDatasetService` already uses on the draft side, so an export
 * started against a dataset with no FINAL commit fails loudly instead of
 * exporting the wrong stage.
 */
async startExportService(user: Auth.UserPayload, datasetId: string) {
  await this.assertDatasetAccess(datasetId, user);

  const final = await this.prisma.datasetArtifact.findFirst({
    where: { datasetId, type: 'FINAL' },
    orderBy: { createdAt: 'desc' },
  });
  if (!final) {
    throw new AppException({
      statusCode: 404,
      message: 'Dataset has no FINAL artifact to export.',
      type: 'ERROR',
    });
  }

  const job = await this.prisma.preprocessingJob.create({
    data: {
      datasetId,
      sourceArtifactId: final.id,
      stage: 'EXPORT',
      operations: { kind: 'export' },
      createdById: user.id,
    },
  });

  return {
    statusCode: 202,
    message: 'Export job started',
    type: 'SUCCESS' as const,
    data: { jobId: job.id },
  };
}

/**
 * DS-LAKE-021-T03. First NestJS method that hands a presigned URL to the
 * browser — every existing `presignArtifact` caller is server-to-server
 * (e.g. `ModelRunAuthorizedService.claim()` embeds one in its response to
 * the training container, not a browser tab). Presigns FRESH on every
 * call rather than caching a value from job completion — presigned URLs
 * expire (`expires_at`), so a stale link served from an old job payload
 * would 403 client-side with no way to recover short of re-running export.
 */
async getExportDownloadService(
  user: Auth.UserPayload,
  datasetId: string,
  artifactId: string,
) {
  await this.assertDatasetAccess(datasetId, user);

  const exportArtifact = await this.prisma.datasetArtifact.findFirst({
    where: { id: artifactId, datasetId, type: 'EXPORT' },
    select: { parentArtifactId: true },
  });
  if (!exportArtifact || !exportArtifact.parentArtifactId) {
    throw new AppException({
      statusCode: 404,
      message: 'Export artifact not found for this dataset.',
      type: 'ERROR',
    });
  }

  const final = await this.prisma.datasetArtifact.findFirst({
    where: { id: exportArtifact.parentArtifactId },
    select: { objectKey: true },
  });
  if (!final) {
    throw new AppException({
      statusCode: 404,
      message: 'Source artifact for this export no longer exists.',
      type: 'ERROR',
    });
  }

  const presigned = await presignArtifact({
    source_key: final.objectKey,
    sidecars: [EXPORT_CSV_FILENAME],
  });
  const downloadUrl = presigned.sidecar_urls[EXPORT_CSV_FILENAME];
  if (!downloadUrl) {
    throw new AppException({
      statusCode: 404,
      message: 'Export file is missing from storage — re-run the export.',
      type: 'ERROR',
    });
  }

  return {
    statusCode: 200,
    message: 'Export download link',
    type: 'SUCCESS' as const,
    data: { downloadUrl, expiresAt: presigned.expires_at },
  };
}
```

Add the two new imports at the top of the file (extend the existing `presignArtifact` and `artifact-keys` import lines — find them with `grep -n "presignArtifact\|from '@/lib/artifact-keys'" apps/backend/src/api/v1/dataset-version/authorized/dataset-version.authorized.service.ts`):

```ts
import { presignArtifact } from '@/lib/python-preprocess-client'
import { EXPORT_CSV_FILENAME } from '@/lib/artifact-keys'
```

(If `presignArtifact` is already imported in this file for other reasons, just add `EXPORT_CSV_FILENAME` to the existing `artifact-keys` import list instead of a new line.)

- [ ] **Step 2: Run the tests again**

Run: `pnpm --filter backend exec jest dataset-version.authorized.service.spec.ts -t "DS-LAKE-021"`
Expected: PASS — all four new tests.

### Step 3: Add the controller routes

Open `apps/backend/src/api/v1/dataset-version/authorized/dataset-version.authorized.controller.ts`. Find the `/:id/jobs/:jobId` route (`grep -n "@Get('/:id/jobs/:jobId')" apps/backend/src/api/v1/dataset-version/authorized/dataset-version.authorized.controller.ts`) and add these two routes right before it:

```ts
@Post('/:id/export')
@HttpCode(202)
@ApiOperation({
  summary: 'Start an export job (202 + jobId)',
  description:
    'Returns immediately with a job id; poll `GET /:id/jobs/:jobId` for ' +
    'progress. Exports the dataset\'s FINAL artifact only.',
})
async startExportController(
  @Users() user: Auth.UserPayload,
  @Param('id') id: string,
) {
  return this.service.startExportService(user, id);
}

@Get('/:id/export/:artifactId/download')
@HttpCode(200)
@ApiOperation({
  summary: 'Presigned download link for a completed export artifact',
  description:
    'Presigns fresh on every call — the link expires, so this must not ' +
    'be cached from job-completion time.',
})
async getExportDownloadController(
  @Users() user: Auth.UserPayload,
  @Param('id') id: string,
  @Param('artifactId') artifactId: string,
) {
  return this.service.getExportDownloadService(user, id, artifactId);
}
```

- [ ] **Step 3: Full backend test suite + typecheck**

Run: `pnpm --filter backend exec jest dataset-version.authorized.service.spec.ts preprocessing-job.service.spec.ts`
Expected: all PASS.

Run: `pnpm --filter backend exec tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/api/v1/dataset-version/authorized/dataset-version.authorized.service.ts apps/backend/src/api/v1/dataset-version/authorized/dataset-version.authorized.controller.ts apps/backend/src/api/v1/dataset-version/authorized/dataset-version.authorized.service.spec.ts
git commit -m "feat(backend): export start + download routes

DS-LAKE-021-T03. POST /:id/export starts the job; GET
/:id/export/:artifactId/download presigns fresh on every call — the
first NestJS route that hands a presigned URL to the browser."
```

---

## Task 5: Reclaim sweep — confirm EXPORT rides the existing sweep

**Files:**

- Test: `apps/backend/src/api/v1/artifact-cleanup/admin/artifact-cleanup.admin.service.spec.ts`

**Interfaces:**

- Consumes: `DatasetArtifactType.EXPORT` (Task 1). No production code changes in this task — the existing sweep query `WHERE type: { not: 'FINAL' }` already matches EXPORT; this task only proves it with a test, per the spec's explicit call-out that no new sweep logic is needed.

- [ ] **Step 1: Write the confirming test**

Open `apps/backend/src/api/v1/artifact-cleanup/admin/artifact-cleanup.admin.service.spec.ts`. Find its existing candidate-building pattern (`grep -n "type: 'SILVER'\|type: 'GOLD'" apps/backend/src/api/v1/artifact-cleanup/admin/artifact-cleanup.admin.service.spec.ts` to see how a non-FINAL candidate is already built in an existing test), then add a test in the same style, substituting `type: 'EXPORT'` for whichever non-FINAL type an existing test already uses, and asserting it is reclaimed identically (present in the sweep's `reclaimed` count, `objectReclaimedAt` written). Copy the exact structure of the nearest existing single-candidate reclaim test rather than inventing a new fixture shape — the point of this task is proving the type widening didn't accidentally exempt EXPORT, not testing new behavior.

- [ ] **Step 2: Run it**

Run: `pnpm --filter backend exec jest artifact-cleanup.admin.service.spec.ts`
Expected: PASS, including the new EXPORT test.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/api/v1/artifact-cleanup/admin/artifact-cleanup.admin.service.spec.ts
git commit -m "test(backend): confirm EXPORT artifacts are reclaimed by the existing sweep

DS-LAKE-021 reclaim decision — no new sweep code, WHERE type != FINAL
already matches EXPORT. This pins that the enum widening in Task 1
didn't silently exempt it."
```

---

## Task 6: Client — generalize the job poller

**Files:**

- Modify: `apps/client/lib/poll-preprocessing-job.ts`
- Test: locate the existing test file for this module (Step 1 below finds it)

**Interfaces:**

- Consumes: nothing new — same `PreprocessingJobStatus` type already imported.
- Produces: `pollJobUntilTerminal<T extends { status: PreprocessingJobStatus }>(fetchJob: () => Promise<{ data: T }>, isCancelled: () => boolean): Promise<T | null>` (generic over the terminal row shape) and `pollDatasetJobUntilTerminal(datasetId: string, jobId: string, isCancelled: () => boolean): Promise<DraftPreprocessingJob | null>` — Task 7's `useDatasetExport` hook calls `pollDatasetJobUntilTerminal` by name.

- [ ] **Step 1: Locate existing tests for this file**

Run: `find apps/client -iname "*poll-preprocessing-job*test*"`

If a test file exists, read it fully before proceeding — its existing assertions on `pollDraftJobUntilTerminal` must keep passing unchanged after Step 2. If none exists, this task adds one at `apps/client/lib/poll-preprocessing-job.test.ts`.

- [ ] **Step 2: Write the failing test for the new dataset-scoped wrapper**

In the located (or new) test file, add — using whatever test runner convention the rest of the file already uses (Vitest, per this repo's client-side convention elsewhere):

```ts
import { describe, it, expect, vi } from 'vitest'
import { pollDatasetJobUntilTerminal } from './poll-preprocessing-job'
import { datasetVersionService } from '@/services/dataset-version'

vi.mock('@/services/dataset-version', () => ({
  datasetVersionService: { job: vi.fn() },
}))

describe('pollDatasetJobUntilTerminal', () => {
  it('polls datasetVersionService.job until a terminal status', async () => {
    const job = vi.mocked(datasetVersionService.job)
    job
      .mockResolvedValueOnce({ data: { status: 'RUNNING' } } as never)
      .mockResolvedValueOnce({
        data: { status: 'SUCCEEDED', resultArtifactId: 'a-1' },
      } as never)

    const result = await pollDatasetJobUntilTerminal(
      'ds-1',
      'job-1',
      () => false,
    )

    expect(result).toEqual({ status: 'SUCCEEDED', resultArtifactId: 'a-1' })
    expect(job).toHaveBeenCalledWith('ds-1', 'job-1')
  })

  it('returns null when cancelled before a terminal status arrives', async () => {
    const job = vi.mocked(datasetVersionService.job)
    job.mockResolvedValue({ data: { status: 'RUNNING' } } as never)
    let cancelled = false

    const promise = pollDatasetJobUntilTerminal(
      'ds-1',
      'job-1',
      () => cancelled,
    )
    cancelled = true

    const result = await promise
    expect(result).toBeNull()
  })
})
```

Check `datasetVersionService.job` exists already (`grep -n "job:" apps/client/services/dataset-version.ts` or `grep -n "async job(" apps/client/services/dataset-version.ts`) — it backs the existing `GET /:id/jobs/:jobId` route the client already polls for CLEAN jobs elsewhere in the dataset (non-draft) flow. If it doesn't exist yet under that exact name, check what the existing saved-dataset CLEAN-job UI calls instead (`grep -rn "jobs/:jobId\|/jobs/\${" apps/client/services/dataset-version.ts`) and use that method name in both the implementation and this test instead of inventing `job`.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter client exec vitest run lib/poll-preprocessing-job.test.ts` (adjust path to wherever Step 1 found/placed it)
Expected: FAIL — `pollDatasetJobUntilTerminal is not exported`.

### Step 3: Implement the generalization

Open `apps/client/lib/poll-preprocessing-job.ts`. Replace its current contents with:

```ts
import {
  datasetDraftService,
  type DraftPreprocessingJob,
} from '@/services/dataset-draft'
import { datasetVersionService } from '@/services/dataset-version'
import type { PreprocessingJobStatus } from '@/services/dataset-version'

const TERMINAL: PreprocessingJobStatus[] = ['SUCCEEDED', 'FAILED', 'CANCELED']

/** Shared with `useDatasetDraftPipeline`'s own poll cadence — CLEAN, FEATURE,
 * and EXPORT jobs should all feel the same to a user watching progress. */
export const JOB_POLL_MS = 1_200

/**
 * Generic core poll loop — `GET .../jobs/:jobId` until a terminal status,
 * whatever `fetchJob` happens to call. Extracted from the draft-only
 * `pollDraftJobUntilTerminal` (DS-LAKE-021) so a THIRD caller scoped to a
 * saved dataset (`pollDatasetJobUntilTerminal`, export jobs) does not have
 * to hand-roll its own loop — this file's own original doc comment already
 * argued for exactly one shared loop across CLEAN and FEATURE; a fork for
 * EXPORT would violate that same reasoning.
 *
 * `isCancelled` is checked before each iteration, not owned here — the
 * caller decides what "cancelled" means and is responsible for calling
 * whatever cancel-the-job action applies; this function only stops polling
 * once told to. Returns `null` on cancellation, the terminal row otherwise.
 */
export async function pollJobUntilTerminal<
  T extends { status: PreprocessingJobStatus },
>(
  fetchJob: () => Promise<{ data: T }>,
  isCancelled: () => boolean,
): Promise<T | null> {
  while (!isCancelled()) {
    const res = await fetchJob()
    if (TERMINAL.includes(res.data.status)) return res.data
    await new Promise(resolve => setTimeout(resolve, JOB_POLL_MS))
  }
  return null
}

/** Draft-scoped wrapper — unchanged call signature for existing callers
 * (`useDatasetGoldWarm`, `useDatasetDraftPipeline`). */
export function pollDraftJobUntilTerminal(
  draftId: string,
  jobId: string,
  isCancelled: () => boolean,
): Promise<DraftPreprocessingJob | null> {
  return pollJobUntilTerminal(
    () => datasetDraftService.job(draftId, jobId),
    isCancelled,
  )
}

/**
 * DS-LAKE-021. Dataset-scoped wrapper for a job that runs against a SAVED
 * dataset rather than a draft — export is the first caller, but the same
 * `GET /:id/jobs/:jobId` route already backs any saved-dataset job.
 */
export function pollDatasetJobUntilTerminal(
  datasetId: string,
  jobId: string,
  isCancelled: () => boolean,
) {
  return pollJobUntilTerminal(
    () => datasetVersionService.job(datasetId, jobId),
    isCancelled,
  )
}
```

**Note for the implementer:** confirm the exact return type of `datasetVersionService.job(...)` matches the `{ data: T }` shape `pollJobUntilTerminal` expects (`grep -n "async job(" apps/client/services/dataset-version.ts` to check). If its response shape differs (e.g. no `.data` wrapper, or a different field name than `status`), adjust `pollDatasetJobUntilTerminal`'s inner arrow function to normalize it before this compiles — do not change `pollJobUntilTerminal`'s generic contract to fit one caller.

- [ ] **Step 3: Run the tests again**

Run: `pnpm --filter client exec vitest run lib/poll-preprocessing-job.test.ts` (adjust path as needed)
Expected: PASS, both new tests.

- [ ] **Step 4: Confirm the two existing callers still compile and pass**

Run: `pnpm --filter client exec tsc --noEmit -p tsconfig.json`
Expected: clean — `pollDraftJobUntilTerminal`'s call signature is unchanged, so `useDatasetGoldWarm`/`useDatasetDraftPipeline` need no edits.

Run: `pnpm --filter client exec vitest run hooks/dataset/use-dataset-gold-warm.test.ts hooks/dataset/use-dataset-draft-pipeline.test.ts` (adjust filenames if they differ — `find apps/client/hooks/dataset -iname "*gold-warm*test*" -o -iname "*draft-pipeline*test*"` to confirm first)
Expected: PASS, unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/client/lib/poll-preprocessing-job.ts apps/client/lib/poll-preprocessing-job.test.ts
git commit -m "refactor(client): generalize the job poller off its draft-only assumption

DS-LAKE-021. pollJobUntilTerminal takes a fetch callback;
pollDraftJobUntilTerminal becomes a one-line wrapper (unchanged
signature, existing callers untouched); new pollDatasetJobUntilTerminal
serves export's saved-dataset-scoped polling."
```

---

## Task 7: Client — export service methods, hook, and the Step 5 control

**Files:**

- Modify: `apps/client/services/dataset-version.ts`
- Create: `apps/client/hooks/dataset/use-dataset-export.ts`
- Test: `apps/client/hooks/dataset/use-dataset-export.test.ts`
- Modify: `apps/client/app/(default)/data-studio/create/components/step-5-review-save.tsx`

**Interfaces:**

- Consumes: `pollDatasetJobUntilTerminal` (Task 6); `startExportService`/`getExportDownloadService`'s HTTP contract (Task 4) — `POST /:id/export → { jobId }`, `GET /:id/export/:artifactId/download → { downloadUrl, expiresAt }`.
- Produces: `useDatasetExport(datasetId: string | null): { status: 'idle'|'running'|'ready'|'error', rowCount: number | null, columnCount: number | null, error: string | null, start: () => Promise<void>, cancel: () => void, download: () => Promise<void> }` — `step-5-review-save.tsx` is the sole consumer.

### Step 1: Add the two service methods

Open `apps/client/services/dataset-version.ts`. Find the existing `holdout` method (`grep -n "holdout:" apps/client/services/dataset-version.ts`) to match its exact style, then add near it:

```ts
startExport: (datasetId: string): Promise<ApiResponse<{ jobId: string }>> =>
  fetchClient(`${base(datasetId)}/export`, { method: 'POST' }),

exportDownload: (
  datasetId: string,
  artifactId: string,
): Promise<ApiResponse<{ downloadUrl: string; expiresAt: string }>> =>
  fetchClient(`${base(datasetId)}/export/${artifactId}/download`, {
    method: 'GET',
  }),
```

(Match `base(datasetId)` to whatever helper the existing `holdout` method uses for its own URL prefix — `grep -n "const base\|function base" apps/client/services/dataset-version.ts` to confirm the exact name.)

Also confirm `datasetVersionService.job` exists for Task 6's poller — if Task 6 found it under a different name, this step is where that gets settled for real (both must agree).

### Step 2: Write the failing hook test

Create `apps/client/hooks/dataset/use-dataset-export.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useDatasetExport } from './use-dataset-export'
import { datasetVersionService } from '@/services/dataset-version'

vi.mock('@/services/dataset-version', () => ({
  datasetVersionService: {
    startExport: vi.fn(),
    job: vi.fn(),
    exportDownload: vi.fn(),
  },
}))

const openSpy = vi.fn()
vi.stubGlobal('open', openSpy)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useDatasetExport', () => {
  it('start() runs the job to completion and reports row/column counts', async () => {
    vi.mocked(datasetVersionService.startExport).mockResolvedValue({
      data: { jobId: 'job-1' },
    } as never)
    vi.mocked(datasetVersionService.job).mockResolvedValue({
      data: {
        status: 'SUCCEEDED',
        resultArtifactId: 'export-1',
        rowCount: 500,
        columnCount: 3,
      },
    } as never)

    const { result } = renderHook(() => useDatasetExport('ds-1'))

    await act(async () => {
      await result.current.start()
    })

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.rowCount).toBe(500)
    expect(result.current.columnCount).toBe(3)
  })

  it('start() reports error status when the job fails', async () => {
    vi.mocked(datasetVersionService.startExport).mockResolvedValue({
      data: { jobId: 'job-1' },
    } as never)
    vi.mocked(datasetVersionService.job).mockResolvedValue({
      data: { status: 'FAILED', error: 'boom' },
    } as never)

    const { result } = renderHook(() => useDatasetExport('ds-1'))

    await act(async () => {
      await result.current.start()
    })

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toBe('boom')
  })

  it('download() fetches a fresh URL and opens it', async () => {
    vi.mocked(datasetVersionService.startExport).mockResolvedValue({
      data: { jobId: 'job-1' },
    } as never)
    vi.mocked(datasetVersionService.job).mockResolvedValue({
      data: {
        status: 'SUCCEEDED',
        resultArtifactId: 'export-1',
        rowCount: 500,
        columnCount: 3,
      },
    } as never)
    vi.mocked(datasetVersionService.exportDownload).mockResolvedValue({
      data: {
        downloadUrl: 'https://minio.example/signed',
        expiresAt: '2026-08-24T01:00:00Z',
      },
    } as never)

    const { result } = renderHook(() => useDatasetExport('ds-1'))
    await act(async () => {
      await result.current.start()
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      await result.current.download()
    })

    expect(datasetVersionService.exportDownload).toHaveBeenCalledWith(
      'ds-1',
      'export-1',
    )
    expect(openSpy).toHaveBeenCalledWith(
      'https://minio.example/signed',
      '_blank',
      'noreferrer',
    )
  })

  it('start() is a no-op when datasetId is null', async () => {
    const { result } = renderHook(() => useDatasetExport(null))

    await act(async () => {
      await result.current.start()
    })

    expect(datasetVersionService.startExport).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter client exec vitest run hooks/dataset/use-dataset-export.test.ts`
Expected: FAIL — module `./use-dataset-export` does not exist.

### Step 3: Implement the hook

Create `apps/client/hooks/dataset/use-dataset-export.ts`:

```ts
'use client'

import { useCallback, useRef, useState } from 'react'
import { datasetVersionService } from '@/services/dataset-version'
import { pollDatasetJobUntilTerminal } from '@/lib/poll-preprocessing-job'

export type DatasetExportStatus = 'idle' | 'running' | 'ready' | 'error'

export interface UseDatasetExportResult {
  status: DatasetExportStatus
  rowCount: number | null
  columnCount: number | null
  error: string | null
  start: () => Promise<void>
  cancel: () => void
  download: () => Promise<void>
}

/**
 * DS-LAKE-021-T03. Owns start -> poll -> (on click) fresh-presign-and-open
 * for the Step 5 "Export CSV" control. `download` fetches a NEW URL on
 * every call rather than caching one from job completion — presigned URLs
 * expire, so a link minted at job-ready time could be stale by the time
 * the user actually clicks Download.
 */
export function useDatasetExport(
  datasetId: string | null,
): UseDatasetExportResult {
  const [status, setStatus] = useState<DatasetExportStatus>('idle')
  const [rowCount, setRowCount] = useState<number | null>(null)
  const [columnCount, setColumnCount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [artifactId, setArtifactId] = useState<string | null>(null)
  const cancelledRef = useRef(false)

  const start = useCallback(async () => {
    if (!datasetId) return
    cancelledRef.current = false
    setStatus('running')
    setError(null)
    try {
      const started = await datasetVersionService.startExport(datasetId)
      const terminal = await pollDatasetJobUntilTerminal(
        datasetId,
        started.data.jobId,
        () => cancelledRef.current,
      )
      if (!terminal) return // cancelled
      if (terminal.status === 'SUCCEEDED') {
        setArtifactId(terminal.resultArtifactId ?? null)
        setRowCount(terminal.rowCount ?? null)
        setColumnCount(terminal.columnCount ?? null)
        setStatus('ready')
      } else {
        setStatus('error')
        setError(terminal.error ?? 'Export failed.')
      }
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Could not start export.')
    }
  }, [datasetId])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    setStatus('idle')
  }, [])

  const download = useCallback(async () => {
    if (!datasetId || !artifactId) return
    const res = await datasetVersionService.exportDownload(
      datasetId,
      artifactId,
    )
    window.open(res.data.downloadUrl, '_blank', 'noreferrer')
  }, [datasetId, artifactId])

  return { status, rowCount, columnCount, error, start, cancel, download }
}
```

**Note for the implementer:** the test's mocked `job()` response includes `rowCount`/`columnCount`/`error` fields on the terminal job row — confirm the real `PreprocessingJob` response type (`grep -n "interface.*PreprocessingJob\b" apps/client/services/dataset-version.ts`) actually carries these, or whether row/column counts need to come from a separate call (e.g. reading the new `DatasetArtifact{type: EXPORT}` row directly). If the job response doesn't carry them, add a call to whatever existing artifact-metadata fetch this codebase already has (do not invent a new endpoint) inside the `terminal.status === 'SUCCEEDED'` branch instead, and update the test's mock accordingly.

- [ ] **Step 3: Run the tests again**

Run: `pnpm --filter client exec vitest run hooks/dataset/use-dataset-export.test.ts`
Expected: PASS, all four tests.

### Step 4: Wire the Step 5 UI control

Open `apps/client/app/(default)/data-studio/create/components/step-5-review-save.tsx`. Find where the dataset's id becomes available after save (`grep -n "savedDatasetId\|dataset.id\|createDataset\|response.data.id" apps/client/app/(default)/data-studio/create/components/step-5-review-save.tsx` to locate the right variable name) and add, in the post-save success section of the JSX:

```tsx
const exportHook = useDatasetExport(savedDatasetId)
```

(Replace `savedDatasetId` with whatever the actual local variable holding the newly-created/edited dataset's id is called — Step 4's grep above finds it.)

```tsx
{
  savedDatasetId && (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <p className="text-sm font-medium">Export as CSV</p>
      {exportHook.status === 'idle' && (
        <>
          <p className="text-xs text-muted-foreground">
            {rowCount} rows, {columnCount} columns. Status columns are not
            included — a Bad reading exports as a blank cell.
          </p>
          <Button onClick={() => void exportHook.start()}>Export CSV</Button>
        </>
      )}
      {exportHook.status === 'running' && (
        <p className="text-xs text-muted-foreground">Exporting…</p>
      )}
      {exportHook.status === 'ready' && (
        <>
          <p className="text-xs text-muted-foreground">
            {exportHook.rowCount} rows, {exportHook.columnCount} columns.
          </p>
          <Button onClick={() => void exportHook.download()}>Download</Button>
        </>
      )}
      {exportHook.status === 'error' && (
        <p className="text-xs text-destructive">{exportHook.error}</p>
      )}
    </div>
  )
}
```

Add the import at the top of the file:

```tsx
import { useDatasetExport } from '@/hooks/dataset/use-dataset-export'
```

**Note for the implementer:** the `rowCount`/`columnCount` shown in the `idle` state (before export starts) should come from whatever the page already knows about the saved dataset's FINAL artifact stats — check what `step-5-review-save.tsx` already renders elsewhere on the page for row/column counts (`grep -n "rowCount\|columnCount" apps/client/app/(default)/data-studio/create/components/step-5-review-save.tsx`) and reuse that same source rather than adding a new fetch.

- [ ] **Step 4: Full client test suite for touched areas + typecheck**

Run: `pnpm --filter client exec vitest run hooks/dataset/use-dataset-export.test.ts lib/poll-preprocessing-job.test.ts app/'(default)'/data-studio/create/components/__tests__/step-5-review-save.test.tsx` (adjust the step-5 test path if Task-earlier findings located it elsewhere)
Expected: PASS.

Run: `pnpm --filter client exec tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/client/services/dataset-version.ts apps/client/hooks/dataset/use-dataset-export.ts apps/client/hooks/dataset/use-dataset-export.test.ts apps/client/app/'(default)'/data-studio/create/components/step-5-review-save.tsx
git commit -m "feat(client): Export CSV control on Step 5

DS-LAKE-021-T03. useDatasetExport owns start -> poll ->
fresh-presign-on-click; the download link is never cached from
job-completion time since presigned URLs expire."
```

---

## Task 8: Update the feature ledger and end-to-end verification

**Files:**

- Modify: `feature_list.preprocessing.json`

**Interfaces:**

- Consumes: nothing (documentation-only task).
- Produces: nothing later depends on.

- [ ] **Step 1: Mark each task and the overall entry complete**

In `feature_list.preprocessing.json`, find the `DS-LAKE-021` entry (`grep -n '"id": "DS-LAKE-021"' feature_list.preprocessing.json`). Update:

- `tasks[0]` (`DS-LAKE-021-T01`) → `"status": "completed", "progress": 100`
- `tasks[1]` (`DS-LAKE-021-T02`) → `"status": "completed", "progress": 100`
- `tasks[2]` (`DS-LAKE-021-T03`) → `"status": "completed", "progress": 100`
- `tasks[3]` (`DS-LAKE-021-T04`) → `"status": "completed", "progress": 100` (Task 5 of this plan covers this — confirming the existing reclaim sweep handles EXPORT)
- Top-level `"progress": 0` → `"progress": 100`
- Top-level `"status": "in_progress"` (set at plan start) → `"status": "completed"`

Update each `verification[]` entry's `"status": "pending"` → `"status": "completed"` for V01–V04 (their concrete test mappings are already implemented: V01/V02/V03 by Task 2's Python tests, V04 by confirming exported row_count equals FINAL's rowCount — add one explicit assertion for this in Task 3's or Task 4's test suite if not already covered by an existing test's `row_count` assertion; check before marking V04 complete).

- [ ] **Step 2: End-to-end manual verification**

With `apps/backend`, `apps/python`, and `apps/client` dev servers running (`pnpm dev` from repo root, or each app's own dev command):

1. In the browser, complete the Data Studio wizard for a dataset with at least one Bad-status cell, through Step 5, and save it.
2. On the post-save Step 5 screen, click "Export CSV".
3. Confirm the button shows "Exporting…" then transitions to "Download" with a row/column count.
4. Click "Download", confirm a CSV downloads.
5. Open the CSV: confirm no `__status` columns, confirm the known Bad cell is a blank field not `0`.
6. Re-open the same dataset's Step 5 and export again — confirm it succeeds a second time (tests the `overwrite: True` re-export path) and the download link still works.

- [ ] **Step 3: Full monorepo verification**

Run: `pnpm --filter backend exec jest`
Run: `pnpm --filter client exec vitest run`
Run: `cd apps/python && python -m pytest tests/`
Run: `pnpm --filter backend exec tsc --noEmit -p tsconfig.json && pnpm --filter client exec tsc --noEmit -p tsconfig.json`

Expected: all green. Pre-existing unrelated failures (if any are already known/tracked elsewhere in this repo) are acceptable; anything newly red must be fixed before proceeding.

- [ ] **Step 4: Commit**

```bash
git add feature_list.preprocessing.json
git commit -m "docs: mark DS-LAKE-021 completed — CSV export shipped

All four tasks (T01-T04) and verification items (V01-V04) done. See
docs/superpowers/plans/2026-08-24-ds-lake-021-csv-export.md for the
full implementation record."
```

---

## Self-Review Notes

**Spec coverage:** Every section of the design spec maps to a task — Decisions table → Global Constraints + Tasks 2/3/4; delivery finding → Task 4; poller finding → Task 6; architecture diagram → Tasks 2-4 in sequence; error handling → Task 3 (readExportRequest) and Task 4 (404 guards); testing (V01-V04) → Task 2 (V01-V03), Task 8 Step 1 (V04 cross-check); scope boundaries → explicitly not built anywhere in this plan (no stage picker, no holdout toggle, no new Python presign route, no new TTL subsystem).

**Placeholder scan:** No task says "add appropriate error handling" or "similar to Task N" without code. Every step with code shows the actual code. Two "Note for the implementer" callouts exist (Task 2 Step 4's `get_object_bytes`/`put_object_bytes` factoring, Task 7 Step 3's row/column-count source) because they depend on exact current-file shapes this plan's author could not fully verify without executing code — each names the exact fallback decision to make and why, rather than leaving it open-ended.

**Type consistency:** `ExportStatsResponse` (Python, Task 2) → `ExportStatsSchema` (NestJS zod mirror, Task 3) → the `stats` object built from it inside `run()`'s EXPORT branch (Task 3) → `DatasetArtifact` fields committed by the existing shared `commit()` method (Task 3, widened `artifactType` union) → `{ jobId }` / `{ downloadUrl, expiresAt }` (Task 4 service methods, matching Task 4's controller routes, matching Task 7's client service methods and hook) — verified as one continuous chain with consistent field names (`row_count`/`rowCount`, `object_key`/`objectKey`, etc., following this codebase's existing snake_case-Python/camelCase-TS convention throughout, same as `ArtifactStatsResponse`/`ArtifactStatsSchema`).
