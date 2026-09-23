-- Retrain: operator-defined NEW-DATA validation holdout.
--
-- NON-DESTRUCTIVE. Four nullable columns, no default, no backfill, no index.
-- Every existing row keeps NULL, which is the correct and intended reading:
-- "this run requested no new-data validation window". No existing column is
-- touched and no row is rewritten, so this is safe to apply to a live table.
--
-- Why these are separate columns rather than merged into `holdoutMetrics`:
-- `holdoutMetrics` carries the FROZEN incumbent-test slice, which is all OLD
-- rows and is what makes `rmseDelta` comparable against the incumbent. These
-- columns carry a score over NEW rows, which the incumbent was never scored
-- on. Blending the two would silently corrupt every retrain comparison, and
-- differencing this figure against the incumbent's metrics is meaningless by
-- construction — it is reported on its own.
--
-- `newDataHoldoutFrom`/`To` record the MEASURED first/last timestamps of the
-- rows actually held out, not the bounds the operator requested; the two are
-- different facts and the UI states what was measured.

ALTER TABLE "ModelTrainingRun"
  ADD COLUMN "newDataHoldoutMetrics"  JSONB,
  ADD COLUMN "newDataHoldoutRowCount" INTEGER,
  ADD COLUMN "newDataHoldoutFrom"     TIMESTAMP(3),
  ADD COLUMN "newDataHoldoutTo"       TIMESTAMP(3);
