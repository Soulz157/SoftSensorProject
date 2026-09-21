-- MODEL-SERVE-015. Retrain with Data Augmentation — purely additive.
--
-- Every new column is nullable (or NOT NULL WITH a safe default) and every
-- existing row is unaffected: `validationAlreadyScaled` defaults false for
-- every holdout ever written, which is exactly the legacy behavior
-- `tryReplayHoldout` already applies (prepare/replay, never a passthrough).
-- The rest are metadata columns read only by the new AUGMENT_DATA path and
-- left null by every existing retrain/training-run/version row.
--
-- Generated with `prisma migrate diff --from-config-datasource --to-schema`,
-- following the same by-hand convention this repo's recent migrations use
-- (see 20260917040000_model_serve_009_tag_observation's own note on why
-- `migrate dev` is not used against this database).

-- CreateEnum
CREATE TYPE "ModelEvalSetKind" AS ENUM ('DATASET_HOLDOUT', 'FROZEN_INCUMBENT_TEST');

-- AlterTable
ALTER TABLE "DatasetArtifact" ADD COLUMN     "validationAlreadyScaled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ModelCandidateJob" ADD COLUMN     "additionalDatasetVersionId" TEXT,
ADD COLUMN     "baseDatasetVersionId" TEXT,
ADD COLUMN     "combinedArtifactId" TEXT,
ADD COLUMN     "retrainStrategy" TEXT;

-- AlterTable
ALTER TABLE "ModelTrainingRun" ADD COLUMN     "evalSetKind" "ModelEvalSetKind",
ADD COLUMN     "frozenEvalChecksum" TEXT;

-- AlterTable
ALTER TABLE "ModelVersion" ADD COLUMN     "retrainStrategy" TEXT;
