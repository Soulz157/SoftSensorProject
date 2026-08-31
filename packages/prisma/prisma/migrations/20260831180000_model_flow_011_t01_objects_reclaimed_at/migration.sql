-- MODEL-FLOW-011-T01. Applied via `prisma db execute --file` in this session,
-- not `prisma migrate dev` directly — same pre-existing, unrelated
-- DatasetArtifact.droppedBadRows drift that 20260827120000_model_flow_013_candidate_job
-- and 20260828140000_model_flow_013_t11_sweep_then_tune already document
-- forced onto that same path (drift confirmed harmless: `prisma migrate diff`
-- against schema.prisma showed exactly this one ALTER, nothing else, before
-- it was applied). Marked applied via `prisma migrate resolve` afterward.

-- AlterTable
ALTER TABLE "ModelDraft" ADD COLUMN     "objectsReclaimedAt" TIMESTAMP(3);
