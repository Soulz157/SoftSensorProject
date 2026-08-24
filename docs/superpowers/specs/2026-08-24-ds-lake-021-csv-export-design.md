# DS-LAKE-021 — CSV export of the saved dataset at Step 5

## Context

`feature_list.preprocessing.json`'s DS-LAKE-021 entry ("CSV export of the saved dataset
at Step 5") has four tasks (T01–T04), all `pending`/progress 0, and four explicit
`openDecisions` each carrying a stated-but-unadopted recommendation. Dependencies
DS-LAKE-009 and DS-LAKE-016 are both `completed`, so the feature is unblocked.

No export path exists anywhere today. `/rows` is capped at 50,000 by an unconditional
zod ceiling enforced ahead of any controller body (DS-LAKE-005B-A-V01); `/preview` at 200. Neither can produce a full export, and accumulating pages client-side is forbidden
by `frontend_data_contract` — the exact defect DS-LAKE-012 already fixed once
(76MB → 489KB). Export is the first read path in this codebase whose whole point is to
be unbounded, so it needs its own mechanism, not a widened limit.

## Decisions (user-confirmed)

| Open decision     | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status columns    | Drop `__status` sidecar columns entirely. A cell whose status is `Bad` exports as an **empty field** (CSV's conventional NULL) rather than the numeric `0.0` `frame_service.MISSING_VALUE` actually stores — an empty CSV field is universally read as absent, `0.0` is indistinguishable from a real zero reading. `Questionable` stays numeric: it is a real, flagged reading, not a hole.                                                                                                                            |
| Exportable stage  | **FINAL only.** Matches "export the saved dataset" — the one artifact Step 5 represents. No stage picker in the UI. FINAL's bytes are retention-safe (Save Dataset pins them); SILVER/GOLD are not, and offering them risks a 404 at click time against an already-reclaimed object.                                                                                                                                                                                                                                    |
| Holdout rows      | **Omitted, silently correct — not a UI caveat.** `validate_data.parquet`'s rows were already cut from `data.parquet` at BRONZE-split time (DS-LAKE-018-T03); FINAL never contained them. There is nothing to explicitly exclude at export time, so no disclaimer is needed either — the exported row count already equals FINAL's own `rowCount` by construction. (V04 below still asserts this equality, but as a confirmation of existing behavior, not a new exclusion the export step performs.)                    |
| Reclaim lifecycle | **New `DatasetArtifactType.EXPORT`.** The row rides the existing DS-LAKE-014 sweep for free — its `WHERE type: { not: 'FINAL' }, objectReclaimedAt: null` candidate query already matches EXPORT with zero new sweep code. Verified: the sweep's "still referenced by an ACTIVE FINAL" parent-chain walk only traverses _backward_ from a FINAL row; an EXPORT row whose `parentArtifactId` points _at_ a FINAL is never itself visited by that walk, so it stays independently reclaim-eligible on its own idle timer. |

## Two findings that change the plan's own scope notes

1. **Python-side delivery needs zero new routes — but a new NestJS route is still
   required, because nothing today hands a presigned URL to the browser.** T03's scope
   note says "reuse `presignArtifact`", and that holds on the Python side: its guard
   (`is_committed_artifact_key`, `object_store.py:958`) rejects any key that isn't a
   committed artifact's own `data.parquet`-shaped object — a raw `source_key: <export
key>` call would 422 — but its **sidecar** mechanism does not go through that guard:
   `presignArtifact({ source_key: final.objectKey, sidecars: ['export.csv'] })`
   presigns `sidecar_key(final.objectKey, 'export.csv')` unconditionally
   (`artifact_service.py:949-954`), exactly the shape the export object is written
   under. What's new is the NestJS side: `presignArtifact` (the TS function) is
   internal-only today — every caller is server-to-server — so a small new
   browser-facing route is still needed to expose the result. See Architecture below.

2. **The job poller is draft-only today, and export runs against a saved dataset.**
   `pollDraftJobUntilTerminal` (`apps/client/lib/poll-preprocessing-job.ts`) is hardcoded
   to `datasetDraftService.job(draftId, jobId)`. Its own doc comment already argues for
   exactly one shared poll loop rather than each caller hand-rolling its own (that is why
   `useDatasetGoldWarm` and `useDatasetDraftPipeline` both call it instead of writing
   their own). A third, saved-dataset-scoped fork would violate that same reasoning, so
   this design **generalizes the existing function** to take a fetch callback instead of
   forking it — a small, targeted fix to code this feature already depends on, not
   unrelated refactoring.

## Architecture

```
Step 5 "Export CSV" button
  │
  ▼
POST /api/v1/authorized/dataset/:id/export        (dataset-version.authorized.controller.ts)
  │  creates PreprocessingJob{ stage: 'EXPORT', sourceArtifactId: FINAL.id }
  │  returns 202 + { jobId }
  ▼
Client polls GET /:id/jobs/:jobId                  (generalized pollJobUntilTerminal)
  │
  ▼
PreprocessingJobService.run()                       job.stage === 'EXPORT' branch
  │  readExportRequest(job.operations) — refuses a wrong shape by name, mirrors
  │  readOperations/readFeatureRecipe's existing discipline
  ▼
POST /v1/preprocess/export                          (Python, new router entry)
  │  export_service.export_artifact_csv(store, final_object_key)
  │  streams FINAL's parquet row-group by row-group (RecordingStore-provable,
  │  no full-frame materialization — same discipline as validate/materialize)
  │  writes sidecar_key(final_object_key, EXPORT_CSV_FILENAME)
  │  returns { object_key, row_count, column_count, size_bytes, checksum }
  ▼
