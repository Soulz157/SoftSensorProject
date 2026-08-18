/*
  Warnings:

  - You are about to drop the column `datasetVersionId` on the `ModelTrainingRun` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ModelTrainingRun" DROP COLUMN "datasetVersionId";
