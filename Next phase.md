# MODEL-FLOW-038 — Find Best Parameters → real sklearn GridSearchCV

## Context

Today "Find Best Parameters" (Step 3 → Fine-tune → Round 2) does no real search. `apps/backend/src/lib/tuning-grid.ts` holds a hand-picked shortlist (≤4 variants per algorithm, size-tiered). `ModelCandidateJobAuthorizedService.expandSearchCandidates` (`model-candidate-job.authorized.service.ts:447`) turns it into `base + variants`, and each variant runs as its own Docker trainer container, one after another, with `advanceJobForRun` picking `bestRunId` by RMSE/MAE.

The user wants this replaced with a real `GridSearchCV` (decisions made 2026-11-03):

- **Trainer-side**: ONE trainer run does `GridSearchCV` over the full cartesian `param_grid`. Step 4 shows that one winner run plus a table of every combination.
- **Grid source**: backend declares a default `param_grid` per algorithm (size-tiered). The user can add/remove values per key in the Fine-tune card, with a live combination count.
- **LSTM/GRU**: keep today's curated per-variant job unchanged (`SequenceRegressor` isn't sklearn-clonable, and CV is refused for sequence models).
- **No-CV (Train/Test split) runs**: GridSearchCV scores on a single chronological fold, `cv=[(train_idx, test_idx)]`, using the same cut.

Persistence invariant unchanged: this is all draft-owned training. No Model commit; Save Model stays the only final commit.

Out of scope: retrain Auto/Custom Finetune on the model page (`model-retrain.authorized.service.ts`). It keeps `TUNING_GRID` / `expandSearchCandidates` as-is.

## Design

### Data flow

```
Step 3 Start Fine-tune (useGrid on, tabular algo)
  → POST candidate-jobs { kind: HYPERPARAMETER_SEARCH, candidates:[{algorithm, hyperparameters: base}], paramGrid }
  → job.candidates = [{ algorithm, hyperparameters: base, paramGrid, phase: 1 }]   (JSON column, no migration)
  → 1 trainer run; claim() adds `paramGrid` (read from job.candidates[completedRuns])
  → trainer: GridSearchCV(refit=False) → best combo → existing strategy run with best combo
  → /complete { metrics, bestHyperparameters, uploaded:[..., grid_search_results.json] }
  → backend overwrites run.hyperparameters = bestHyperparameters; job completes, bestRunId = that run
```

### Trainer (`images/trainer/app`)

- **New `pipelines/grid_search.py`**:
  - `BuildModelEstimator(BaseEstimator, RegressorMixin)`, with `__init__(algorithm, hyperparameters, seed, feature_spec)`. `fit(X, y)` calls `build_model(algorithm, hyperparameters, seed, len(X), feature_spec)` and fits. `predict` delegates.
  - `build_model` stays the ONLY place UI→estimator translation happens (mlp tuple, `None`→-1, `goss`, GRP row ceiling, seed).
  - `param_grid = {"hyperparameters": [ {**base, **combo} for combo in ParameterGrid(ui_grid) ]}`.
  - Folds come from `labelled_frame(prepared)`:
    - CV: `assert_admissible_fold_count` + `expanding_fold_plan` (`splits.py:123,160`), turned into `(train_idx, test_idx)` pairs. These are the same folds `cv_expanding.run` reports.
    - Chronological: one pair from the same `chronological_split(ratio)` cut.
  - `scoring` = `neg_root_mean_squared_error` | `neg_mean_absolute_error` from new spec field `rankingMetric`. Settings: `refit=False`, `n_jobs=1`, `error_score="raise"`.
  - It returns the best combo plus a trimmed `cv_results_`: per combo `params`, `mean_test_score`, `std_test_score`, `rank_test_score`, `mean_fit_time`. Scores are flipped to positive metric values.
- **`pipelines/__init__.py`**:
  - In `run_training`, when `spec.paramGrid` is present (and the algorithm is not in `SEQUENCE_ALGORITHMS`, else raise), run the search first.
  - Then replace `prepared.hyperparameters` with the best combo and run the normal `_select_strategy` (`cv_expanding` / `chronological`). That way `metrics.json`, `cv_folds.json`, OOF, holdout, importance and the raw `model.joblib` are produced exactly as today.
  - Put `grid_search_results.json` into `result.extra_json`.
  - Send `bestHyperparameters` on `complete()`.
  - `manifest.py` records the best combo, plus `param_grid` under a new `search` key.
