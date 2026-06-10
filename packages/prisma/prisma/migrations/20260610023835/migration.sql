/*
  Warnings:

  - You are about to drop the `WorkspacePlan` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Nodes" DROP CONSTRAINT "Nodes_planId_fkey";

-- DropForeignKey
ALTER TABLE "WorkspacePlan" DROP CONSTRAINT "WorkspacePlan_workspaceId_fkey";

-- DropTable
DROP TABLE "WorkspacePlan";

-- CreateTable
CREATE TABLE "WorkspacePlant" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "color" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspacePlant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkspacePlant_workspaceId_idx" ON "WorkspacePlant"("workspaceId");

-- AddForeignKey
ALTER TABLE "WorkspacePlant" ADD CONSTRAINT "WorkspacePlant_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Nodes" ADD CONSTRAINT "Nodes_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WorkspacePlant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
