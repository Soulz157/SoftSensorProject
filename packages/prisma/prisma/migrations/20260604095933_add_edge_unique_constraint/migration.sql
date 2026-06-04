-- CreateIndex
CREATE UNIQUE INDEX "Edge_workspaceId_sourceId_targetId_sourceHandle_targetHandle_key" ON "Edge"("workspaceId", "sourceId", "targetId", "sourceHandle", "targetHandle");
