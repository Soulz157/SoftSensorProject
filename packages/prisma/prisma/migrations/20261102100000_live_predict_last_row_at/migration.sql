-- MODEL-SERVE-045. The newest row the live driver last scored; a tick whose
-- newest row is unchanged scores nothing.
ALTER TABLE "InferenceSchedule" ADD COLUMN "livePredictLastRowAt" TIMESTAMP(3);
