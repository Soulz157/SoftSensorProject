-- One row per Run Predict press that produced a score, so the Monitoring
-- tab can draw the operator's own on-demand predictions on Actual vs
-- Predict. PredictionLog cannot answer this: it has no source column, so a
-- press is indistinguishable there from the live prediction driver's sweep.
--
-- Hand-written, NOT produced by `prisma migrate dev` (history drift makes it
-- offer only `migrate reset`). Trimmed from `prisma migrate diff
-- --from-config-datasource --to-schema` to this change only — the diff also
-- proposes the unrelated, still-pending `InferenceSchedule`
-- `driftThresholdPct` drop, deliberately NOT included. Applied by hand and
-- recorded with `prisma migrate resolve --applied`, not `migrate deploy`.

-- CreateTable
CREATE TABLE "ManualPrediction" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "modelVersionId" TEXT NOT NULL,
    "predicted" DOUBLE PRECISION NOT NULL,
    "predictedAt" TIMESTAMP(3) NOT NULL,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualPrediction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManualPrediction_modelId_predictedAt_idx" ON "ManualPrediction"("modelId", "predictedAt");

-- AddForeignKey
ALTER TABLE "ManualPrediction" ADD CONSTRAINT "ManualPrediction_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualPrediction" ADD CONSTRAINT "ManualPrediction_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualPrediction" ADD CONSTRAINT "ManualPrediction_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
