-- MODEL-FLOW-016-T04/T07. Two nullable columns on ModelTrainingRun:
--   cvFoldsKey          object-storage key for cv_folds.json (T04), set
--                       only for a CV run — same honest-legacy-null pattern
--                       lossHistoryKey already uses.
--   scoringContainerId  the container currently running this run's
--                       separate, user-triggered holdout-scoring phase
--                       (T07) — distinct from containerId, which tracks
--                       the training spawn.
-- Both additive, both nullable, no default — NULL is the correct value for
-- every existing row (a run predating this feature simply never had either
-- concept).
ALTER TABLE "ModelTrainingRun" ADD COLUMN "cvFoldsKey" TEXT;
ALTER TABLE "ModelTrainingRun" ADD COLUMN "scoringContainerId" TEXT;