Job succeeds → NestJS creates DatasetArtifact{
  type: 'EXPORT', format: 'csv', runId: <FINAL's runId>,
  parentArtifactId: FINAL.id, objectKey, checksum, rowCount, columnCount, sizeBytes,
} as job.resultArtifactId
  ▼
Client sees the terminal job, reads job.resultArtifactId, then calls
GET /:id/export/:artifactId/download                (new, browser-facing)
  │  NestJS calls presignArtifact({ source_key: final.objectKey,
  │  sidecars: ['export.csv'] }) FRESH on every call — presigned URLs expire
  │  (model-run's own claim() carries the same expiresAt handling), so this
  │  is a live call, never a value cached from the job's terminal payload
  ▼
{ downloadUrl, expiresAt } → download link
```

**No existing route returns a presigned URL to the browser at all.** `presignArtifact`
(`apps/backend/src/lib/python-preprocess-client.ts`) is a NestJS-internal function that
calls Python; every current caller is server-to-server (e.g. `claim()` embeds `dataUrl`
in its response to the _training container_, not the browser). This is genuinely new
surface, not a reuse — the smallest version of it.

### New Prisma migration

- `DatasetArtifactType` gains `EXPORT`.
- `DatasetVersionStage` gains `EXPORT` (mirrors the existing `FEATURE` addition —
  `PreprocessingJob.stage` reuses this enum).

Both are additive (`ALTER TYPE ... ADD VALUE`); no existing row changes shape.

### Python: `apps/python/services/export_service.py` (new)

- `EXPORT_CSV_FILENAME = "export.csv"` in `object_store.py`, mirrored in
  `apps/backend/src/lib/artifact-keys.ts` as `EXPORT_CSV_FILENAME` — same
  "these two files are a contract, change together" discipline as
  `VALIDATE_DATA_FILENAME`.
- `export_artifact_csv(store, request) -> ExportStatsResponse`:
  - Reads FINAL's `data.parquet` in row-group batches via the same duckdb/pyarrow
    reader `validate_service`/`materialize` already use — never
    `store.get_frame(...)` in full.
  - Drops every `__status` column from the output header.
  - Per batch: any cell whose paired `__status` is `Bad` (status code from
    `STATUS_BAD` in `object_store.py`) is written as an empty CSV field instead of
    its stored value; `Questionable` and `Good` cells write their numeric value
    unchanged.
  - Writes the batches to `sidecar_key(final_key, EXPORT_CSV_FILENAME)` via
    `store.put_frame`/streaming writer, `overwrite=True` (an export re-run replaces
    the prior file, unlike a committed `data.parquet`).
  - Returns row count, column count (post-drop, i.e. tag count, not `2N+1`), size in
    bytes, and `store.checksum_of(export_key)`.
- New pydantic schemas in `apps/python/schemas/preprocess.py`: `ExportRequest
{ source_key: str }`, `ExportStatsResponse { object_key, row_count, column_count,
size_bytes, checksum }` — same shape convention every other artifact-stats response
  already uses.
- New router entry in `apps/python/routers/preprocess.py`: `POST /v1/preprocess/export`,
  wrapped by the same `run_bounded`/`ObjectStoreError`→422 handling every other
  preprocess route already goes through (`routers/preprocess.py:110-140`).

### NestJS

- `apps/backend/src/api/v1/dataset-version/authorized/dataset-version.authorized.service.ts`:
  - `startExportService(user, datasetId)` — resolves the dataset's FINAL artifact. The
    dataset's own `currentArtifactId` is stage-polymorphic (per its existing doc
    comment) and is FINAL specifically once the dataset is fully saved — this method
    must assert `type === 'FINAL'` explicitly and reject otherwise (a dataset mid-save
    or missing its FINAL commit must not silently start an export against the wrong
    stage). Creates the `PreprocessingJob{ stage: 'EXPORT', sourceArtifactId: FINAL.id,
operations: { kind: 'export' } }` row, returns `{ jobId }`.
  - `preprocessing-job.service.ts`'s `run()` gains the `job.stage === 'EXPORT'` branch:
    calls Python's `/v1/preprocess/export`, and on success creates the
    `DatasetArtifact{ type: 'EXPORT', ... }` row and sets `job.resultArtifactId`,
    mirroring exactly how the CLEAN/FEATURE branches commit their own result artifact
    today.
  - `readExportRequest(raw: Json)` — a third reader beside `readOperations`/
    `readFeatureRecipe`, refusing (throwing) on any shape but `{ kind: 'export' }`,
    never called for a CLEAN or FEATURE job (same "never called for a CLEAN job"
    discipline `readFeatureRecipe`'s own doc comment already states for itself).
  - `getExportDownloadService(user, datasetId, artifactId)` (new) — verifies the
    artifact belongs to this dataset and is `type === 'EXPORT'`, resolves its parent
    FINAL's `objectKey`, calls `presignArtifact({ source_key: final.objectKey,
sidecars: ['export.csv'] })` fresh, returns `{ downloadUrl, expiresAt }`. This is
    the first NestJS method that hands a presigned URL to the browser — every existing
    `presignArtifact` caller is server-to-server.
- `dataset-version.authorized.controller.ts`:
  - `POST /:id/export` → `startExportService`, `202 { jobId }`, documented the same way
    as the existing `/:id/versions/:versionId/clean` route (`summary: 'Start an export
job (202 + jobId)'`).
  - `GET /:id/export/:artifactId/download` (new) → `getExportDownloadService`.
- Reuses the existing `GET /:id/jobs/:jobId` route unchanged for polling — no new
  status endpoint.

### Client

- `apps/client/lib/poll-preprocessing-job.ts`: generalize
  `pollDraftJobUntilTerminal(draftId, jobId, isCancelled)` into
  `pollJobUntilTerminal(fetchJob: () => Promise<{data: {status, ...}}>, isCancelled)`,
  with `pollDraftJobUntilTerminal` becoming a one-line wrapper
  (`() => pollJobUntilTerminal(() => datasetDraftService.job(draftId, jobId),
isCancelled)`) so both existing callers (`useDatasetGoldWarm`,
  `useDatasetDraftPipeline`) keep compiling unchanged. A new
  `pollDatasetJobUntilTerminal(datasetId, jobId, isCancelled)` wraps the same core
  against `datasetVersionService.job(datasetId, jobId)` (an existing service method
  the `/:id/jobs/:jobId` route already backs).
- `apps/client/services/dataset-version.ts`: two new methods —
  `startExport(datasetId)` → `POST /:id/export`, returning `{ jobId }`; and
  `exportDownload(datasetId, artifactId)` → `GET /:id/export/:artifactId/download`,
  returning `{ downloadUrl, expiresAt }`. Both are genuinely new client calls — there is
  no existing browser-facing presign call to reuse (see the delivery finding above).
- New hook `apps/client/hooks/dataset/use-dataset-export.ts`: owns
  start → poll → (on user's Download click) `exportDownload`, exposing
  `{ status: 'idle'|'running'|'ready'|'error', rowCount, columnCount, error, start,
cancel, download }` — `download` is a function the UI calls at click time, not a
  cached URL, so the fetched link is always fresh against the presign's expiry. Same
  action-hook shape discipline `useDatasetHoldoutResplit`/`useDatasetGoldWarm` already
  establish for a job-backed async action.
- `step-5-review-save.tsx`: new "Export CSV" control. Before the click it states the
  row count and column count (both already known from the dataset's own FINAL artifact
  stats, no extra fetch) — the "2N+1 columns" risk from the ledger's own findings does
  not apply here because status columns are dropped, so the shown column count is just
  the dataset's tag count. Once the job is ready, a "Download" button calls
  `hook.download()`, which fetches a fresh `downloadUrl` and opens it
  (`window.open(downloadUrl, '_blank', 'noreferrer')`) — not a pre-rendered `<a href>`,
  since the URL must be minted at click time, not at job-completion time.

## Error handling

- A Python-side `ObjectStoreError`/`ValueError` during export maps to the job's
  existing `FAILED` status + `error` message path — no new error surface, same as
  CLEAN/FEATURE.
- `readExportRequest` throwing on a wrong shape is a genuine bug-catcher (a CLEAN job
  whose `operations` accidentally reaches the EXPORT branch must fail loudly, not
  silently export nothing and report success) — mirrors the exact trap
  `readOperations`'s own doc comment names for its sibling.
- A re-run of export on the same FINAL overwrites the prior `export.csv` (`overwrite:
True`) rather than accumulating stale objects — there is only ever one export object
  per FINAL, addressed by its deterministic `sidecar_key`.

## Testing (ledger's own acceptance criteria, mapped to concrete tests)

- **V01** — Python: export a fixture artifact containing at least one `Bad`-status cell;
  assert the corresponding CSV field is empty, not `"0.0"`. An all-Good fixture cannot
  distinguish correct from wrong, so the fixture must contain a real Bad cell.
- **V02** — Python: export a synthetic multi-row-group artifact; assert `peak_rss_kb`
  (already logged on `_run`, DS-LAKE-005B-C-T07) does not scale with row count between a
  small and a large fixture.
- **V03** — Python: `RecordingStore`-backed test (DS-LAKE-007-V02's own pattern) asserting
  `store.writes` contains only the new export key, and the FINAL artifact's checksum is
  re-read afterward and unchanged.
- **V04** — Backend: export a dataset whose BRONZE was split with a holdout; assert the
  exported `row_count` equals the FINAL artifact's own `rowCount` — confirming the
  holdout rows were never present to begin with, not merely "not re-added".
- Backend: `readExportRequest` unit tests mirroring `readOperations`/
  `readFeatureRecipe`'s existing spec shape (refuses a CLEAN-shaped payload, refuses a
  FEATURE-shaped payload, accepts only `{ kind: 'export' }`).
- Client: `pollJobUntilTerminal` extraction covered by the same test file
  `pollDraftJobUntilTerminal` already has today, plus one new test for the
  dataset-scoped wrapper.
- Reclaim: extend the existing `artifact-cleanup.admin.service.spec.ts` coverage with an
  EXPORT-typed candidate, asserting it is swept exactly like any other non-FINAL type —
  no new sweep logic to test, only that the type widening didn't silently exempt it.

## Scope boundaries (explicitly not in this feature)

- No stage picker (FINAL only, per the resolved decision).
- No holdout-inclusion option (holdout rows are structurally absent from FINAL; nothing
  to toggle).
- No new Python presign route (existing `sidecars` mechanism covers the object key
  shape) — the one new route is NestJS's own `GET .../export/:artifactId/download`,
  which is a thin browser-facing wrapper around that existing Python call, not a new
  Python-side capability.
- No new generic TTL/cron subsystem (EXPORT rides the existing DatasetArtifact sweep).
