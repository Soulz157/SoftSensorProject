-- MODEL-FLOW-018-T02. Standalone-run selection: the user's explicit choice
-- of which run carries forward, for runs no ModelCandidateJob owns (a
-- standalone launch, or any CV run). Null means "resolve by the default
-- rules". No FK — mirrors ModelCandidateJob.selectedRunId's own shape.
ALTER TABLE "ModelDraft" ADD COLUMN "selectedRunId" TEXT;
