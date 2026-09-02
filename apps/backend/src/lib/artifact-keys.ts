/**
 * Object-storage key layout, mirrored from
 * `apps/python/intergrations/object_store.py` (see its `key helpers` section).
 *
 * NestJS holds no S3 credentials and never touches an object, but it does
 * decide where every object goes — so it has to build the same strings Python
 * does. Before DS-LAKE-003 it rebuilt them inline in three places
 * (`dataset-version.authorized.service.ts` once, `preprocessing-job.service.ts`
 * twice), which meant a layout change had four independent chances to be
 * missed. Adding bronze/silver/gold/final would have multiplied that.
 *
 * These two files are a contract. Change them together.
 *
 *   {datasetId}/artifacts/{artifactId}/data.parquet              committed, IMMUTABLE
 *   {datasetId}/artifacts/{artifactId}/manifest.json             sidecar
 *   {datasetId}/artifacts/{artifactId}/feature_spec.json         GOLD only
 *   {datasetId}/artifacts/{artifactId}/validation_report.json    FINAL only
 *   {datasetId}/tmp/{jobId}/{n}.parquet                          intermediates
 *
 *   {datasetId}/{versionId}.parquet                              LEGACY, read-only
 *
 *   feature-presets/{workspaceId}/{importId}/{presetId}.json     imported preset
 *   feature-presets/{workspaceId}/{importId}/sdta.json           SD/TA cut config
 */

export const DATA_FILENAME = 'data.parquet';
export const MANIFEST_FILENAME = 'manifest.json';
export const FEATURE_SPEC_FILENAME = 'feature_spec.json';
export const VALIDATION_REPORT_FILENAME = 'validation_report.json';
/**
 * DS-LAKE-018-T03. The raw validation-holdout sidecar, beside a BRONZE's own
 * data key. Mirrored from `VALIDATE_DATA_FILENAME` in object_store.py —
 * change both.
 */
export const VALIDATE_DATA_FILENAME = 'validate_data.parquet';

/**
 * MODEL-FLOW-016-T08. The model-ready holdout `prepare_holdout_for_run`/
 * `replay_holdout_for_run` write under a run's own prefix
 * (`tryReplayHoldout`, model-run.authorized.service.ts) — a run-scoped
 * object, never a committed dataset artifact, so it is read via
 * `presignRunObject`, not `presignArtifact`. Mirrored from
 * `VALIDATE_READY_FILENAME` in object_store.py — change both.
 */
export const VALIDATE_READY_FILENAME = 'validate_ready.parquet';

/**
 * DS-LAKE-021-T01. The CSV export sidecar, beside a committed artifact's own
 * data key. Mirrored from `EXPORT_CSV_FILENAME` in object_store.py — change
 * both.
 */
export const EXPORT_CSV_FILENAME = 'export.csv';

/**
 * DS-LAKE-016: stage-suffixed data filenames, for diagnosability — telling a
 * BRONZE from a GOLD while browsing a MinIO console today requires a
 * Postgres round trip. No FINAL entry on purpose: it never gets a file of
 * its own — `promoteDraftArtifactToFinalService` copies `objectKey` from its
 * source verbatim (DS-LAKE-012-V03 proved live that GOLD and FINAL share one
 * checksum, "promotion by pointer, not byte-copy"), and
 * `global_definition_of_done` forbids copying bytes at promotion outright.
 * Mirrored from `DATA_FILENAME_BY_TYPE` in object_store.py — change both.
 *
 * DS-LAKE-021-T04: EXPORT gets its OWN entry (unlike FINAL) — an export is
 * a real, independently-reclaimable object, not a promoted pointer. Reuses
 * `EXPORT_CSV_FILENAME` rather than a second string literal for the same
 * name.
 */
export const DATA_FILENAME_BY_TYPE: Record<
  'BRONZE' | 'SILVER' | 'GOLD' | 'EXPORT',
  string
> = {
  BRONZE: 'data_bronze.parquet',
  SILVER: 'data_silver.parquet',
  GOLD: 'data_gold.parquet',
  EXPORT: EXPORT_CSV_FILENAME,
};

/**
 * Root prefix for imported soft-sensor feature presets.
 *
 * A prefix inside the existing bucket rather than a bucket of its own:
 * `ensure_bucket()` has no runtime caller in the Python service, so a second
 * bucket would need new bootstrap while a prefix needs none.
 */
