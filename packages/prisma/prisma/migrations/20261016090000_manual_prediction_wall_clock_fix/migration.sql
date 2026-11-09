-- Run Predict stored `predictedAt` 7 hours in the future: the scored frame
-- row's naive Bangkok wall-clock stamp was read as UTC (`…Z`). Fixed in
-- `scoreLiveAndRecord` (lib/plant-time.ts wallClockToUtc), 2026-10-16.
--
-- A scored row can never be later than its own press, so `predictedAt >
-- "createdAt"` selects exactly the rows written with this bug; re-running is
-- a no-op once they are corrected.
--
-- Hand-written, NOT produced by `prisma migrate dev` (history drift makes it
-- offer only `migrate reset`). Applied by hand.

UPDATE "ManualPrediction"
SET "predictedAt" = "predictedAt" - INTERVAL '7 hours'
WHERE "predictedAt" > "createdAt";
