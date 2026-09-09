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
miss one and score-mode's upload is refused outright. Deliberately a
DIFFERENT filename from `PREDICTIONS_FILENAME`, not a third copy of it: a
non-CV run's `predictions.parquet` already holds its TEST split the moment
training finishes, and scoring must never overwrite that object. `score.py`
picks the filename from `spec["isCvRun"]` (`scoreClaimService`'s own field) —
a CV run still writes `predictions.parquet` (it has no test split to lose),
a non-CV run writes this one.

---

## Long-term

The right fix is a shared wheel containing `labelled_mask`, the fold plan, and
the artifact-name constants, published from `apps/python` and installed into this
image at build time — at which point copies 1-3 collapse to one and only the
TypeScript filename constant remains mirrored. That is a build-pipeline change,
deliberately out of scope for this split, which changed no behaviour.
