/*
  Warnings:

  - You are about to drop the column `columnStats` on the `DatasetArtifact` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "DatasetArtifact" DROP COLUMN "columnStats",
ADD COLUMN     "columnStatsKey" TEXT;
