-- AlterTable
ALTER TABLE "Model" ADD COLUMN     "nodesId" TEXT;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "description" TEXT;

-- CreateTable
CREATE TABLE "Nodes" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Nodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Nodes_workspaceId_idx" ON "Nodes"("workspaceId");

-- AddForeignKey
ALTER TABLE "Nodes" ADD CONSTRAINT "Nodes_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Model" ADD CONSTRAINT "Model_nodesId_fkey" FOREIGN KEY ("nodesId") REFERENCES "Nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
