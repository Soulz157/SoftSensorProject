-- MODEL-SERVE-025-D01. The workspace canvas page was removed, and with it the
-- only reader and writer of "Edge" (pipeline connections drawn on the
-- canvas). Dropped with its data, per the user's explicit confirmation
-- (2026-10-01; 2 rows locally).
--
-- Hand-written, NOT produced by `prisma migrate dev`: migration history in
-- this repo has drift, so `migrate dev` offers only `migrate reset` (drops the
-- dev DB). Generated with `prisma migrate diff --from-config-datasource
-- --to-schema`, then trimmed to this change only — that diff also proposed
-- `ALTER TABLE "InferenceSchedule" DROP COLUMN "driftThresholdPct"`, which is
-- unrelated drift and deliberately NOT included here.

-- DropForeignKey
ALTER TABLE "Edge" DROP CONSTRAINT "Edge_workspaceId_fkey";

-- DropTable
DROP TABLE "Edge";
