-- MODEL-FLOW-020-T04/T02. Applied via `prisma db execute --file` in this
-- session, not `prisma migrate dev` directly — the SAME pre-existing,
-- unrelated DatasetArtifact.droppedBadRows drift that
-- 20260827120000_model_flow_013_candidate_job,
-- 20260828140000_model_flow_013_t11_sweep_then_tune,
-- 20260831180000_model_flow_011_t01_objects_reclaimed_at,
-- 20260901000000_model_flow_014_split_stats and
-- 20260901090000_model_serve_001_model_version each already document forced
-- onto that same path. `prisma migrate dev` offered only a full reset of a
-- database holding 175 real training runs and 55 artifacts, which is not a
-- trade this migration is worth.
--
-- Drift re-confirmed harmless before applying, exactly as those five did:
-- `prisma migrate diff --from-config-datasource --to-schema` against the LIVE
-- database rendered these two ALTERs and nothing else. Marked applied via
-- `prisma migrate resolve` afterward.
--
-- Purely additive: two nullable columns, no default, no backfill, no existing
-- row rewritten. Every job predating this migration reads NULL in both, which
-- is the honest "not captured" state and never a trigger to reconstruct the
-- figures from an artifact (see the schema.prisma doc comment on these fields).

-- AlterTable
ALTER TABLE "ModelCandidateJob" ADD COLUMN     "sizedDistinctLabelled" INTEGER,
ADD COLUMN     "sizedRowCount" INTEGER;
