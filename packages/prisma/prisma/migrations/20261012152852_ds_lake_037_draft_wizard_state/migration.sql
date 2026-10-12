-- DS-LAKE-037. Wizard resume - purely additive.
--
-- Two nullable columns on "DatasetDraft": the wizard's configuration snapshot
-- (never row data) and its schema version. Every existing row keeps NULL in
-- both, which every reader treats as "nothing to resume", so no draft changes
-- behaviour until the client first PATCHes it.

-- AlterTable
ALTER TABLE "DatasetDraft" ADD COLUMN     "wizardState" JSONB,
ADD COLUMN     "wizardStateVersion" INTEGER;
