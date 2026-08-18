-- AlterTable
ALTER TABLE "PreprocessingJob" ADD COLUMN     "resultArtifactId" TEXT,
ADD COLUMN     "sourceArtifactId" TEXT;

-- AddForeignKey
ALTER TABLE "PreprocessingJob" ADD CONSTRAINT "PreprocessingJob_sourceArtifactId_fkey" FOREIGN KEY ("sourceArtifactId") REFERENCES "DatasetArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreprocessingJob" ADD CONSTRAINT "PreprocessingJob_resultArtifactId_fkey" FOREIGN KEY ("resultArtifactId") REFERENCES "DatasetArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
