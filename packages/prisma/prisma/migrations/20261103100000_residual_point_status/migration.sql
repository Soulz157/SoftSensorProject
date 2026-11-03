-- MODEL-SERVE-046. Per-point residual status.
-- The window's worst single |predicted - actual|, beside the pooled sums that
-- cannot say whether ONE point fell beyond k x SD.
ALTER TABLE "InferenceWindowTruth"
  ADD COLUMN IF NOT EXISTS "maxAbsResidual" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- warnSd / criticalSd are now POINT multipliers: beyond 2 SD warns, beyond
-- 3 SD alerts. Move schedules still on the old spread-ratio default.
ALTER TABLE "InferenceSchedule" ALTER COLUMN "warnSd" SET DEFAULT 2;
UPDATE "InferenceSchedule" SET "warnSd" = 2 WHERE "warnSd" = 1.5;