export const PRESET_ROOT = 'feature-presets/';
export const SDTA_FILENAME = 'sdta.json';

export const RUN_UPLOAD_FILENAMES = [
  'model.joblib',
  'metrics.json',
  'run_manifest.json',
  'predictions.parquet',
  // MODEL-FLOW-013-T05. Only present for the algorithms train.py can
  // extract a real loss trajectory from — absent, not empty, for a
  // closed-form fit. Mirrored from LOSS_HISTORY_FILENAME in
  // object_store.py — change both.
  'loss_history.json',
  // MODEL-FLOW-016-T04. Per-fold CV metrics — present only on a CV run.
  // Mirrored from CV_FOLDS_FILENAME in object_store.py and train.py —
  // change all three.
  'cv_folds.json',
] as const;

/**
 * DS-LAKE-016. Every accepted data filename, legacy `data.parquet` included —
 * the FULL set `splitDataKey` recognises. Mirrored from `ALL_DATA_FILENAMES`
 * in object_store.py — change both. Only ever WIDENS: a committed object is
 * immutable and pre-existing objects can never be renamed, so old spellings
 * must keep resolving forever, not be replaced.
 */
export const ALL_DATA_FILENAMES: readonly string[] = [
  DATA_FILENAME,
  ...Object.values(DATA_FILENAME_BY_TYPE),
];

export function artifactPrefix(datasetId: string, artifactId: string): string {
  return `${datasetId}/artifacts/${artifactId}/`;
}

/**
 * DS-LAKE-018/MODEL-FLOW-010-T06 fix. Mirrored from `split_data_key` in
 * object_store.py — change both. Returns `[prefix, dataFilename]` (`prefix`
 * is everything up to and including the trailing `/`) if `key` ends in any
 * accepted data filename, else `null`.
 */
export function splitDataKey(key: string): [string, string] | null {
  for (const filename of ALL_DATA_FILENAMES) {
    const suffix = `/${filename}`;
    if (key.endsWith(suffix)) {
      return [key.slice(0, -filename.length), filename];
    }
  }
  return null;
}

/**
 * DS-LAKE-018/MODEL-FLOW-010-T06 fix. Sidecar beside an ARBITRARY data key —
 * mirrored from `sidecar_key` in object_store.py — change both.
 *
 * Needed because the caller is handed a stored `objectKey` and does not
 * always know the dataset/artifact ids that produced it (a draft-scoped
 * artifact's `objectKey` starts with `drafts/{draftId}/…`, not a real
 * `datasetId` — rebuilding the prefix from `datasetId` instead of reading
 * `objectKey` is exactly the bug this function exists to stop reintroducing:
 * a validate_data.parquet written beside a draft-scoped BRONZE was
 * unreachable at read time via `validateDataKey(datasetId, bronze.id)`).
 * Falls back to appending a suffix when the key is not in the artifact
 * layout, so a legacy or tmp key still gets a sidecar instead of silently
 * getting none.
 */
export function sidecarKey(dataKey: string, filename: string): string {
  const split = splitDataKey(dataKey);
  if (split !== null) {
    const [prefix] = split;
    return `${prefix}${filename}`;
  }
  return `${dataKey}.${filename}`;
}

/**
 * `artifactType` is OPTIONAL and trailing (DS-LAKE-016-T03) so every
 * existing caller keeps compiling and keeps producing the legacy
 * `data.parquet` name until explicitly updated to pass one — mirrors
 * `artifact_key`'s own widening in object_store.py exactly. Omitted/FINAL
 * both fall back to the legacy name (FINAL has no entry in
 * `DATA_FILENAME_BY_TYPE` — see that constant's own doc comment).
 */
export function artifactKey(
  datasetId: string,
  artifactId: string,
  artifactType?: 'BRONZE' | 'SILVER' | 'GOLD' | 'EXPORT',
): string {
  const filename = artifactType
    ? DATA_FILENAME_BY_TYPE[artifactType]
    : DATA_FILENAME;
  return `${artifactPrefix(datasetId, artifactId)}${filename}`;
}

