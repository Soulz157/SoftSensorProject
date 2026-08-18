# DS-LAKE-012 verification scripts

One-shot scripts written for the DS-LAKE-012 end-to-end verification pass. Each targets
the live stack (`docker compose` Postgres + MinIO, backend on :4000, python on :8000) —
none of them mock anything. Full results are written up in
`docs/DS-LAKE-012-VERIFICATION.md`; this directory holds the how, that file holds the what.

Run each script with `.env` sourced (`DATABASE_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY`,
`S3_SECRET_KEY`, `S3_BUCKET`).

## Baseline (Phase 0) — captured 2026-08-17, before any DS-LAKE-012 change

| Suite                  | Result                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client vitest          | 41 failed / 361 passed (402 total), 8 failing files — none under `data-studio/` except one pre-existing unrelated `preset-apply-modal.test.tsx` case. **Not the 18 the handoff doc recorded** — the doc's number is stale; this is the real baseline for V04.                                                                                                             |
| Backend `tsc --noEmit` | 4 errors, all in `auth/**.spec.ts` — matches the handoff's recorded baseline exactly.                                                                                                                                                                                                                                                                                     |
| Backend jest           | 11 failed suites (22 duplicate-path listings) / 31 passed, 201 passed tests / 11 failed. All failures are DI-wiring gaps in **untracked, in-progress** modules (`model-run`, `trainning-container`, `nodes`, `workspace`, `workspace-plant`, `auth/public`, `auth/admin`, `plan/admin`) — none touch `dataset-draft`, `dataset-version`, `loader`, or `artifact-cleanup`. |
| Python pytest          | 1 failed / 608 passed / 66 skipped. Failure (`test_artifact_service_features.py::test_features_writes_feature_spec_sidecar_and_returns_its_key`) asserts `column_stats_key is None` on GOLD but got a populated key — pre-existing, unrelated to this verification pass.                                                                                                  |

V04's bar is these numbers not growing, not reaching zero.

## Scripts

- `invariants.ts` — DS-LAKE-012-V01 (no timeseries rows anywhere in Postgres) and V02
  (FINAL artifact in MinIO matches the registry's rowCount/featureCount/checksum).
- `rebuild-from-minio.ts` — T02 (rebuild from MinIO alone) and T10 (replay BRONZE +
  recorded operations, compare against FINAL).
- `generate-wide-artifact.py` — 1,000/4,000/8,000/16,000-tag synthetic artifact generator
  for the T06 benchmark, same methodology as `docs/DS-LAKE-005B-C-BENCHMARK.md`.
- `force-cleanup-eligibility.ts` — backdates/lowers retention so T09/V07's cleanup run
  reclaims something real instead of passing vacuously.
