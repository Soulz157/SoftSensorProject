# Development Plan

Generated from the three feature ledgers on **2026-09-17**. Those ledgers are the source of truth; this file is a scannable roll-up of them and will drift if they change. Regenerate rather than hand-edit.

| Ledger                            | Project                                    | Version | Progress |
| --------------------------------- | ------------------------------------------ | ------- | -------- |
| `feature_list.preprocessing.json` | Dataset Creation Flow — Lakehouse Refactor | 3.1.0   | **97%**  |
| `docs/feature_list.json`          | Model Creation Flow Refactor               | 1.0.0   | **65%**  |
| `docs/feature_list_model.json`    | Model Serving & Deployment                 | 0.1.0   | **88%**  |

The three run in sequence along one pipeline: a dataset is built (DS-LAKE), a model is trained and saved from it (MODEL-FLOW), and the saved model is served (MODEL-SERVE). MODEL-SERVE's own ledger states the seam explicitly — it "begins where MODEL-FLOW ends: at a committed Model row" and "owns nothing before Save Model."

---

## The headline: remaining work is mostly verification, not implementation

Counted across all three ledgers:

|                       | Open tasks | Open verification | of which live / browser / real-data |
| --------------------- | ---------- | ----------------- | ----------------------------------- |
| Dataset Creation Flow | 8          | 16                | 7                                   |
| Model Creation Flow   | 14         | 55                | 18                                  |
| Model Serving         | 0          | 6                 | 3                                   |
| **Total**             | **22**     | **77**            | **28**                              |

**77 open verification items against 22 open tasks.** Most features sit at 85–99% with their code written and their live pass unrun — DS-LAKE-021 is at 100% with its own V04 still pending, and MODEL-SERVE-001 has zero open tasks and six open verifications. Twenty-eight of the 77 need a running app and real data, which no amount of further coding retires.

**The practical consequence:** a single focused verification pass against real Postgres + MinIO + Python would close more of this plan than any new feature. Treat "write the next feature" as the lower-priority branch until that backlog is drawn down.

---

## 1. Dataset Creation Flow — Lakehouse Refactor (97%)

**Goal.** Refactor the Dataset Creation Flow into a Bronze/Silver/Gold/Final Lakehouse pipeline while keeping the five-step wizard UX intact. Every stage emits an immutable MinIO artifact with lineage and checksum. **A Dataset Version is created ONLY at Save.** MinIO is the single source of truth for rows; large datasets are reached through server-side metadata, pagination and bounded queries.

**Status.** 35 features — 24 completed, 11 in progress, 0 pending.

### Open work

| Feature                                                                       | %   | What remains                                                                                  |
| ----------------------------------------------------------------------------- | --- | --------------------------------------------------------------------------------------------- |
| `DS-LAKE-005B-D` Server-side EDA chart + stats for Step 3.1                   | 76  | 4 tasks (T01, T03, T08a, T08b) + 4 verifications. **The least complete item in this ledger.** |
| `DS-LAKE-012` End-to-end verification of the Lakehouse invariants             | 85  | T06, T08 + V06                                                                                |
| `DS-LAKE-022` Wizard reorder (EDA→3, Features→4, Cleaning→5; SILVER remapped) | 88  | T08 + 4 verifications                                                                         |
| `DS-LAKE-005B-B` Frontend viewport migration and virtualization               | 90  | V05 only                                                                                      |
| `DS-LAKE-005B-C` Parquet-native query path and layout benchmark               | 90  | T07 only                                                                                      |
| `DS-LAKE-020` Preset range cutoff drives Step 3.2 outlier cutoff              | 90  | V05 only                                                                                      |
| `DS-LAKE-026` Compare modal: two-sided histogram / box / correlation          | 90  | V05 only                                                                                      |
| `DS-LAKE-027` Edit re-entry survives a reclaimed draft artifact               | 90  | V04 only                                                                                      |
| `DS-LAKE-029` Re-design View All Workspaces                                   | 90  | V05 only                                                                                      |
| `DS-LAKE-015` Artifact-warm progress surface                                  | 95  | V01 only                                                                                      |
| `DS-LAKE-021` CSV export of the saved dataset at Step 5                       | 100 | V04 only — implementation is done                                                             |

Seven of these eleven are held open by a **single** verification item, and each of those is a live pass. This is the clearest concentration of verification debt in the codebase.

The ledger also carries a `deferred[]` of **12** recorded-but-unfixed items, and three `carried_forward` entries added by DS-LAKE-029 (dataset list scoped by `createdById`; a stale `workspaceStatusDot` reference in `DESIGN_SYSTEM.md:517`; unfiled canvas retirement).

---

## 2. Model Creation Flow Refactor (65%)

**Goal.** Keep the four-step user experience while separating training, evaluation, fine-tuning and final persistence. Training and fine-tuning must not commit the model. **The model is persisted only when the user clicks Save Model in Step 4.**

