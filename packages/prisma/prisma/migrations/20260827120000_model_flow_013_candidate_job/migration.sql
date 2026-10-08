-- MODEL-FLOW-013-T03. Generalizes ModelFineTuningJob (one algorithm, N
-- hyperparameter sets) into ModelCandidateJob (N candidates, each carrying
-- its own algorithm) so an algorithm sweep ("Find Best Model") reuses the
-- exact same compare-and-swap orchestrator MODEL-FLOW-005 built and
-- live-verified, instead of a second table.
--
-- Hand-written, not `prisma migrate dev`-generated: existing rows'
-- hyperparameterSets has no embedded algorithm (it lived separately on
-- job.algorithm), so this is a data migration, not a pure rename. Applied
-- via `prisma db execute` in this session — see this feature's progress_note
-- for why `prisma migrate dev` itself could not be run cleanly (pre-existing,
-- unrelated DatasetArtifact.droppedBadRows drift in the dev DB with no
-- migration file, not caused by and not fixed in this pass).

-- ── 1. New enum for the job's kind ──────────────────────────────────────
CREATE TYPE "ModelCandidateJobKind" AS ENUM ('HYPERPARAMETER_SEARCH', 'ALGORITHM_SWEEP');

-- ── 2. Add the new columns nullable first ───────────────────────────────
ALTER TABLE "ModelFineTuningJob" ADD COLUMN "candidates" JSONB;
ALTER TABLE "ModelFineTuningJob" ADD COLUMN "kind" "ModelCandidateJobKind";
ALTER TABLE "ModelFineTuningJob" ADD COLUMN "selectedRunId" TEXT;

-- ── 3. Backfill: candidates[i] = hyperparameterSets[i] merged with the
--    job's own (single, shared) algorithm; kind = HYPERPARAMETER_SEARCH for
--    every existing row, since algorithm-varying jobs did not exist before
--    this migration. ──────────────────────────────────────────────────────
UPDATE "ModelFineTuningJob"
SET
  "candidates" = (
    SELECT jsonb_agg(elem || jsonb_build_object('algorithm', "algorithm"))
    FROM jsonb_array_elements("hyperparameterSets") AS elem
  ),
  "kind" = 'HYPERPARAMETER_SEARCH';

-- ── 4. Tighten to NOT NULL now that every row has a value ───────────────
ALTER TABLE "ModelFineTuningJob" ALTER COLUMN "candidates" SET NOT NULL;
ALTER TABLE "ModelFineTuningJob" ALTER COLUMN "kind" SET NOT NULL;
ALTER TABLE "ModelFineTuningJob" ALTER COLUMN "kind" SET DEFAULT 'HYPERPARAMETER_SEARCH';

-- ── 5. Drop the columns candidates[] now supersedes ─────────────────────
ALTER TABLE "ModelFineTuningJob" DROP COLUMN "algorithm";
ALTER TABLE "ModelFineTuningJob" DROP COLUMN "hyperparameterSets";

-- ── 6. ModelTrainingRun: add lossHistoryKey (MODEL-FLOW-013-T05) and
--    rename fineTuningJobId -> candidateJobId ───────────────────────────
ALTER TABLE "ModelTrainingRun" ADD COLUMN "lossHistoryKey" TEXT;
ALTER TABLE "ModelTrainingRun" RENAME COLUMN "fineTuningJobId" TO "candidateJobId";

-- ── 7. Rename the table, its status enum, and dependent objects ─────────
ALTER TABLE "ModelFineTuningJob" RENAME TO "ModelCandidateJob";
ALTER TYPE "ModelFineTuningJobStatus" RENAME TO "ModelCandidateJobStatus";

ALTER TABLE "ModelCandidateJob" RENAME CONSTRAINT "ModelFineTuningJob_pkey" TO "ModelCandidateJob_pkey";
ALTER TABLE "ModelCandidateJob" RENAME CONSTRAINT "ModelFineTuningJob_modelDraftId_fkey" TO "ModelCandidateJob_modelDraftId_fkey";
ALTER TABLE "ModelCandidateJob" RENAME CONSTRAINT "ModelFineTuningJob_createdById_fkey" TO "ModelCandidateJob_createdById_fkey";

ALTER INDEX "ModelFineTuningJob_modelDraftId_idx" RENAME TO "ModelCandidateJob_modelDraftId_idx";
ALTER INDEX "ModelFineTuningJob_status_idx" RENAME TO "ModelCandidateJob_status_idx";
ALTER INDEX "ModelTrainingRun_fineTuningJobId_idx" RENAME TO "ModelTrainingRun_candidateJobId_idx";

ALTER TABLE "ModelTrainingRun" RENAME CONSTRAINT "ModelTrainingRun_fineTuningJobId_fkey" TO "ModelTrainingRun_candidateJobId_fkey";

-- ── 8. Recreate the partial unique index under its new name — the actual
--    guarantee (at most one QUEUED/RUNNING job per draft) is unchanged.
--    Same hand-added precedent as migrations/20260818021900_model_flow_002
--    _owner_check and the original .../20260825030923_model_flow_005_
--    fine_tuning_job — Prisma's schema DSL cannot express a partial index. ─
DROP INDEX "ModelFineTuningJob_one_live_per_draft";
CREATE UNIQUE INDEX "ModelCandidateJob_one_live_per_draft"
  ON "ModelCandidateJob"("modelDraftId")
  WHERE "status" IN ('QUEUED', 'RUNNING');
