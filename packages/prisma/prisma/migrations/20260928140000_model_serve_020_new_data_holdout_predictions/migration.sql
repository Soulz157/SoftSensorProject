-- MODEL-SERVE-020-T06. Object key of the per-row series the candidate produced
-- on the operator's new-data window (new_data_holdout_predictions.parquet).
-- Nullable, additive; no backfill — runs from before this column have no such
-- series and say so rather than having one reconstructed.
ALTER TABLE "ModelTrainingRun" ADD COLUMN "newDataHoldoutPredictionsKey" TEXT;
