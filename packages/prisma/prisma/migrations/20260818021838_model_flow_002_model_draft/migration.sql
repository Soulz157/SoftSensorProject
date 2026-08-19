-- CreateEnum
CREATE TYPE "ModelDraftStatus" AS ENUM ('ACTIVE', 'SAVED', 'ABANDONED');

-- AlterTable
ALTER TABLE "ModelTrainingRun" ADD COLUMN     "modelDraftId" TEXT,
ALTER COLUMN "modelId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ModelDraft" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "workspaceId" TEXT NOT NULL,
    "plantId" TEXT,
    "nodeId" TEXT,
    "datasetId" TEXT,
    "targetY" TEXT,
    "algorithm" TEXT,
    "hyperparameters" JSONB NOT NULL DEFAULT '{}',
    "splitRatio" DOUBLE PRECISION,
    "status" "ModelDraftStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentRunId" TEXT,
    "savedModelId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModelDraft_workspaceId_idx" ON "ModelDraft"("workspaceId");

-- CreateIndex
CREATE INDEX "ModelDraft_createdById_idx" ON "ModelDraft"("createdById");

-- CreateIndex
CREATE INDEX "ModelDraft_status_idx" ON "ModelDraft"("status");

-- CreateIndex
CREATE INDEX "ModelTrainingRun_modelDraftId_idx" ON "ModelTrainingRun"("modelDraftId");

-- AddForeignKey
ALTER TABLE "ModelDraft" ADD CONSTRAINT "ModelDraft_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelDraft" ADD CONSTRAINT "ModelDraft_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelTrainingRun" ADD CONSTRAINT "ModelTrainingRun_modelDraftId_fkey" FOREIGN KEY ("modelDraftId") REFERENCES "ModelDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
