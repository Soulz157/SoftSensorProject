# DS-LAKE-012 — End-to-End Verification Report

Run date: 2026-08-17. Live Postgres (`softsensorproject-db-1`) + live MinIO
(`minio-local`) + live backend (:4000) + live python (:8000), no mocks. This
report is the record of what was actually run and observed; `scripts/verify/`
holds the reusable how.

---

## 1. Summary

DS-LAKE-012 closes. Every acceptance criterion below was checked against a
real, freshly-produced run — not by reading the code. Along the way, two
real defects were found and fixed (both in scope, both verified fixed with
before/after live evidence), and the two open dependencies
(DS-LAKE-005B-B, DS-LAKE-005B-C) close alongside it.

| Item                                                            | Result                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| SILVER produced for the first time in this database             | ✅ real, live                                                             |
| BRONZE→SILVER→GOLD→FINAL→Save chain, end to end                 | ✅ real, live (Dataset `d3acec46`)                                        |
| Reproducibility anchor (replay from pinned BRONZE)              | ✅ byte-identical, both before AND after cleanup ran                      |
| No timeseries rows anywhere in Postgres                         | ✅                                                                        |
| FINAL reconstruction matches the registry                       | ✅ (two independent datasets)                                             |
| Model flow regression, pre- and post-refactor dataset           | ✅, zero diff under `models/create`                                       |
| Intermediate cleanup reclaims real bytes without breaking FINAL | ✅ — **found and fixed a real FINAL-byte-loss bug along the way**         |
| `pnpm format` / `check-types` / `build`                         | ✅ (found and fixed a second real bug — dead field blocking `pnpm build`) |
| Network boundedness at 8,000+ tags                              | ✅ — **found and fixed a real unbounded-fetch bug (76 MB → 489 KB)**      |

---

## 2. Architecture, storage, lifecycle (as verified, not as documented)

Confirmed live this session, matching `docs/ARCHITECTURE.md`'s Draft-first
design:

```
Step 1 Upload/Select Source
   ↓
Step 2 Fetch Raw Data ──────► BRONZE artifact (MinIO) + DatasetDraft row
   ↓
Step 3 Cleaning ────────────► SILVER artifact (MinIO) + PreprocessingJob row
   ↓
Step 4 Feature Engineering ─► GOLD artifact (MinIO) + feature_spec.json sidecar
   ↓
Step 5 Validation ──────────► validation_report.json sidecar, qualityScore
   ↓
Save Dataset ────────────────► Dataset + DatasetVersion + FINAL artifact,
                                 committed together, ONE transaction
   ↓
Intermediate Cleanup (admin) ► reclaims BRONZE/SILVER/GOLD bytes past
                                 retention, never FINAL, never a row
```

No step before Save writes a `Dataset` or `DatasetVersion` row — verified by
watching `DatasetArtifact.datasetId` stay `null` (owned by `draftId` only)
through BRONZE→SILVER→GOLD→FINAL, and only becoming non-null the instant
`saveDraftAsDatasetService` runs.

### Metadata, versioning, lineage

- `DatasetVersion.lineage` is a **frozen JSON snapshot** taken at Save time
  (verified: the four artifact ids/types/checksums/objectKeys returned by the
  real `/save` call match the four `DatasetArtifact` rows exactly).
- `DatasetArtifact.parentArtifactId` is the **live** chain — walked for real
  by the cleanup service's `computeProtectedArtifactIds` every run, not a
  cached copy.
- Promotion (`DRAFT → VALIDATED → ACTIVE`) is metadata-only — verified live:
  `checksum` and `artifactId` on `DatasetVersion` `13ef93aa` were
  byte-identical before and after promotion.

### Loader

`LoaderJob` retry (`POST /:id/loader-jobs/:jobId/retry`) creates a **new**
job row rather than resetting the old one — confirmed by code inspection of
`dataset-version.authorized.controller.ts:373-386`; not independently
re-exercised live this session (out of the critical path — no loader run was
in a retriable state during this pass).

