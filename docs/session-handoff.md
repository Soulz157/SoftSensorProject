# Session Handoff

## Project

Dataset Lake Refactor

Current Sprint: Draft-first Dataset Architecture

Last Updated: 2026-08-12

Source of truth for task-level detail: `feature_list.preprocessing.json` (repo root). This doc is a lightweight summary of it — if the two disagree, the JSON file wins.

---

# Current Goal

~~Implement a Draft-based Dataset Pipeline where no Dataset,
DatasetVersion or Model is committed until the user explicitly
clicks Save Dataset.~~ **DONE** — DS-LAKE-009 made Save Dataset the
only DatasetVersion-creating code path, live-verified against real
Postgres/MinIO/HTTP (grep-confirmed single call site, forced-rollback
test, full real wizard-to-save run, refusal-without-FINAL test,
64-bit sizeBytes test — all 5 items completed).

Current goal now: finish porting Gold (feature engineering) and
Validation server-side (DS-LAKE-006/007/008), then registry lifecycle
and the Loader seam (DS-LAKE-010/011).

Dataset Creation operates entirely on DatasetDraft until Save — this
part of the architecture is fully implemented and live-verified.

---

# Current Architecture

Wizard

Step 1
Upload / Select Source

↓

Step 2
Fetch Raw Data
→ Save BRONZE Artifact (MinIO)
→ DatasetDraft only

↓

Step 3
Cleaning
→ Save SILVER Artifact
→ DatasetDraft only

↓

Step 4
Feature Engineering
→ Save GOLD Artifact
→ DatasetDraft only

↓

Step 5
Validation

↓

Save Dataset

↓

Create Dataset
Create DatasetVersion
Promote FINAL Artifact
Commit Database

↓

Intermediate Artifact Cleanup (async, admin-triggered)
Reclaims MinIO bytes for BRONZE/SILVER/GOLD once no longer
lineage-pinned and past their retention window. Never touches
FINAL, never deletes a DatasetArtifact row, never blocks Save.

---

# Engineering Decisions

✓ Save Dataset is the only persistence boundary. **Enforced and live-verified (DS-LAKE-009).**

✓ DatasetVersion must never exist before Save. **Enforced and live-verified.**

✓ DatasetDraft is the aggregate root.

✓ Artifacts belong to either DatasetDraft or Dataset.

✓ Original files remain immutable.

✓ Feature Preset Runtime JSON is stored in MinIO.

✓ Metadata is stored in Database.

✓ Intermediate artifacts are cleaned up, never the FINAL artifact; a
BRONZE reachable through a non-ARCHIVED DatasetVersion's lineage is
pinned regardless of age (DS-LAKE-009B).

✓ Cleanup reclaims MinIO objects only — a DatasetArtifact row is
never deleted, only stamped `objectReclaimedAt`, so its operations
recipe stays readable (DS-LAKE-009B).

---

# Feature Status