- **`artifacts.py`**: add `GRID_SEARCH_RESULTS_FILENAME = "grid_search_results.json"`. Mirror it per `MIRRORS.md` in python `object_store.py` `_ALLOWED_RUN_UPLOADS` and backend `artifact-keys.ts` `RUN_UPLOAD_FILENAMES`.

### Backend (`apps/backend`)

- **`lib/tuning-grid.ts`**: add `PARAM_GRID: Record<string, Record<string, HyperparamValue[]>>` (medium) + `PARAM_GRID_OVERRIDES` per tier, and `paramGridFor(algorithm, size, base)`.
  - Each key's list gets the base value merged in, so the base is always one grid point. That replaces the old "already covered" exclusion.
  - Keep it separate from `TUNING_GRID`, which lstm/gru and retrain still use, so the reference-identity `sized` flag is untouched.
  - 2–3 searched keys per algorithm; the default stays ≤ ~24 combos.
  - Constant: `MAX_GRID_COMBINATIONS = 64`, plus helper `gridCombinationCount`.
- **DTOs**:
  - `CreateCandidateJobSchema` gets `paramGrid?: Record<string, scalar[]>`. Each list is 1–10 distinct values; product ≤ `MAX_GRID_COMBINATIONS`.
  - Refines: only for `HYPERPARAMETER_SEARCH` with exactly 1 candidate, not for lstm/gru, and mutually exclusive with `extraVariants`. Keys must exist in `HYPERPARAMS` for that algorithm.
  - `RunCompleteSchema` gets `bestHyperparameters?: HyperparametersSchema`.
- **`model-candidate-job.authorized.service.ts` `createJob`**:
  - When `paramGrid` is present: candidates = `[{...base, paramGrid, phase:1}]` and `totalRuns = 1`. No `expandSearchCandidates`.
  - lstm/gru and sweep paths: unchanged.
- **`model-run.authorized.service.ts`**:
  - `claim()`: for a candidate run whose job candidate carries `paramGrid`, add `paramGrid` + `rankingMetric` to the spec.
  - `complete()`: if the run had a grid:
    - Require `bestHyperparameters` and `grid_search_results.json` in `uploaded`, else mark the run FAILED with "trainer image does not support grid search — rebuild images/trainer". This guards against trainer image drift.
    - Overwrite `run.hyperparameters` with the best combo, in the same update.
- **`tuning-grid.authorized.service.ts` + controller**: new `GET /authorized/training/param-grid/:algorithm` (same size query as `tuning-grid`), returning `{ algorithm, paramGrid, tier, maxCombinations }`.
- **Serving results**: `getDraftRunService` soft-reads `grid_search_results.json` by filename under the run prefix (same pattern as `cv_gap_predictions`, no key column) via a python reader beside `getRunCvFolds` (`python-preprocess-client.ts:945`, `apps/python/routers/preprocess.py`). `reconcileAndShape` passes `gridSearch` on the candidate.

### Client (`apps/client`)

- **`services/tuning-grid.ts`**: `paramGridService.get(algorithm, size)`. **`hooks/model/use-param-grid.ts`**: same debounced pattern as `use-tuning-grid.ts`.
- **Store**: `mpFineTuneParamGridEditsAtom` (per algorithm), reset in `resetWizardAtom`.
- **`lib/param-grid.ts`** (pure): merge default + edits + base, `combinationCount`, and validation (≤64, ≥1 value per key).
- **`TC/variant-preview.tsx`** in direct mode, for tabular algorithms: replace the curated-rows table + extra rows with a **ParamGridEditor**. One row per key, values as removable pills (pattern from `cleaning-tag-badges.tsx`), and an add control using `VariantValueInput` with the field kind. Footer: "N combinations × k folds = M fits", plus a refusal over 64. lstm/gru keep the current table.
- **`lib/training-launch.ts` `planFineTuneLaunch`**: with `useGrid` and a tabular algorithm, send `paramGrid` instead of `extraVariants`. **`hooks/model/use-fine-tune.ts`** exposes the grid and the count. Fine-tune section copy changes to "Grid search (GridSearchCV) over every combination…".
- **`lib/model/estimate-runtime.ts`**: grid cost = `combos × folds + refit`, replacing `TUNE_VARIANTS=4` for tabular.
- **`hooks/model/use-model-training.ts` `pollJob`**: show "Grid search running — N combinations" instead of "Candidate X of N" when the job has a grid.
- **Step 4 `model-selection/candidate-table.tsx`** (expanded row) **+ `TC/run-params-panel.tsx`** (run card): add a **GridSearchResultsTable**, ranked by score, with the best row marked and params shown via `classifyHyperparams`.

