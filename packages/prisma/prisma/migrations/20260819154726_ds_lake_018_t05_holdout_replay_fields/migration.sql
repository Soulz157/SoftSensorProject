-- AlterTable
ALTER TABLE "DatasetArtifact" ADD COLUMN     "validationHoldoutFrom" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ModelTrainingRun" ADD COLUMN     "holdoutMetrics" JSONB;
