-- CreateTable
CREATE TABLE "FeaturePresetImport" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "objectPrefix" TEXT NOT NULL,
    "sheetCount" INTEGER NOT NULL DEFAULT 0,
    "presetCount" INTEGER NOT NULL DEFAULT 0,
    "skippedSheets" TEXT[],
    "sdtaKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeaturePresetImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeaturePreset" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "presetId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "configNo" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "samplingPoint" TEXT,
    "targetY" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "equationCount" INTEGER NOT NULL DEFAULT 0,
    "rawTagCount" INTEGER NOT NULL DEFAULT 0,
    "requiredBaseTags" TEXT[],
    "incomplete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeaturePreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeaturePresetImport_workspaceId_idx" ON "FeaturePresetImport"("workspaceId");

-- CreateIndex
CREATE INDEX "FeaturePresetImport_createdById_idx" ON "FeaturePresetImport"("createdById");

-- CreateIndex
CREATE INDEX "FeaturePreset_workspaceId_idx" ON "FeaturePreset"("workspaceId");

-- CreateIndex
CREATE INDEX "FeaturePreset_importId_idx" ON "FeaturePreset"("importId");

-- CreateIndex
CREATE UNIQUE INDEX "FeaturePreset_importId_presetId_key" ON "FeaturePreset"("importId", "presetId");

-- AddForeignKey
ALTER TABLE "FeaturePresetImport" ADD CONSTRAINT "FeaturePresetImport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturePresetImport" ADD CONSTRAINT "FeaturePresetImport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturePreset" ADD CONSTRAINT "FeaturePreset_importId_fkey" FOREIGN KEY ("importId") REFERENCES "FeaturePresetImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
