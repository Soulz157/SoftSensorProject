-- MODEL-SERVE-042. When a schedule last went OFF -> ON; the scheduler starts
-- hourly windows from here instead of the 48 h backfill horizon.
ALTER TABLE "InferenceSchedule" ADD COLUMN "enabledAt" TIMESTAMP(3);

-- Existing rows: the deploy stamp is the closest record of the last Start.
UPDATE "InferenceSchedule" s
SET "enabledAt" = (m."data"->>'deployedAt')::timestamptz
FROM "Model" m
WHERE m."id" = s."modelId"
  AND m."data"->>'deployedAt' IS NOT NULL;
