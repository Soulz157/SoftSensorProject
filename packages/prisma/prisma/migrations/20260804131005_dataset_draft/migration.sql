-- CreateEnum
CREATE TYPE "DatasetDraftStatus" AS ENUM ('ACTIVE', 'SAVED', 'ABANDONED');

-- AlterTable
ALTER TABLE "DatasetArtifact" ADD COLUMN     "draftId" TEXT,
ALTER COLUMN "datasetId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PreprocessingJob" ADD COLUMN     "draftId" TEXT,
ALTER COLUMN "datasetId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "DatasetDraft" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "workspaceId" TEXT NOT NULL,
    "sourceIds" TEXT[],
    "status" "DatasetDraftStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentArtifactId" TEXT,
    "savedDatasetId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DatasetDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DatasetDraft_workspaceId_idx" ON "DatasetDraft"("workspaceId");

-- CreateIndex
CREATE INDEX "DatasetDraft_createdById_idx" ON "DatasetDraft"("createdById");

-- CreateIndex
CREATE INDEX "DatasetDraft_status_idx" ON "DatasetDraft"("status");

-- AddForeignKey
ALTER TABLE "DatasetDraft" ADD CONSTRAINT "DatasetDraft_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetDraft" ADD CONSTRAINT "DatasetDraft_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetArtifact" ADD CONSTRAINT "DatasetArtifact_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "DatasetDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreprocessingJob" ADD CONSTRAINT "PreprocessingJob_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "DatasetDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- "never neither" (hand-written; Prisma cannot express CHECK constraints).
--
-- Both owner columns are nullable at the COLUMN level so a draft artifact or a
-- draft job can exist before any Dataset does. These constraints are what stop
-- that flexibility becoming an orphan: every row must be owned by a draft, a
-- dataset, or both — never neither.
--
-- "Both" is legal on purpose: adoption at Save sets datasetId while KEEPING
-- draftId, so a saved artifact stays traceable to the run that produced it.
-- ---------------------------------------------------------------------------

ALTER TABLE "DatasetArtifact"
  ADD CONSTRAINT "DatasetArtifact_owner_present"
  CHECK ("datasetId" IS NOT NULL OR "draftId" IS NOT NULL);

ALTER TABLE "PreprocessingJob"
  ADD CONSTRAINT "PreprocessingJob_owner_present"
  CHECK ("datasetId" IS NOT NULL OR "draftId" IS NOT NULL);
