# MIRRORS

This container image has **no import path** back to `apps/python` or to the
TypeScript API. Four things are therefore duplicated on purpose. Splitting
`train.py` into modules scattered those duplicates across several files, so this
is the index: **if you change anything listed here, change every copy listed
beside it.**

Nothing in this file is a new decision. Each entry restates a "change all three"
note that already existed in the single-file `train.py`.

---

## 1. `labelled_mask`

| Copy        | Location                                            |
| ----------- | --------------------------------------------------- |
| this image  | `labels.py`                                         |
| apps/python | `services/split_stats_service.py` (same mask logic) |

The non-Good-target mask. DS-LAKE-023-T03/D4. Both copies must agree on the
fallback behaviour when the `__status` column is absent, or a train/test score
and a holdout score computed on either side of the boundary stop being
comparable.

---

## 2. `MIN_LABELS_PER_FOLD = 10`

| Copy        | Location                          |
| ----------- | --------------------------------- |
| this image  | `splits.py`                       |
| apps/python | `services/split_stats_service.py` |

MODEL-FLOW-016-T02/T03. The **number** must match; the measured table
deliberately lives in `split_stats_service.py` ONLY, so the two copies cannot
drift on the table while agreeing on the number.

Pinned identically by `test_split_stats_service.py` and by this package's
`test_splits.py`.

---

## 3. `expanding_fold_plan`

| Copy        | Location                                                |
| ----------- | ------------------------------------------------------- |
| this image  | `splits.py`                                             |
| apps/python | `services/split_stats_service.py::_expanding_fold_plan` |

MODEL-FLOW-016-T03. `TimeSeriesSplit(n_splits=k)`'s cut arithmetic, verified
index-for-index against a real `TimeSeriesSplit`. V01 pins the two against each
other's actual **output** — not just the algorithm — by asserting this
function's result equals a real `/split-stats` call's fold plan for the same
artifact and `k`.

---

## 4. `CV_FOLDS_FILENAME = "cv_folds.json"`

| Copy        | Location                                |
| ----------- | --------------------------------------- |
| this image  | `artifacts.py`                          |
| apps/python | `object_store.py` (`CV_FOLDS_FILENAME`) |
| API (TS)    | `artifact-keys.ts`                      |

MODEL-FLOW-016-T04. **Three** copies, not two. Miss one and the run writes an
artifact nothing reads, with no error anywhere.

---

## 5. `GPR_MAX_TRAIN_ROWS = 10_000`

| Copy        | Location                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------- |
| this image  | `models.py` (the authority — measured here)                                              |
| client (TS) | `app/(default)/models/create/components/pipeline/training-config/algorithm-selector.tsx` |

MODEL-FLOW-020-T06. The **number is measured in `models.py` and only echoed**
by the client; if it moves, it moves here first.

Unlike mirrors 1-4 the two copies do not do the same work: `build_model` raises
at fit time, while the selector disables Gaussian Process the moment it is
ticked, so the refusal costs no container spawn. Both nonetheless key on the
same quantity — `n_train_rows`, the post-split post-mask count, which reaches
the client as `/split-stats`' `train_labelled_rows`. A client copy keyed on an
artifact's raw `rowCount` would refuse datasets that actually fit.

Drift here is **quiet in the safe direction and loud in the wrong one**: raise
this constant in `models.py` alone and the selector keeps refusing datasets the
trainer would now accept — annoying, not incorrect. Lower it in `models.py`
alone and the selector offers a choice every run then dies on. The second case
is why this entry exists.

---

## 6. The naive wall-clock timestamp convention (NOT a duplicate yet — a trap)

| Copy        | Location                                                       |
| ----------- | -------------------------------------------------------------- |
| apps/python | `services/artifact_service.py::_wall_clock` (the only handler) |
| this image  | **none today** — see below                                     |

MODEL-FLOW-020-T03. Listed here despite having no second copy, because the
next person to add one will need it and the failure is silent.

