-- DS-LAKE-024-T02. Origin pointer for an edit-mode draft — the create-time
-- twin of savedDatasetId's outcome-time pointer. See schema.prisma's doc
-- comment on DatasetDraft.editingDatasetId for the full reasoning.

-- AlterTable
ALTER TABLE "DatasetDraft" ADD COLUMN "editingDatasetId" TEXT;

-- CreateIndex (ordinary lookup index, not the uniqueness guarantee below)
CREATE INDEX "DatasetDraft_editingDatasetId_idx" ON "DatasetDraft"("editingDatasetId");

-- ---------------------------------------------------------------------------
-- At most one ACTIVE draft per edited Dataset (hand-written; Prisma cannot
-- express a partial/WHERE-clause index in schema.prisma).
--
-- A plain @@unique([editingDatasetId]) would also forbid a SECOND edit
-- session opened after the first was abandoned or saved, which is legal —
-- only concurrent ACTIVE drafts for the same Dataset are the defect
-- (DS-LAKE-010-T08's own recorded incident, one layer over). The partial
-- WHERE clause is what makes "resolve-or-create" race-safe: two simultaneous
-- creates for the same datasetId now race on ONE unique index instead of
-- both succeeding, so the loser can catch the unique-violation and fall back
-- to reading the winner's row.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "DatasetDraft_one_active_edit_per_dataset"
  ON "DatasetDraft"("editingDatasetId")
  WHERE "status" = 'ACTIVE' AND "editingDatasetId" IS NOT NULL;
