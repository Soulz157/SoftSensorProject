-- CONTAINER-QUEUE-001. A scoring request waiting for compute capacity.
ALTER TABLE "ModelTrainingRun" ADD COLUMN "scoringQueuedAt" TIMESTAMP(3);