| Feature        | Status         | Notes                                                                                                                                                                                                                                               |
| -------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DS-LAKE-001    | ✅ Complete    | Feature ledger & flow audit                                                                                                                                                                                                                         |
| DS-LAKE-002    | ✅ Complete    | Artifact ledger & registry schema split                                                                                                                                                                                                             |
| DS-LAKE-003    | ✅ Complete    | Artifact key contract, checksum, manifest                                                                                                                                                                                                           |
| DS-LAKE-004    | ✅ Complete    | Bronze layer stops creating a Dataset Version                                                                                                                                                                                                       |
| DS-LAKE-004B   | ✅ Complete    | DatasetDraft entity, draft-scoped ownership                                                                                                                                                                                                         |
| DS-LAKE-005    | ✅ Complete    | Silver layer — server cleaning path wired into Step 3                                                                                                                                                                                               |
| DS-LAKE-005B-A | ✅ Complete    | Bounded server-side access contract — V01/V02 closed by structural proof, V05 by new end-to-end test, V04 deferred (recorded scope decision)                                                                                                        |
| DS-LAKE-005B-B | 🚧 In Progress | Frontend viewport migration — 2 tasks (T01, T03) blocked, no reason on file; needs investigation                                                                                                                                                    |
| DS-LAKE-005B-C | ⏳ Pending     | Parquet-native query path & layout benchmark                                                                                                                                                                                                        |
| DS-LAKE-006    | 🚧 In Progress | Gold layer — feature engineering port. All 6 tasks completed (found substantially pre-built, untracked); feature-level status held at in_progress because AC5 (browser boundedness) genuinely fails — owned by DS-LAKE-005B-B-T04, not this feature |
| DS-LAKE-007    | ⏳ Pending     | Validation layer — quality gate & report                                                                                                                                                                                                            |
| DS-LAKE-008    | ⏳ Pending     | Step 5 validation gate                                                                                                                                                                                                                              |
| DS-LAKE-009    | ✅ Complete    | Final artifact & Save Dataset persistence boundary — live-verified                                                                                                                                                                                  |
| DS-LAKE-009B   | ✅ Complete    | Intermediate artifact lifecycle & cleanup — live-verified (7/7 verification items, real Postgres+MinIO+Python)                                                                                                                                      |
| DS-LAKE-010    | ⏳ Pending     | Dataset registry lifecycle, promotion, lineage                                                                                                                                                                                                      |
| DS-LAKE-011    | ⏳ Pending     | Loader seam — enqueue, retry, pluggable sink                                                                                                                                                                                                        |
| DS-LAKE-012    | ⏳ Pending     | End-to-end verification of Lakehouse invariants                                                                                                                                                                                                     |

Overall: 9 of 17 features complete (53%), per `feature_list.preprocessing.json`.

---

# Important Constraints

- Never commit Dataset before Save. _(enforced, DS-LAKE-009)_
- Never create DatasetVersion before Save. _(enforced, DS-LAKE-009)_
- All processing writes Artifacts to MinIO.
- Database stores metadata only.
- Feature Preset Runtime JSON is loaded from MinIO.
- Cleanup never deletes a DatasetArtifact row, never touches FINAL,
  never runs inside Save's transaction. _(enforced, DS-LAKE-009B)_
- No new queue infrastructure (Redis/BullMQ/Celery) — the in-process
  `PreprocessingJobService` runner is reused; single-replica only.

---

# Remaining Work

In dependency order:

1. Unblock DS-LAKE-005B-B-T01/T03 (reason not recorded — check with
   whoever left them blocked before resuming). DS-LAKE-006 landing
   (below) does NOT unblock these on its own — Step 4/5's local
   materialization gap is DS-LAKE-005B-B-T04's job, not DS-LAKE-006's;
   re-check T01/T03's blockedReason against current code before
   assuming they're clear.
2. DS-LAKE-005B-C — Parquet-native query path & layout benchmark.
3. Close DS-LAKE-006's remaining gap: AC5 (browser boundedness) fails
   because `dwFeaturedDatasetAtom` (store/dataset-studio.ts:140-142)
   computes over the full `dwRawDatasetAtom`, not a bounded sample —
   this is DS-LAKE-005B-B-T04's `BoundedSample` brand type job. All 6
   of DS-LAKE-006's own tasks are done (2026-08-12 audit); only the
   feature-level flip to `completed` is blocked on this, cross-owned.
4. DS-LAKE-007 — Validation layer / quality gate.
   Note: `apps/python/services/validation_service.py`, its tests, and
   a `/v1/preprocess/validate` route already exist untracked (found
   2026-08-12, same session as the DS-LAKE-006 audit) — same
   pre-built-but-untracked pattern DS-LAKE-006 turned out to be; check
   before starting from scratch, same as DS-LAKE-006 was.
5. DS-LAKE-008 — Step 5 validation gate (client-side wiring).
6. DS-LAKE-010 — Dataset registry lifecycle, promotion, lineage.
7. DS-LAKE-011 — Loader seam.
8. DS-LAKE-012 — End-to-end verification of every Lakehouse invariant.