Three layers disagree about how a timestamp is represented:
`DatasetArtifact.validationHoldoutFrom` is Postgres `timestamp WITHOUT time
zone`; the backend serialises it with JavaScript `toISOString()`, which
appends `Z`; and every parquet frame's own timestamp column is
`datetime64[us]`, tz-naive. Build a `pd.Timestamp` from the serialised value
and it is tz-AWARE, and pandas refuses to compare it against the naive
column — `TypeError: Invalid comparison between dtype=datetime64[us] and
Timestamp`.

**Why it is worth a warning rather than a bug report.** That TypeError was
swallowed by `tryReplayHoldout` and surfaced only as the generic run log
line `Holdout scoring skipped: Preprocessing failed`. An affected dataset
trained fine, reported test-split metrics fine, and silently never scored a
holdout at all — artifact `1ae5cc53` had 0 holdout scores across 5 runs
before the fix, with nothing in the UI to say why.

**This image has no instance today** because it splits on ROW POSITION
(`chronological_split`'s ratio, `expanding_fold_plan`'s fold indices), never
on a caller-supplied timestamp boundary — verified: no `pd.Timestamp`
comparison and no tz handling anywhere under `app/`. The moment a trainer
pipeline takes a boundary from the request and compares it to the frame,
this becomes a real mirror and needs `_wall_clock`'s exact semantics:
`tz_localize(None)`, which KEEPS the wall time, never `tz_convert`, which
would shift the boundary by the UTC offset and silently change which rows
are scored.

---

## 7. `FEATURE_IMPORTANCE_FILENAME = "feature_importance.json"`

| Copy        | Location                                                                                                               |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| this image  | `artifacts.py`                                                                                                         |
| apps/python | `object_store.py` (`FEATURE_IMPORTANCE_FILENAME`), also gates `_ALLOWED_RUN_UPLOADS` in `services/artifact_service.py` |
| API (TS)    | `artifact-keys.ts`                                                                                                     |

MODEL-FLOW-019-T09. Same "three copies, not two" shape as entry 4 — miss one
and the run either writes an artifact the container upload allowlist refuses
(silent upload failure) or writes one that nothing downstream can ever read
(silent absence).

---

## 8. `HOLDOUT_PREDICTIONS_FILENAME = "holdout_predictions.parquet"`

| Copy        | Location                                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| this image  | `artifacts.py`                                                                                                          |
| apps/python | `object_store.py` (`HOLDOUT_PREDICTIONS_FILENAME`), also gates `_ALLOWED_RUN_UPLOADS` in `services/artifact_service.py` |
| API (TS)    | `artifact-keys.ts` (`RUN_UPLOAD_FILENAMES`)                                                                             |

