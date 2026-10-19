-- MODEL-FLOW-035. Which metric a candidate job picks its winner by.
-- Existing rows and every retrain job keep 'rmse', the only metric the
-- service ranked by before this column.
--
-- Hand-written, NOT produced by `prisma migrate dev` (history drift makes it
-- offer a reset). Applied by hand to the local DB and not recorded in
-- _prisma_migrations, like the other hand-applied migrations here.
ALTER TABLE "ModelCandidateJob" ADD COLUMN "rankingMetric" TEXT NOT NULL DEFAULT 'rmse';
