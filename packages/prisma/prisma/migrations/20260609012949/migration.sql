/*
  Warnings:

  - Added the required column `planId` to the `Nodes` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WorkspaceAction" ADD VALUE 'NODE_ADDED';
ALTER TYPE "WorkspaceAction" ADD VALUE 'NODE_REMOVED';
ALTER TYPE "WorkspaceAction" ADD VALUE 'NODE_UPDATED';

-- AlterEnum
ALTER TYPE "WorkspaceRole" ADD VALUE 'STAFF';

-- AlterTable
ALTER TABLE "Nodes" ADD COLUMN     "planId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "WorkspacePlan" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "color" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspacePlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkspacePlan_workspaceId_idx" ON "WorkspacePlan"("workspaceId");

-- CreateIndex
CREATE INDEX "Nodes_planId_idx" ON "Nodes"("planId");

-- AddForeignKey
ALTER TABLE "WorkspacePlan" ADD CONSTRAINT "WorkspacePlan_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Nodes" ADD CONSTRAINT "Nodes_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WorkspacePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "Edge_workspaceId_sourceId_targetId_sourceHandle_targetHandle_ke" RENAME TO "Edge_workspaceId_sourceId_targetId_sourceHandle_targetHandl_key";
