-- MODEL-SERVE-008-T02. The live prediction driver's own switch, cadence and
-- last-run marker on InferenceSchedule.
--
-- WRITTEN AND APPLIED BY HAND RATHER THAN BY `prisma migrate dev`, on
-- purpose and without touching migration history: this database carries
-- PRE-EXISTING drift (migration 20260825030923_model_flow_005_fine_tuning_job
-- was edited after it had been applied, so its checksum no longer matches),
-- and `migrate dev`'s only offered remedy for that is `migrate reset` — which
-- drops the database. The live database holds 391 real training runs and the
-- whole inference-window record, so a reset is not an acceptable way to add
-- three columns. `migrate diff` against the live datasource produced exactly
-- and only the three ADD COLUMNs below, confirming nothing else diverges.
--
-- Every column is additive with a default, so this is safe to apply to a
-- populated table and safe to re-run after the pre-existing drift is fixed.
ALTER TABLE "InferenceSchedule" ADD COLUMN     "livePredictCadenceMinutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "livePredictEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "livePredictLastRunAt" TIMESTAMP(3);
