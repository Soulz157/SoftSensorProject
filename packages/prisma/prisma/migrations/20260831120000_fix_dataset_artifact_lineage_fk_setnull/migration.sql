-- Fixes "cannot delete Dataset" — DatasetArtifact_parentArtifactId_fkey
-- violated on every prisma.dataset.delete() whose lineage chain has an
-- intermediate stage (i.e. essentially every real dataset).
--
-- Root cause: adoption at Save (dataset-draft.authorized.service.ts,
-- saveDraftAsDatasetService) only sets DatasetArtifact.datasetId on the
-- FINAL artifact and the lineage ROOT (BRONZE) — intermediate SILVER/GOLD
-- artifacts stay owned solely by draftId forever. Deleting a Dataset
-- cascades and removes BRONZE (via DatasetArtifact_datasetId_fkey, ON
-- DELETE CASCADE), while the still-alive, still-draft-owned SILVER row
-- keeps pointing at it via parentArtifactId. That FK was ON DELETE NO
-- ACTION, so the delete failed every time. The DatasetVersion.artifactId
-- FK has the same NO ACTION shape and is a distinct but related risk: it
-- points at DatasetArtifact from a SIBLING cascade path off the same
-- Dataset row (DatasetVersion.dataset is also ON DELETE CASCADE), and
-- Postgres does not guarantee which of two independent cascades off the
-- same row runs first.
--
-- Fix: SetNull, not Cascade, on both. Cascade on parentArtifactId would
-- delete the still-live SILVER/GOLD row out from under its own
-- DatasetDraft (which has no FK relationship to this Dataset at all —
-- only unenforced savedDatasetId/editingDatasetId strings), which may
-- still be in active use. SetNull matches the "adoption is a pointer, not
-- a copy" contract already documented on DatasetArtifact.datasetId/draftId:
-- the BRONZE/FINAL rows are gone, everything else just loses a now-dead
-- pointer.
--
-- DEFERRABLE INITIALLY DEFERRED was considered and rejected — Prisma's
-- migration engine cannot express DEFERRABLE in schema.prisma, so every
-- future `prisma migrate dev`/diff would see it as drift and try to
-- revert it.

-- DropForeignKey
ALTER TABLE "DatasetArtifact" DROP CONSTRAINT "DatasetArtifact_parentArtifactId_fkey";

-- DropForeignKey
ALTER TABLE "DatasetVersion" DROP CONSTRAINT "DatasetVersion_artifactId_fkey";

-- AddForeignKey
ALTER TABLE "DatasetArtifact" ADD CONSTRAINT "DatasetArtifact_parentArtifactId_fkey" FOREIGN KEY ("parentArtifactId") REFERENCES "DatasetArtifact"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DatasetVersion" ADD CONSTRAINT "DatasetVersion_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "DatasetArtifact"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