---

# Known Decisions

Feature Preset

Upload Excel

↓

Original Excel → MinIO

↓

Parse

↓

Runtime preset.json

↓

MinIO

↓

Metadata

↓

Database

Dataset Wizard uses

- Features
- Equations
- Conditions
- Range

Model Wizard additionally reads

- Target (Y)

---

# Session Notes (2026-08-12)

- Completed DS-LAKE-009B (Intermediate Artifact Lifecycle and
  Cleanup) end to end: config, migration (`objectReclaimedAt`),
  eligibility predicate, admin cleanup service/controller, Python
  reclaim endpoint, MinIO tmp lifecycle rule. All 9 tasks and all 7
  verification items live-verified against real Postgres + real
  MinIO + a real running Python service — no mocks standing in for
  the verification claims. Two real bugs were caught and fixed
  before ship (retention window measured from the wrong timestamp;
  no compensating retry when a delete succeeds but the DB stamp
  fails).

- **Data-loss incident and correction**: mid-session, a
  `git checkout -- feature_list.preprocessing.json` (run to fix a
  cosmetic unicode-escaping issue introduced by `json.dump` without
  `ensure_ascii=False`) reverted the _entire file_ to HEAD, silently
  discarding uncommitted state — DS-LAKE-009 had genuinely been
  completed in an earlier, uncommitted session, and that fact was
  lost. It was caught later in the same session by cross-checking
  against this file's own printed output captured earlier in the
  conversation transcript, and restored (status, progress, full
  verification narrative, cross-reference). Per-task narrative text
  for DS-LAKE-009's individual tasks (T01–T07) was **not**
  recoverable at full fidelity and is marked as such rather than
  invented.

  **Lesson for future sessions**: `feature_list.preprocessing.json`
  carries real, sometimes-uncommitted progress. Commit it after
  meaningful updates rather than leaving it as long-lived uncommitted
  state, and never run a bare `git checkout -- <file>` on it to fix a
  formatting issue — reload and re-apply the specific fix instead.

- Completed DS-LAKE-005B-A (Bounded server-side dataset access
  contract): closed its 3 remaining verification items. V01 (row-limit
  clamp, size-independent) and V02 (metadata/tag-catalog/column-stats
  carry no row payload) closed by structural/citation proof — no new
  code, since both claims already followed categorically from existing
  Zod schemas, the global `AppZodValidationPipe`, and the response
  builders' field-by-field (never spread) construction. V05 (realistic
  six-month/1-minute preview downsample) closed with one new test,
  `test_v05_full_scenario_ratio_and_both_extrema_survive_end_to_end`
  (`apps/python/tests/test_preview_service.py`), since existing
  coverage proved the same claims at the pure-function level or without
  checking the reported ratio's value — the new test runs the real
  259,200-row window through `build_preview` with sampling and
  downsampling both engaged, and checks the ratio against the true
  source length plus survival of an injected spike and trough together.
  V04 (JSON-vs-Arrow wire-format benchmark) stays deferred — a recorded
  scope decision, not something "finish" un-defers.

---

# Next Session

Primary Goal

Unblock DS-LAKE-005B-B (2 blocked tasks, reason not on file), then
move to DS-LAKE-005B-C or DS-LAKE-006 depending on priority call.

Before starting DS-LAKE-006/007, check whether
`apps/python/services/feature_service.py`,
`feature_spec_service.py`, and `validation_service.py` (all present,
untracked) already satisfy some or all of those tasks' acceptance
criteria — the code may be ahead of the tracked task status.

Do NOT

- Commit Dataset outside Save.
- Create DatasetVersion outside Save.
- Commit Model outside the Model Creation Flow's Save Model boundary.
- Modify original uploaded files.
- Store runtime preset in the database.
- Duplicate artifact data between Database and MinIO.
- Delete a DatasetArtifact row from the cleanup path (T09 invariant).
- Run a bare `git checkout -- feature_list.preprocessing.json` (see
  Session Notes above).

Only metadata belongs in the database.
