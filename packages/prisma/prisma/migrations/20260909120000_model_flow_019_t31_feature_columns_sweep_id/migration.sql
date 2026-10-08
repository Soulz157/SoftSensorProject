-- MODEL-FLOW-019-T31. Applied via `prisma db execute --file` in this session,
-- not `prisma migrate dev` directly — the SAME pre-existing, unrelated
-- DatasetArtifact.droppedBadRows drift that
-- 20260827120000_model_flow_013_candidate_job,
-- 20260828140000_model_flow_013_t11_sweep_then_tune,
-- 20260831180000_model_flow_011_t01_objects_reclaimed_at,
-- 20260901000000_model_flow_014_split_stats,
-- 20260901090000_model_serve_001_model_version and
-- 20260906120000_model_flow_020_candidate_job_sized_figures each already
-- document forced onto that same path. `prisma migrate dev` offered only a
-- full reset of a database holding 252 real training runs and the five feature
-- specs MODEL-FLOW-019-T32's own finding was measured against, which is not a
-- trade this migration is worth.
--
-- Drift re-confirmed harmless before applying, exactly as those six did:
-- `prisma migrate diff --from-config-datasource --to-schema` against the LIVE
-- database rendered these two ALTERs and this one index and nothing else.
-- Marked applied via `prisma migrate resolve` afterward.
--
-- Purely additive: two nullable columns, no default, no backfill, no existing
-- row rewritten. Every run predating this migration reads NULL in both, which
-- is the honest "every column the artifact offers" / "not part of a sweep"
-- state — never a trigger to reconstruct either from an artifact (see the
-- schema.prisma doc comments on these fields).
--
-- The index is compound on (modelDraftId, sweepId) because a sweep is always
-- read within the draft that launched it, never across drafts.

-- AlterTable
ALTER TABLE "ModelTrainingRun" ADD COLUMN     "featureColumns" JSONB,
ADD COLUMN     "sweepId" TEXT;

-- CreateIndex
CREATE INDEX "ModelTrainingRun_modelDraftId_sweepId_idx" ON "ModelTrainingRun"("modelDraftId", "sweepId");
