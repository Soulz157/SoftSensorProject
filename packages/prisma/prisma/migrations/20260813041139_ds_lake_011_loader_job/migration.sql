-- CreateEnum
CREATE TYPE "LoaderJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateTable
CREATE TABLE "LoaderJob" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "status" "LoaderJobStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoaderJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoaderJob_datasetId_idx" ON "LoaderJob"("datasetId");

-- CreateIndex
CREATE INDEX "LoaderJob_versionId_idx" ON "LoaderJob"("versionId");

-- CreateIndex
CREATE INDEX "LoaderJob_status_idx" ON "LoaderJob"("status");

-- AddForeignKey
ALTER TABLE "LoaderJob" ADD CONSTRAINT "LoaderJob_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoaderJob" ADD CONSTRAINT "LoaderJob_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DatasetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoaderJob" ADD CONSTRAINT "LoaderJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
