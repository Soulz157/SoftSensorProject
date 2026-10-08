-- MODEL-SERVE-022-D-FOCUS. A notification channel's model filter becomes an
-- explicit FOCUS allow-list (`focusModelIds`), replacing the `mutedModelIds`
-- exclude list.
--
-- Hand-written, NOT produced by `prisma migrate dev`: migration history in
-- this repo has drift, so `migrate dev` offers only `migrate reset` (drops the
-- dev DB). Generated with `prisma migrate diff --from-config-datasource
-- --to-schema`, then trimmed to this change only — that diff also proposed
-- `ALTER TABLE "InferenceSchedule" DROP COLUMN "driftThresholdPct"`, which is
-- unrelated drift and deliberately NOT included here.
--
-- The backfill keeps every existing channel's behaviour on the day this ships:
-- "every model except the muted ones" becomes the explicit list of the
-- workspace's models minus the muted ones.

-- AlterTable
ALTER TABLE "NotificationChannel" ADD COLUMN "focusModelIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill
UPDATE "NotificationChannel" AS c
SET "focusModelIds" = COALESCE(
  (
    SELECT array_agg(m."id" ORDER BY m."createdAt")
    FROM "Model" AS m
    WHERE m."workspaceId" = c."workspaceId"
      AND NOT (m."id" = ANY (COALESCE(c."mutedModelIds", ARRAY[]::TEXT[])))
  ),
  ARRAY[]::TEXT[]
);

-- AlterTable
ALTER TABLE "NotificationChannel" DROP COLUMN "mutedModelIds";
