-- MODEL-SERVE-043. A sequence model's lead-in rows (context.parquet) for
-- one hourly window. Null for every non-sequence model.
ALTER TABLE "InferenceWindow" ADD COLUMN "contextKey" TEXT;
ALTER TABLE "InferenceWindow" ADD COLUMN "contextChecksum" TEXT;
