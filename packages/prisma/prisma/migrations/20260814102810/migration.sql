-- CreateEnum
CREATE TYPE "ModelRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateTable
CREATE TABLE "ModelTrainingRun" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "datasetVersionId" TEXT NOT NULL,
    "goldArtifactId" TEXT NOT NULL,
    "goldObjectKey" TEXT NOT NULL,
    "artifactChecksum" TEXT NOT NULL,
    "featureSpecKey" TEXT,
    "targetY" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "hyperparameters" JSONB NOT NULL,
    "seed" INTEGER NOT NULL,
    "splitSpec" JSONB NOT NULL,
    "imageDigest" TEXT NOT NULL,
    "containerId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "status" "ModelRunStatus" NOT NULL DEFAULT 'QUEUED',
    "failureReason" TEXT,
    "modelKey" TEXT,
    "metricsKey" TEXT,
    "manifestKey" TEXT,
    "predictionsKey" TEXT,
    "metrics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ModelTrainingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelTrainingRunLog" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelTrainingRunLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModelTrainingRun_modelId_createdAt_idx" ON "ModelTrainingRun"("modelId", "createdAt");

-- CreateIndex
CREATE INDEX "ModelTrainingRun_status_idx" ON "ModelTrainingRun"("status");

-- CreateIndex
CREATE INDEX "ModelTrainingRunLog_runId_createdAt_idx" ON "ModelTrainingRunLog"("runId", "createdAt");

-- AddForeignKey
ALTER TABLE "ModelTrainingRun" ADD CONSTRAINT "ModelTrainingRun_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelTrainingRunLog" ADD CONSTRAINT "ModelTrainingRunLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ModelTrainingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
