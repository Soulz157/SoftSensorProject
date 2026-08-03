-- CreateEnum
CREATE TYPE "DatasetVersionStage" AS ENUM ('RAW', 'CLEAN', 'FEATURE');

-- CreateEnum
CREATE TYPE "PreprocessingJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- AlterTable
ALTER TABLE "Dataset" ADD COLUMN     "currentVersionId" TEXT;

-- CreateTable
CREATE TABLE "DatasetVersion" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "parentVersionId" TEXT,
    "versionNumber" INTEGER NOT NULL,
    "stage" "DatasetVersionStage" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'parquet',
    "columnCount" INTEGER NOT NULL DEFAULT 0,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "missingPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "operations" JSONB NOT NULL,
    "columnStats" JSONB,
    "durationMs" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DatasetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreprocessingJob" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "sourceVersionId" TEXT,
    "resultVersionId" TEXT,
    "status" "PreprocessingJobStatus" NOT NULL DEFAULT 'QUEUED',
    "stage" "DatasetVersionStage" NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStep" TEXT,
    "totalSteps" INTEGER NOT NULL DEFAULT 0,
    "completedSteps" INTEGER NOT NULL DEFAULT 0,
    "estimatedRemainingMs" INTEGER,
    "operations" JSONB NOT NULL,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreprocessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DatasetVersion_datasetId_idx" ON "DatasetVersion"("datasetId");

-- CreateIndex
CREATE INDEX "DatasetVersion_parentVersionId_idx" ON "DatasetVersion"("parentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "DatasetVersion_datasetId_versionNumber_key" ON "DatasetVersion"("datasetId", "versionNumber");

-- CreateIndex
CREATE INDEX "PreprocessingJob_datasetId_idx" ON "PreprocessingJob"("datasetId");

-- CreateIndex
CREATE INDEX "PreprocessingJob_status_idx" ON "PreprocessingJob"("status");

-- AddForeignKey
ALTER TABLE "DatasetVersion" ADD CONSTRAINT "DatasetVersion_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetVersion" ADD CONSTRAINT "DatasetVersion_parentVersionId_fkey" FOREIGN KEY ("parentVersionId") REFERENCES "DatasetVersion"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DatasetVersion" ADD CONSTRAINT "DatasetVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreprocessingJob" ADD CONSTRAINT "PreprocessingJob_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreprocessingJob" ADD CONSTRAINT "PreprocessingJob_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "DatasetVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreprocessingJob" ADD CONSTRAINT "PreprocessingJob_resultVersionId_fkey" FOREIGN KEY ("resultVersionId") REFERENCES "DatasetVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreprocessingJob" ADD CONSTRAINT "PreprocessingJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