**Status.** 23 features — 12 completed, 11 in progress. The lowest-progress ledger of the three, and the one holding most of the verification backlog (55 of the 77).

### Open work

| Feature                                                                  | %   | What remains                                                                                                      |
| ------------------------------------------------------------------------ | --- | ----------------------------------------------------------------------------------------------------------------- |
| `MODEL-FLOW-023` Permutation importance for every predicting algorithm   | 10  | **9 tasks + 12 verifications — effectively unstarted.** The single largest piece of outstanding work in the repo. |
| `MODEL-FLOW-022` Per-algorithm parameter block                           | 71  | T03c + 4 verifications                                                                                            |
| `MODEL-FLOW-005` Background fine-tuning process                          | 85  | No open tasks or verifications recorded — see the caveat below                                                    |
| `MODEL-FLOW-021` Step 3 — compare runs in place                          | 85  | V05 only                                                                                                          |
| `MODEL-FLOW-003` Training against a draft, no model commit               | 90  | T10                                                                                                               |
| `MODEL-FLOW-004` Evaluation from draft results                           | 90  | Nothing recorded — see caveat                                                                                     |
| `MODEL-FLOW-010` Step 2 — Dataset Review before Training Config          | 90  | V01, V03, V04, V05                                                                                                |
| `MODEL-FLOW-014` Step 3 — split distribution panel + honest seed control | 90  | 5 verifications                                                                                                   |
| `MODEL-FLOW-019` Step 4 — ranked candidate table                         | 94  | 3 tasks + **26 verifications**                                                                                    |
| `MODEL-FLOW-006` Persist config and artifacts before final save          | 95  | Nothing recorded — see caveat                                                                                     |
| `MODEL-FLOW-013` Step 4 — Model Selection                                | 99  | V04, V05, V06                                                                                                     |

> **Ledger inconsistency, not yet resolved.** `MODEL-FLOW-004` (90%), `MODEL-FLOW-005` (85%) and `MODEL-FLOW-006` (95%) are all marked `in_progress` with **no open task and no open verification recorded**. Either the residual percentage is stale and they are done, or the remaining work was never written down. Audit these three before trusting their numbers — a percentage with nothing behind it cannot be actioned.

`MODEL-FLOW-019` alone carries 26 open verification items, more than the entire Lakehouse ledger.

---

## 3. Model Serving & Deployment (88%)

**Goal.** Serve a saved Model over HTTP for synchronous and batch prediction, promote and roll back versions without rebuilding an image, and trigger retraining as a job.

**Status.** 8 features — 7 completed, 1 in progress.

### Open work

| Feature                                                                          | %   | What remains                                                          |
| -------------------------------------------------------------------------------- | --- | --------------------------------------------------------------------- |
| `MODEL-SERVE-001` Model Version Registry — one row decides what is in production | 88  | V05, V06, V07, V08, V09, V12 — **six verifications, zero open tasks** |

This ledger is one verification pass away from complete. Its `progress_note` also records that the file was originally written from the MODEL-FLOW ledger rather than from a code read, with findings marked UNVERIFIED until `MODEL-SERVE-000` replaced them with facts — worth remembering when reading its older entries.

---

## Recommended order

1. **Draw down the verification backlog**, cheapest first. Seven Lakehouse features need one live pass each; a single session against real Postgres + MinIO + Python likely closes several, and would move that ledger from 97% to done.
2. **`MODEL-SERVE-001`'s six verifications** — closes an entire ledger.
3. **Audit `MODEL-FLOW-004/005/006`** — resolve the percentages that have no recorded work behind them, so the 65% figure means something.
4. **`MODEL-FLOW-019`'s 26 verifications** — the largest single block, and it gates a feature already at 94%.
5. **`MODEL-FLOW-023`** (permutation importance) — the only substantial greenfield implementation left. Start it once the above stop competing for attention.

---

## Notes on the ledgers themselves

- **Stale cross-references.** `feature_list.preprocessing.json`'s `note` claims `feature_list.json` tracks "PI Data Source Verification & Historical Fetch Workflow"; the file at `docs/feature_list.json` is actually "Model Creation Flow Refactor", and no root `feature_list.json` exists. Its `progress_note` likewise still reports "completed 23, in_progress 10, pending 2" against an actual 24 / 11 / 0.
- **Validate JSON before and after editing a ledger.** An unescaped quote in a feature's prose has silently broken parsing before.
- **Percentages are per-feature and hand-maintained**; the project-level figure is not a mechanical average of them.

---

## History

Phases 1–7 of the original plan (refresh token → access token → auth module → testing → workspace/user management → PI System ingestion → data processing pipeline) were removed from this file on 2026-09-17. Auth, workspace and PI ingestion shipped; the Phase 7 data-processing pipeline was superseded by the Lakehouse refactor above. Recover the full text from git history if needed.

A "Color Theory & Tokens" section was also removed from this file on the same date — it duplicated `docs/DESIGN_SYSTEM.md`, which remains the design rule book.
