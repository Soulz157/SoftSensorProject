-- MODEL-SERVE-026-T05. Expanding folds for a retrain job's CV-GAP measurement
-- (every candidate also refits its configuration per fold and is scored beside
-- the current version — images/trainer/app/pipelines/cv_gap.py). Nullable:
-- every existing job reads as "no CV", which is what it was.
--
-- Hand-written, NOT produced by `prisma migrate dev`: migration history in
-- this repo has drift, so `migrate dev` offers only `migrate reset` (drops the
-- dev DB). Generated with `prisma migrate diff --from-config-datasource
-- --to-schema`, then trimmed to this change only — that diff also proposed
-- `ALTER TABLE "InferenceSchedule" DROP COLUMN "driftThresholdPct"`, which is
-- unrelated drift and deliberately NOT included here (same as 025's own note).

-- AlterTable
ALTER TABLE "ModelCandidateJob" ADD COLUMN     "cvFolds" INTEGER;
