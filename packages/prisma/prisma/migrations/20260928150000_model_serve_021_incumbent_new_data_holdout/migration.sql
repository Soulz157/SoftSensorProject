-- MODEL-SERVE-021. The current PRODUCTION model's score on the same
-- new-data validation window a New Data Only (replace) candidate is scored
-- on -- the only comparison basis left now that this strategy carves no
-- frozen slice. Nullable, additive; no backfill.
ALTER TABLE "ModelTrainingRun" ADD COLUMN "incumbentNewDataHoldoutMetrics" JSONB;
ALTER TABLE "ModelTrainingRun" ADD COLUMN "incumbentNewDataHoldoutPredictionsKey" TEXT;
