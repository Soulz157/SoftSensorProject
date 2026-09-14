-- MODEL-SERVE-005-T03 follow-up: let a FAILED truth join leave a row.
--
-- Without a row, `InferenceTruthSweeperService.findDueWindows` keeps
-- selecting the window (its `truth: { is: null }` branch) and, ordering
-- windowStart ASC, keeps it at the head of every sweep. A window that can
-- never join — a ModelVersion whose sourceRun.targetY is null, a deleted
-- DataSource, an unsupported source type — would therefore consume the
-- batch forever and starve every newer window behind it.
--
-- `targetColumn` becomes nullable because resolving the target is itself
-- one of the things that can fail; every row carrying pairs (n > 0) still
-- has one. Nullable is a WIDENING, so existing rows need no backfill.

ALTER TABLE "InferenceWindowTruth" ALTER COLUMN "targetColumn" DROP NOT NULL;

ALTER TABLE "InferenceWindowTruth" ADD COLUMN "failureReason" TEXT;
