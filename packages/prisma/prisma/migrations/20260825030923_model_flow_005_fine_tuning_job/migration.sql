-- CreateEnum
CREATE TYPE "ModelFineTuningJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- AlterTable
ALTER TABLE "ModelTrainingRun" ADD COLUMN     "fineTuningJobId" TEXT;

-- CreateTable
CREATE TABLE "ModelFineTuningJob" (
    "id" TEXT NOT NULL,
    "modelDraftId" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "targetY" TEXT NOT NULL,
    "goldArtifactId" TEXT NOT NULL,
    "trainTestSplit" DOUBLE PRECISION,
    "hyperparameterSets" JSONB NOT NULL,
    "totalRuns" INTEGER NOT NULL,
    "completedRuns" INTEGER NOT NULL DEFAULT 0,
    "status" "ModelFineTuningJobStatus" NOT NULL DEFAULT 'QUEUED',
    "failureReason" TEXT,
    "currentRunId" TEXT,
    "bestRunId" TEXT,
    "bestRmse" DOUBLE PRECISION,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ModelFineTuningJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModelFineTuningJob_modelDraftId_idx" ON "ModelFineTuningJob"("modelDraftId");

-- CreateIndex
CREATE INDEX "ModelFineTuningJob_status_idx" ON "ModelFineTuningJob"("status");

-- CreateIndex
CREATE INDEX "ModelTrainingRun_fineTuningJobId_idx" ON "ModelTrainingRun"("fineTuningJobId");

-- AddForeignKey
ALTER TABLE "ModelTrainingRun" ADD CONSTRAINT "ModelTrainingRun_fineTuningJobId_fkey" FOREIGN KEY ("fineTuningJobId") REFERENCES "ModelFineTuningJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelFineTuningJob" ADD CONSTRAINT "ModelFineTuningJob_modelDraftId_fkey" FOREIGN KEY ("modelDraftId") REFERENCES "ModelDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelFineTuningJob" ADD CONSTRAINT "ModelFineTuningJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-added, same precedent as migrations/20260818021900_model_flow_002_owner_check:
-- Prisma's schema DSL cannot express a partial unique index, so this is not
-- generated. At most one QUEUED or RUNNING fine-tuning job may exist per
-- draft, enforced at the database, not in service code — the same class of
-- concurrent-request hole a service-level check cannot close (two overlapping
-- POST /fine-tuning requests racing past an application check both succeed;
-- a database constraint cannot).
CREATE UNIQUE INDEX "ModelFineTuningJob_one_live_per_draft"
  ON "ModelFineTuningJob"("modelDraftId")
  WHERE "status" IN ('QUEUED', 'RUNNING');