MODEL-FLOW-019-T20. Same "three copies, not two" shape as entries 4 and 7 —
miss one and the upload is refused outright, by name. Deliberately a
DIFFERENT filename from `PREDICTIONS_FILENAME`, not a third copy of it: a
non-CV run's `predictions.parquet` already holds its TEST split the moment
training finishes, and nothing may overwrite that object. `score.py`
picks the filename from `spec["isCvRun"]` (`scoreClaimService`'s own field) —
a CV run still writes `predictions.parquet` (it has no test split to lose),
a non-CV run writes this one.

MODEL-FLOW-019-T26 adds a SECOND WRITER, and this is the part a reader is
most likely to get wrong: a non-CV run now writes this file INLINE AT
TRAINING TIME too, from `pipelines/__init__.py`'s `_publish`, because
`_score_holdout_if_present` already computes the frame and used to discard
it. So score-mode is no longer the only path here — it is the only path for
a CV run, and the BACKFILL path for runs trained before T26 landed.

Both writers reach the same allow-list, by different routes, and BOTH must
admit the name: score-mode through `scoreUploadUrlsService`'s own extra
narrowing, train-mode through `RunUploadUrlsDto` (`RunUploadFilenameEnum` =
`z.enum(RUN_UPLOAD_FILENAMES)`) into `mintUploadUrls`, which has no filename
gate of its own. Both then land on `_ALLOWED_RUN_UPLOADS` in
`services/artifact_service.py`. Audited at T26: the train-mode route already
admitted this filename, so that task needed no allow-list change.

---

## 9. `NEW_DATA_HOLDOUT_PREDICTIONS_FILENAME = "new_data_holdout_predictions.parquet"`

| Copy        | Location                                                                                                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| this image  | `artifacts.py`                                                                                                                                                                          |
| apps/python | `object_store.py` (`NEW_DATA_HOLDOUT_PREDICTIONS_FILENAME`), also gates `_ALLOWED_RUN_UPLOADS` AND `_READABLE_PREDICTION_FILENAMES` in `services/artifact_service.py` (two allow-lists) |
| API (TS)    | `artifact-keys.ts` (`RUN_UPLOAD_FILENAMES`); the key is recorded by `complete()` into `ModelTrainingRun.newDataHoldoutPredictionsKey`                                                   |

MODEL-SERVE-020-T06. "Three copies, not two" like entries 4, 7 and 8 — plus a
fourth place that is easy to miss: python has a WRITE allow-list and a separate
READ allow-list, and widening only the first leaves the artifact uploadable and
then unreadable (`run_predictions` refuses the name). Both must admit it.

Its own filename, a THIRD population: `predictions.parquet` is the run's test
split, `holdout_predictions.parquet` its score on the current version's frozen
test slice, and this is its score on the rows the operator set aside from the
NEW dataset. Same `{timestamp,y_true,y_pred}` shape, different rows — nothing
may overwrite one with another.

**Image rebuild required.** This is an ADDITIVE artifact: a trainer image that
predates it does not crash, it simply never uploads the file, `complete()`
records NULL, and the Retrain tab states an honest absence while every layer of
code is correct. Nothing in CI builds `images/trainer`, so this reaches a run
only via a manual `docker build` + the pinned-tag bump in
`trainning-container.authorized.service.ts`.

---

## 10. `INCUMBENT_NEW_DATA_HOLDOUT_PREDICTIONS_FILENAME = "incumbent_new_data_holdout_predictions.parquet"`

| Copy        | Location                                                                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| this image  | `artifacts.py`                                                                                                                                                                                    |
| apps/python | `object_store.py` (`INCUMBENT_NEW_DATA_HOLDOUT_PREDICTIONS_FILENAME`), also gates `_ALLOWED_RUN_UPLOADS` AND `_READABLE_PREDICTION_FILENAMES` in `services/artifact_service.py` (two allow-lists) |
| API (TS)    | `artifact-keys.ts` (`RUN_UPLOAD_FILENAMES`); the key is recorded by `complete()` into `ModelTrainingRun.incumbentNewDataHoldoutPredictionsKey`                                                    |

MODEL-SERVE-021-T03. Same three-copy-plus-two-allow-list shape as entry 9 —
widening only the write allow-list leaves this artifact uploadable and then
unreadable.

Its own filename, a FOURTH population, scored only for a "New data only"
retrain (the strategy that replaces the training set outright and so has no
frozen incumbent-test slice — see entry 9's "THIRD population" note for the
other three): this is the CURRENT production version's score on the identical
new-data window entry 9 scores the candidate on. Same
`{timestamp,y_true,y_pred}` shape as its three siblings, different model,
same rows — the whole point is that the two are directly comparable.

Scored INSIDE this container, not by re-running the current version's own
saved job: `pipelines/__init__.py`'s `_score_new_data_holdout_if_present`
downloads the current version's model object (`incumbentModelUrl`, checksum-
verified) and its own feature columns (`incumbentFeatureColumns`, read off its
run manifest by the backend) only when the backend presigned them — true only
for "New data only". Never for lstm/gru: no `sequence_length` is recorded
anywhere the backend can read one from for an arbitrary saved version, so the
backend never presigns an incumbent for a sequence algorithm and this file is
simply absent on that run (honest absence, not a wrong number).

