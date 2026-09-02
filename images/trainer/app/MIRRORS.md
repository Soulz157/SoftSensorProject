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

| Copy | Location |
| --- | --- |
| this image | `labels.py` |
| apps/python | `services/split_stats_service.py` (same mask logic) |

The non-Good-target mask. DS-LAKE-023-T03/D4. Both copies must agree on the
fallback behaviour when the `__status` column is absent, or a train/test score
and a holdout score computed on either side of the boundary stop being
comparable.

---

## 2. `MIN_LABELS_PER_FOLD = 10`

| Copy | Location |
| --- | --- |
| this image | `splits.py` |
| apps/python | `services/split_stats_service.py` |

MODEL-FLOW-016-T02/T03. The **number** must match; the measured table
deliberately lives in `split_stats_service.py` ONLY, so the two copies cannot
drift on the table while agreeing on the number.

Pinned identically by `test_split_stats_service.py` and by this package's
`test_splits.py`.

---

## 3. `expanding_fold_plan`

| Copy | Location |
| --- | --- |
| this image | `splits.py` |
| apps/python | `services/split_stats_service.py::_expanding_fold_plan` |

MODEL-FLOW-016-T03. `TimeSeriesSplit(n_splits=k)`'s cut arithmetic, verified
index-for-index against a real `TimeSeriesSplit`. V01 pins the two against each
other's actual **output** — not just the algorithm — by asserting this
function's result equals a real `/split-stats` call's fold plan for the same
artifact and `k`.

---

## 4. `CV_FOLDS_FILENAME = "cv_folds.json"`

| Copy | Location |
| --- | --- |
| this image | `artifacts.py` |
| apps/python | `object_store.py` (`CV_FOLDS_FILENAME`) |
| API (TS) | `artifact-keys.ts` |

MODEL-FLOW-016-T04. **Three** copies, not two. Miss one and the run writes an
artifact nothing reads, with no error anywhere.

---

## Long-term

The right fix is a shared wheel containing `labelled_mask`, the fold plan, and
the artifact-name constants, published from `apps/python` and installed into this
image at build time — at which point copies 1-3 collapse to one and only the
TypeScript filename constant remains mirrored. That is a build-pipeline change,
deliberately out of scope for this split, which changed no behaviour.