/**
 * DS-LAKE-022-T03. The value written to `DatasetArtifact.pipelineVersion` by
 * a stage that ran the REORDERED pipeline (features -> clean -> scale).
 *
 * There is deliberately no `PIPELINE_VERSION_LEGACY` counterpart: the legacy
 * order writes NULL, which is the same value every artifact created before
 * this column existed already carries. Those two really are the same claim —
 * "this came out of the pre-reorder order" — and inventing a `1` would split
 * one meaning across two values, forcing every future reader to check for
 * both.
 *
 * Lives here, beside `artifactKey`, because the stage decision and the object
 * key are made together at both write sites and must never disagree: a row
 * typed GOLD whose key says silver, or a pipelineVersion 2 on a legacy-order
 * artifact, are the exact unmarked lies DS-LAKE-016's stage-suffixed
 * filenames and this column respectively exist to prevent.
 */
export const PIPELINE_VERSION_REORDERED = 2;

export function manifestKey(datasetId: string, artifactId: string): string {
  return `${artifactPrefix(datasetId, artifactId)}${MANIFEST_FILENAME}`;
}

export function featureSpecKey(datasetId: string, artifactId: string): string {
  return `${artifactPrefix(datasetId, artifactId)}${FEATURE_SPEC_FILENAME}`;
}

export function validationKey(datasetId: string, artifactId: string): string {
  return `${artifactPrefix(datasetId, artifactId)}${VALIDATION_REPORT_FILENAME}`;
}

/**
 * DS-LAKE-018-T03.
 *
 * @deprecated Rebuilds the prefix from `datasetId`, which is wrong for a
 * draft-scoped artifact — its `validate_data.parquet` was written beside
 * `objectKey` (e.g. `drafts/{draftId}/artifacts/{artifactId}/…`), not beside
 * `{datasetId}/artifacts/{artifactId}/…`. Both former call sites now use
 * `sidecarKey(bronze.objectKey, VALIDATE_DATA_FILENAME)` instead. Kept only
 * for any caller not yet migrated — do not add new callers.
 */
export function validateDataKey(datasetId: string, artifactId: string): string {
  return `${artifactPrefix(datasetId, artifactId)}${VALIDATE_DATA_FILENAME}`;
}

/**
 * LEGACY layout. Read-only: artifacts written before DS-LAKE-003 live here and
 * are immutable, so they cannot be moved. Nothing writes this shape any more.
 */
export function versionKey(datasetId: string, versionId: string): string {
  return `${datasetId}/${versionId}.parquet`;
}

/**
 * Where one workbook import's documents live.
 *
 * Presets are workspace-scoped rather than dataset-scoped: a preset is imported
 * before any dataset exists and is reused across many of them, so it cannot
 * hang off a dataset id like every key above. The import id groups one upload,
 * which is what makes a re-upload a NEW set of documents rather than an
 * overwrite of the previous one.
 *
 * The trailing slash is load-bearing on the Python side, which refuses a prefix
 * without one — `ws-1` would otherwise match `ws-10`.
 */
export function presetImportPrefix(
  workspaceId: string,
  importId: string,
): string {
  return `${PRESET_ROOT}${workspaceId}/${importId}/`;
}

export function presetKey(prefix: string, presetId: string): string {
  return `${prefix}${presetId}.json`;
}

export function sdtaKey(prefix: string): string {
  return `${prefix}${SDTA_FILENAME}`;
}

export function tmpKey(datasetId: string, jobId: string, step: number): string {
  return `${datasetId}/tmp/${jobId}/${step}.parquet`;
}

export function tmpPrefix(datasetId: string, jobId: string): string {
  return `${datasetId}/tmp/${jobId}/`;
}

export const MODEL_ROOT = 'models/';
/**
 * A run started from the wizard has no modelId yet — Save Model has not
 * happened (MODEL-FLOW-003-T08). Its outputs write here instead, under the
 * ModelDraft that owns it, and Save Model adopts them by pointer rather than
 * copying bytes (see decisions.artifact_scope in docs/feature_list.json).
 */
export const DRAFT_ROOT = 'drafts/';

export function modelRunPrefix(modelId: string, runId: string): string {
  return `${MODEL_ROOT}${modelId}/runs/${runId}/`;
}

export function modelRunKey(
  modelId: string,
  runId: string,
  filename: string,
): string {
  return `${modelRunPrefix(modelId, runId)}${filename}`;
}

export function draftRunPrefix(draftId: string, runId: string): string {
  return `${DRAFT_ROOT}${draftId}/runs/${runId}/`;
}

export function draftRunKey(
  draftId: string,
  runId: string,
  filename: string,
): string {
  return `${draftRunPrefix(draftId, runId)}${filename}`;
}