**Image rebuild required**, same as entry 9: an ADDITIVE artifact, absent
rather than crashing on a trainer image that predates it. Reaches a run only
via a manual `docker build` + the pinned-tag bump in
`trainning-container.authorized.service.ts`.

---

## 11. `CV_GAP_PREDICTIONS_FILENAME = "cv_gap_predictions.parquet"`

| Copy        | Location                                                                                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| this image  | `artifacts.py`                                                                                                                                                                                                                                   |
| apps/python | `object_store.py` (`CV_GAP_PREDICTIONS_FILENAME`), in `_ALLOWED_RUN_UPLOADS` but deliberately NOT `_READABLE_PREDICTION_FILENAMES` (that reader refuses anything but 3 columns) — read by its own `run_cv_gap` in `services/artifact_service.py` |
| API (TS)    | `artifact-keys.ts` (`RUN_UPLOAD_FILENAMES`)                                                                                                                                                                                                      |

MODEL-SERVE-026-T05. Same three-copy-plus-two-allow-list shape as entries 9
and 10, with ONE difference that matters to every reader: the schema is
`{fold, timestamp, y_true, y_pred, y_pred_current}`, NOT the
`{timestamp,y_true,y_pred}` its siblings share. `y_pred` is the candidate
CONFIGURATION refitted on that fold's expanding train window (never the
shipped model); `y_pred_current` is the current version's prediction, NaN on
every row before its own cut (it may have trained on those rows). A reader that
assumes the three-column shape will silently drop the two columns the whole
file exists for.

Written by `pipelines/cv_gap.py` only when the spec carries `cvGap` (a
NEW_DATA_ONLY retrain that asked for it) and the current version's model was
presigned; absent otherwise. Folds come from `splits.expanding_fold_plan`,
whose own docstring names its mirror in `split_stats_service.py`.

**Image rebuild required**, same as entries 9 and 10.

---

## 12. `CV_OOF_PREDICTIONS_FILENAME = "cv_oof_predictions.parquet"`

| Copy        | Location                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| this image  | `artifacts.py`                                                                                                                 |
| apps/python | `object_store.py` (`CV_OOF_PREDICTIONS_FILENAME`), gating BOTH `_ALLOWED_RUN_UPLOADS` and `_READABLE_PREDICTION_FILENAMES` in `services/artifact_service.py` |
| API (TS)    | `artifact-keys.ts` (`RUN_UPLOAD_FILENAMES`)                                                                                    |

MODEL-FLOW-028-T01. Same three-column `{timestamp, y_true, y_pred}` shape as
entries 8-10, so the shared prediction reader takes it unchanged — which is also
why it carries NO `fold` column (that reader refuses an unexpected column). Fold
membership is derived from `cv_folds.json`'s `cut_timestamp`s: fold i covers
`[cut_i, cut_{i+1})`.

A CV run's out-of-fold rows: every expanding fold's test window, predicted by
that fold's OWN model, which never trained on them. It describes the
CONFIGURATION, not the refit that ships, so it is a population of its own —
never served as the test split (a CV run has none) and never as the holdout.
No run column records its key; it is the sibling of `cvFoldsKey`.

Written by `pipelines/cv_expanding.py` for every CV run, via
`TrainingResult.extra_parquet`. A CV run trained before this image carries no
such file, permanently; the client states that absence.

**Image rebuild required**, same as entries 9-11.

---

## Long-term

The right fix is a shared wheel containing `labelled_mask`, the fold plan, and
the artifact-name constants, published from `apps/python` and installed into this
image at build time — at which point copies 1-3 collapse to one and only the
TypeScript filename constant remains mirrored. That is a build-pipeline change,
deliberately out of scope for this split, which changed no behaviour.
