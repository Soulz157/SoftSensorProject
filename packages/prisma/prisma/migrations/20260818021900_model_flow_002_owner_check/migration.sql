-- ---------------------------------------------------------------------------
-- "never neither" (hand-written; Prisma cannot express CHECK constraints).
--
-- modelId is nullable at the COLUMN level so a run created from the wizard
-- can exist before any Model does. This constraint is what stops that
-- flexibility becoming an orphan: every run must be owned by a Model, a
-- ModelDraft, or both — never neither. Mirrors
-- DatasetArtifact_owner_present / PreprocessingJob_owner_present
-- (20260804131005_dataset_draft), the identical shape for the dataset side.
--
-- "Both" is legal on purpose: Save Model sets modelId on the winning run
-- while KEEPING modelDraftId, so an adopted run stays traceable to the
-- draft that produced it (MODEL-FLOW-007-T10).
-- ---------------------------------------------------------------------------

ALTER TABLE "ModelTrainingRun"
  ADD CONSTRAINT "ModelTrainingRun_owner_present"
  CHECK ("modelId" IS NOT NULL OR "modelDraftId" IS NOT NULL);