### Ledger

Add `MODEL-FLOW-038` to `docs/feature_list.json` (next free id, verified). Tasks: T01 trainer, T02 mirrors + artifact, T03 backend DTO/job/claim/complete, T04 param-grid endpoint + default table, T05 client editor + launch, T06 Step 4 results table, T07 runtime estimate, T08 image rebuild + live check. Parse the JSON before and after editing.

## Critical files

- `images/trainer/app/pipelines/{grid_search.py (new), __init__.py}`, `artifacts.py`, `manifest.py`, `MIRRORS.md`
- `apps/python/.../object_store.py`, `apps/python/routers/preprocess.py`
- `apps/backend/src/lib/{tuning-grid.ts, artifact-keys.ts, python-preprocess-client.ts}`
- `apps/backend/src/api/v1/model-run/authorized/{dto/model-candidate-job.authorized.dto.ts, dto/model-run.authorized.dto.ts, model-candidate-job.authorized.service.ts, model-run.authorized.service.ts, model-run-launch.authorized.service.ts, tuning-grid.authorized.{service,controller}.ts}`
- `apps/client/{services/tuning-grid.ts, services/model-draft.ts, hooks/model/use-fine-tune.ts, lib/training-launch.ts, lib/model/estimate-runtime.ts, store/model-pipeline.ts}`, `TC/{variant-preview.tsx, fine-tune-section.tsx, run-params-panel.tsx}`, `model-selection/candidate-table.tsx`

## Verification

1. **Trainer tests** (run in-image per memory: mount source into `scgc/soft-sensor-trainer`, pip --user pytest). New `test/test_grid_search.py`:
   - ols/ridge on the `_prepared()` fixture from `test_cv_oof.py`: every combination appears in the results.
   - Best `mean_test_score` == `metrics.cv_rmse_mean` from the follow-up `cv_expanding.run`, so the folds are identical.
   - Base is in the grid; chronological single-fold mode works; lstm + paramGrid raises.
   - `BuildModelEstimator` survives `sklearn.clone`; mlp/lightgbm `goss` translate correctly.
2. **Backend jest**:
   - `tuning-grid.spec.ts`: PARAM_GRID keys match models.py read live; base merged; ≤64.
   - DTO refines.
   - `createJob` with `paramGrid` → 1 candidate, `totalRuns 1`.
   - `claim` includes `paramGrid`.
   - `complete` overwrites hyperparameters and FAILS without the results artifact.
   - Existing lstm/gru + retrain specs still pass unchanged.
3. **Client vitest**:
   - `param-grid.test.ts`, `training-launch.test.ts` (grid payload), `estimate-runtime.test.ts`, `variant-preview.test.tsx` (editor add/remove/count/refusal; lstm keeps the table), `fine-tune-section.test.tsx`, Step 4 results table.
   - Confirm case counts, not just file PASS.
4. `pnpm check-types && pnpm lint`.
5. **Live**: the user rebuilds `images/trainer` + bumps the tag (CI doesn't build it). Then, on the fake PI dataset, Create Model → Round 1 → Fine-tune ridge with the default grid + one added alpha:
   - Exactly 1 container `train-*`.
   - Step 4 shows one winner + the full combinations table.
   - Run hyperparameters = best combo.
   - Repeat with CV k=3, and with lstm (old variant path).
   - Save Model still the only Model row created.