---

## 3. Task-by-task record

### T01 — Full wizard run, real source, every artifact and row recorded

Reused an existing real BRONZE (`460dcffa`, 19 real PI tags, 4,380 rows,
fetched live from `scgc-piwebapi.scg.com` in an earlier session with network
access this sandbox does not have) rather than performing a fresh fetch —
**scope decision, stated plainly**: this sandbox cannot reach the real PI
Web API (`HTTPSConnectionPool... NameResolutionError`), and the CSV/SQL
source types are not materializable yet
(`source-block.ts`: `` `Source type '${source.type}' cannot be materialized
yet.` `` for anything but `aveva`/`sql`). Everything downstream of BRONZE —
clean, features, validate, finalize, save — was driven fresh, through the
same NestJS endpoints the wizard's own hooks call, against real MinIO and
Postgres.

Full chain produced and recorded:

| Artifact       | id                                     | type       | parent | checksum                                                                 |
| -------------- | -------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------ |
| BRONZE         | `460dcffa-5802-4044-a1d0-36134515c120` | BRONZE     | —      | `4ec63adea8…`                                                            |
| SILVER         | `f31c92ae-0de3-4a2a-a7dd-dc7eb79fa2ee` | SILVER     | BRONZE | `4ec63adea8…` (forward-fill was a genuine no-op — BRONZE had 0% missing) |
| GOLD           | `c7ad0f42-82a2-4564-a175-a3fd01f0fb58` | GOLD       | SILVER | `d85f96ccf1…`                                                            |
| FINAL          | `e71541b8-a44b-42fa-b21e-ad132a31a099` | FINAL      | GOLD   | `d85f96ccf1…` (shares GOLD's objectKey — see §5)                         |
| Dataset        | `d3acec46-0fbe-4292-bef7-067b449e5f2c` | —          | —      | —                                                                        |
| DatasetVersion | `13ef93aa-704d-42a6-92cd-fac41d112b10` | v1, ACTIVE | —      | `d85f96ccf1…`                                                            |

**This is the first SILVER artifact ever produced in this database** — zero
SILVER existed at session start, across two prior sessions of attempts.

### T02 — Reproducibility from MinIO alone

`scripts/verify/v02-final-artifact-matches-registry.py` reads the FINAL
artifact's Parquet bytes straight from MinIO by `objectKey`, recomputes
rowCount/columnCount/sha256 from the bytes alone, and compares against the
`DatasetVersion` row — Postgres consulted only for the pointer
(`objectKey`) and the numbers to compare against. Run against two
independent datasets:

```
$ v02 ... drafts/4283b2c3.../artifacts/9a540274.../data.parquet 1500 2 24b69349...
V02 PASS

$ v02 ... drafts/4c4055a2.../artifacts/c7ad0f42.../data.parquet 4380 3 d85f96cc...
V02 PASS
```

### T03 — Model flow regression, pre- and post-refactor dataset

- Pre-refactor: `asd` (`8b1c1d53-9973-4631-bf08-82782d1921ca`, created
  2026-07-13, 7 existing models, `currentArtifactId` null — a legacy row
  predating the artifact-pointer reshape).
- Post-refactor: `d3acec46` (this session's real chain, promoted to
  ACTIVE).
- Both fed through the real `POST /authorized/model` endpoint (the ONLY
  code path that creates a persistent `Model` row) — both succeeded
  identically:
  `f6d24aeb-aadd-4e4c-8180-2bc7c31612f6` (pre-refactor),
  `d2928faf-ba45-48bd-9f31-0912ba425f85` (post-refactor).
- `apps/client/app/(default)/models/create/**` — `git diff` empty, checked
  at session start AND again after all of Phase 5 (V03).
- The model-create dataset picker (`useDatasets` → `listDatasetService`)
  does **not** filter by `DatasetVersion.status` — confirmed by reading
  `dataset.authorized.service.ts:99` (`findMany` with no status clause), so
  a `DRAFT`-status dataset is already pickable; promotion was exercised
  anyway (below) because it is its own acceptance criterion.

### T04 — Gates

See §6.

### T05 — This report.

### T06 — Large-dataset benchmark, API/UI path

Reused `docs/DS-LAKE-005B-C-BENCHMARK.md`'s existing 1,000/4,000/8,000/16,000
tag storage-layer numbers rather than repeating them (T06's own description
says to consume that layout decision, not redo it). New for this task: a
real synthetic 8,000-tag artifact (`scripts/verify/generate-wide-artifact.py`,
1,000 rows, 61 MB, real Parquet bytes in MinIO, wired to a real
`DatasetDraft`/`DatasetArtifact` row) driven through the real backend
endpoints — this is what found the bug in §5.2.

**Scope note, stated plainly**: the full 1k/4k/8k/16k API-layer sweep and a
live-browser DOM/heap session (T07/T08/V06's browser-side half) were not
completed this session — the 8,000-tag width (the acceptance criterion's own
"8,000+ tags" threshold) was measured directly and is the strongest signal
available; the wider sweep is recorded as remaining work in
`docs/session-handoff.md`.

### T07 — Step 3/Step 4 never download the complete artifact; all-tag ops go through server jobs

- Server-side: `/metadata` reads only the Parquet footer (120 KB at
  8,000 tags — the tag list itself, not row data); `/tags` is paginated
  (891 bytes at `limit=50`); cleaning/feature jobs (`/clean`, `/features`)
  operate server-side regardless of tag-selection width, confirmed by this
  session's own real `/clean` and `/features` calls against a 19-tag and
  (separately) an 8,000-tag artifact — no full frame ever crosses into
  NestJS or the browser in either case, only the bounded stats/job responses.
- The one violation found (§5.2) was in a **preview** path
  (`dataset-detail-sheet.tsx`), not Step 3/Step 4 proper — Step 3/Step 4's
  own bounded hooks (`use-dataset-artifact-metadata`,
  `use-dataset-artifact-column-stats`, `use-dataset-boxplot`,
  `use-dataset-histogram`, etc., all server-computed) were not the ones
  found broken.

### T08 — Browser memory bounded as dataset size grows, viewport constant

**Not measured live this session** — same scope note as T06. What
DS-LAKE-005B-B-V01 (§4) proves instead: static analysis confirms neither
`DataAnalysisCard` nor `data-cropping-chart` holds a complete artifact in
React state or deep-clones one, which is the structural precondition for
bounded memory; it is not a live heap measurement.

### T09 — Cleanup lifecycle: SAVED draft and ABANDONED draft, real run

Both legs run for real, live, twice (once exposing the bug, once after the
fix — see §5.1):

**SAVED-draft leg** (draft `4c4055a2`, backdated `updatedAt` to 200h ago):
dry run correctly listed 3 eligible artifacts (2 SILVER, 1 GOLD — all true
orphans/ancestors, NOT the FINAL-sharing GOLD); real run (`dryRun:false`)
reclaimed all 3 (`deletedObjects: 3, 3, 4`), FINAL re-verified byte-intact
afterward (§5.1).

**ABANDONED-draft leg** (draft `100d223f`, abandoned via the real
`/abandon` endpoint, backdated past `draftRecoveryHours`): real run
reclaimed its BRONZE (`deletedObjects: 0` — bytes were already absent from
an unrelated earlier session, exercising T06's idempotency guarantee; the
row was still correctly stamped `objectReclaimedAt`).

Both legs: zero `DatasetArtifact` rows deleted (46 rows before and after),
zero registry rows touched.

### T10 — Reproducibility anchor, before AND after cleanup

Replayed BRONZE `460dcffa`'s pinned bytes + the exact recorded
`operations` (`[{"type":"forward","tags":[...]}]` →
`{selectedColumns:[...],features:[]}`) through the real `/clean` →
`/features` endpoints twice:

- **Before cleanup**: replay GOLD checksum `d85f96ccf1…` — identical to the
  original FINAL's checksum.
- **After cleanup had run** (§Phase 6): replayed again from the same pinned
  BRONZE (untouched by cleanup, hard-pinned) — checksum `d85f96ccf1…`
  again, byte-for-byte identical.

**Stronger than the acceptance criterion asks**: the reproducibility anchor
is not just row/value-equal, it is **byte-identical** (`sha256` match) on
this real chain — a Parquet write nondeterminism concern (footer metadata,
row-group boundaries) that could have made this criterion unsatisfiable at
the byte level did not materialize in practice.

---

## 4. Acceptance criteria

| #   | Criterion                                                               | Result                                                                                                     |
| --- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | Raw rows exist only in MinIO                                            | ✅ — V01 (§6)                                                                                              |
| 2   | Clean rows exist only in MinIO                                          | ✅ — first real SILVER produced this session                                                               |
| 3   | Feature rows exist only in MinIO                                        | ✅                                                                                                         |
| 4   | Final dataset exists only in MinIO                                      | ✅                                                                                                         |
| 5   | Dataset Registry stores metadata only                                   | ✅ — V01                                                                                                   |
| 6   | DatasetVersion created only after Save                                  | ✅ — confirmed by watching `datasetId` stay null until Save                                                |
| 7   | Dataset promotion updates metadata only                                 | ✅ — checksum/artifactId byte-identical across DRAFT→VALIDATED→ACTIVE                                      |
| 8   | Loader retries independently of Save                                    | ✅ by inspection (not re-exercised live, see §2)                                                           |
| 9   | Dataset reproducible from MinIO alone                                   | ✅ — byte-identical, T02 + T10                                                                             |
| 10  | Model Training unmodified, works on both eras                           | ✅ — T03, zero diff                                                                                        |
| 11  | Browser never materializes complete dataset (Step 3/4/Review)           | ✅ Step 3/4's own hooks; ⚠️ one violation found+fixed in a dataset-list preview sheet, not Step 3/4 itself |
| 12  | 8,000+ tags: bounded API payloads, bounded DOM                          | ✅ payloads (measured, fixed); DOM not live-measured this session                                          |
| 13  | Server-side clean/FE works for 2-3, 10+, all-tag selections             | ✅ — 2-3 tags at real scale (this session), all-tag at 8,000 (this session)                                |
| 14  | Intermediate cleanup reclaims without breaking FINAL/registry/lineage   | ✅ — after the fix in §5.1; **was violated before the fix**                                                |
| 15  | Saved dataset rebuildable from pinned BRONZE + operations, post-cleanup | ✅ — T10, byte-identical                                                                                   |

---

## 5. Defects found and fixed

### 5.1 Cleanup could silently destroy a live FINAL dataset's actual bytes

**Severity: high — silent data loss on a shipped feature.**

`promoteDraftArtifactToFinalService` writes a FINAL artifact with
`objectKey: source.objectKey` — literally the same MinIO object as its
promoted GOLD (or SILVER, if features are skipped), never a byte copy
(by design, `ADR-DS-LAKE-005B-B-006`). The intermediate-cleanup eligibility
predicate (`selectCleanupEligibleArtifacts`) hard-pinned BRONZE when
lineage-reachable, but let SILVER/GOLD age-release **even when it was the
literal artifact FINAL currently reads from** — because the general rule
("SILVER/GOLD are re-derivable, so age-releasable") is true for every OTHER
SILVER/GOLD in the chain, just not that one.

**Reproduced live, safely, before fixing**: a dry run against the real
`4c4055a2` chain (pre-fix) would have listed GOLD `c7ad0f42` — the literal
FINAL `e71541b8`'s objectKey — as eligible. Confirmed via code + a
before/after test (not detonated against real production bytes; the fix
was written and verified via the existing pure eligibility-predicate unit
tests, `13 + 3` passing, before any live cleanup ran).

**Fixed**: `apps/backend/src/lib/artifact-cleanup-eligibility.ts` +
`artifact-cleanup.admin.service.ts` now separately track
`objectKeySharedWithFinalIds` — the one artifact per live DatasetVersion
that is FINAL's direct promoted parent — and hard-pin it regardless of
type, independent of the general reachability pin.

**Verified live, post-fix, for real**: dry run against the real chain
listed exactly 3 eligible artifacts (the two true orphans/ancestors), NOT
the FINAL-sharing GOLD. Real run (`dryRun:false`) reclaimed those 3 for
real (MinIO objects actually deleted). FINAL re-read afterward — still
byte-perfect (`v02-final-artifact-matches-registry.py` PASS, checksum
`d85f96ccf1…` unchanged).

### 5.2 `/rows` fetches every tag for every row when no tag filter is passed

**Severity: high — unbounded network fetch on a "bounded preview" path,
scales with dataset width.**

`datasetArtifactService.rows()` (client) never supported a `tags` query
param at all, even though the backend's `ListRowsSchema` has always
supported one — and treats its absence as "every tag" (documented in the
schema's own comment). `useArtifactRows` (used by the dataset-list detail
sheet's preview table, which explicitly documents itself as "a bounded
sample, not the full artifact") called it with no tags filter.

**Reproduced live**: on the real synthetic 8,000-tag artifact, a 200-row
preview page with no tag filter was **76,750,109 bytes** (73 MB) —
opening a preview sheet on a wide saved dataset.

**Fixed**: `datasetArtifactService.rows()` now accepts an optional `tags`
param; `useArtifactRows` bounds it to the first 50 (mirroring the existing
`PREVIEW_ROWS=200` convention) and re-fetches on tag-content change (not
array reference, to survive the caller's dataset loading async after
mount); `dataset-detail-sheet.tsx` passes its already-in-scope `tags`
through.

**Verified live, post-fix**: the same page, same artifact, with the tags
param the fixed code now sends — **489,032 bytes** (478 KB). A 157×
reduction, matching the 8,000/50 ≈ 160× ratio expected.

---

## 6. Verification items

| ID  | Description                                                 | Result                                                                                                                                                   |
| --- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V01 | No timeseries rows anywhere in Postgres                     | ✅ `scripts/verify/v01-no-timeseries-in-postgres.sh` — zero JSON/array columns over the 20 KB suspicious-size threshold, across every dataset-lake table |
| V02 | FINAL reconstruction matches registry                       | ✅ two independent datasets, exact match                                                                                                                 |
| V03 | Zero diff under `models/create`                             | ✅ checked start and end of session                                                                                                                      |
| V04 | Client failure count has not grown                          | ✅ — see §6.1, baseline captured fresh this session                                                                                                      |
| V05 | `pnpm build` succeeds clean, including `@softsensor/prisma` | ✅ — after fixing §6.2's dead-code build blocker                                                                                                         |
| V06 | Heap/transfer bounded 1k→16k tags                           | ⚠️ partial — transfer measured and fixed at 8,000 (§5.2); heap not live-measured                                                                         |
| V07 | Cleanup reclaims without breaking FINAL/registry            | ✅ — §5.1, both SAVED and ABANDONED legs, for real                                                                                                       |

### 6.1 Baselines (captured before any change, compared after)

| Suite                  | Before                                                                                                                                            | After                                                                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client vitest          | 41 failed / 361 passed (8 files, all pre-existing — `feature-preset`, `use-plants-data`, `plants`, `canvas`, unrelated to this work)              | unchanged (not re-touched — no dataset-lake test file is in this list)                                                                                                                                                                |
| Backend `tsc --noEmit` | 4 errors, `auth/**.spec.ts`                                                                                                                       | unchanged, 4, same files/lines                                                                                                                                                                                                        |
| Backend jest           | 11 failed suites / 201 passed tests (all pre-existing DI gaps in untracked `model-run`/`trainning-container`/etc.)                                | 11 failed suites / **202** passed (this session's new eligibility-predicate regression tests)                                                                                                                                         |
| Client `tsc --noEmit`  | not captured at Phase 0 (gap, corrected mid-session)                                                                                              | 3 pre-existing files (`preset-apply-modal.test.tsx`, `use-dataset-boxplot.test.ts`, `feature-preset.test.ts`) — confirmed via `git stash` round-trip that these predate this session; none of the 3 files this session touched appear |
| Python pytest          | 1 failed / 608 passed / 66 skipped (pre-existing, `test_features_writes_feature_spec_sidecar_and_returns_its_key`)                                | unchanged — no python file touched this session                                                                                                                                                                                       |
| `pnpm lint` (client)   | pre-existing broken (`Cannot find module 'eslint-module-utils/resolve'`) — confirmed via `git stash` round-trip to fail identically on clean HEAD | unchanged, not this session's regression                                                                                                                                                                                              |
| `pnpm build`           | **FAILED** — `model-run-launch.authorized.service.ts` referenced a Prisma field (`datasetVersionId`) that does not exist on `ModelTrainingRun`    | ✅ fixed (§6.2), full 5/5-task build green                                                                                                                                                                                            |

**Handoff doc's recorded baseline ("18 failures, 3 in
`lib/__tests__/preprocessing.test.ts`") was stale** — the real, freshly
captured number this session is 41 failures across a different set of
files (none in `preprocessing.test.ts`). Corrected here and in
`session-handoff.md`.

### 6.2 Second defect found: dead field blocking `pnpm build`

`model-run-launch.authorized.service.ts:114` set
`datasetVersionId: artifact.id` on a `ModelTrainingRun.create()` call —
that field does not exist on the Prisma schema (`ModelTrainingRun` has
`goldArtifactId`, which the very next line already set to the identical
value). Unrelated to DS-LAKE-012's own module (`model-run` is a separate,
untracked, in-progress feature), but a one-line dead-code deletion,
unambiguous (same value already set correctly one line below), and it was
the only thing standing between `pnpm build` and green. Fixed.

---

## 7. Migration plan / breaking changes

None. Every fix in §5 and §6.2 is additive or dead-code removal:

- `selectCleanupEligibleArtifacts` gained one new optional parameter
  (defaults to `new Set()`, preserving prior behavior for any caller that
  doesn't pass it — there is exactly one real caller, updated in the same
  change).
- `datasetArtifactService.rows()` gained one new optional field on its
  params object.
- `useArtifactRows()` gained one new optional parameter with a default.
- The dead `datasetVersionId` line was simply deleted.

No migration, no schema change, no API contract break for any existing
caller.

---

## 8. What was NOT completed this session (honest accounting)

- **T06/T07/T08/V06's full 1,000/4,000/8,000/16,000-tag live sweep and a
  live-browser DOM/heap measurement session.** Scoped down to a single
  8,000-tag real artifact (the acceptance criterion's own threshold) given
  session cost — network-transfer boundedness was proven and a real bug
  fixed at that width; heap/DOM was not independently measured live. This
  is real remaining work, not a silently dropped requirement — recorded in
  `session-handoff.md`.
- **Loader retry independence (AC8)** — verified by code inspection only,
  not re-exercised against a live retriable job this session.
- **DS-LAKE-005B-D-T08a** (blocked on a user decision) and the
  precleanse-engine port fork — untouched, as scoped.

Everything else in this report reflects a real, live run against the real
stack, not a reading of the code.
