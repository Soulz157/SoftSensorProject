-- MODEL-SERVE-001-T25. Enable-time preflight evidence.
--
-- All three columns are NULLABLE and there is NO BACKFILL. A schedule enabled
-- before this migration was never probed, and `preflightOk = NULL` says exactly
-- that. Defaulting it to true would assert an observation that never happened;
-- defaulting it to false would read every existing live schedule as Failed.
-- `classifyDeployStatus` treats NULL as not-probed, never as a verdict.

-- AlterTable
ALTER TABLE "InferenceSchedule" ADD COLUMN     "preflightAt" TIMESTAMP(3),
ADD COLUMN     "preflightOk" BOOLEAN,
ADD COLUMN     "preflightReason" TEXT;
