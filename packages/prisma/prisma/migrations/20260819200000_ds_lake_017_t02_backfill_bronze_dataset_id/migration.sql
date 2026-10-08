-- DS-LAKE-017-T02. Hand-written; Prisma does not generate data moves — same
-- precedent as DS-LAKE-009-T07's own backfill (registry_reshape migration).
--
-- Backfills `datasetId` onto the lineage-ROOT BRONZE of every existing saved
-- dataset's CURRENT version, so edit-mode hydration (T03) can read it via the
-- same `where: { id, datasetId }` gate every other draft-owned read already
-- uses. DS-LAKE-017-T01 makes every NEW save adopt this pointer going
-- forward; this migration is the one-time catch-up for datasets saved before
-- that code shipped.
--
-- `DatasetVersion.lineage` is the FROZEN, root-first snapshot
-- `saveDraftAsDatasetService` writes at Save time (DS-LAKE-009) — `lineage->0`
-- is the root by construction (the walk that built it starts at FINAL and
-- unshifts back via parentArtifactId to the one link that has none, BRONZE's
-- own definition). Reading it here avoids re-walking parentArtifactId in SQL.
--
-- Idempotent: `"datasetId" IS NULL` means a second run matches zero rows —
-- verified by executing this statement twice against a real database (see
-- DS-LAKE-017-V03). Additive: no row is deleted, no `objectKey`/`checksum`/
-- `draftId` is touched, only the ownership pointer.
--
-- SKIPS a BRONZE whose bytes are already reclaimed
-- (`"objectReclaimedAt" IS NOT NULL`) on purpose, per this task's own
-- scope_note — adopting a row with no bytes left would move edit mode's
-- failure from gate time ("no adopted BRONZE") to read time ("404 from
-- MinIO"), which is a worse failure because it happens later and reads as a
-- bug rather than an expected, already-diagnosable state (DS-LAKE-013's own
-- non-BRONZE banner already covers this dataset correctly, unchanged).

UPDATE "DatasetArtifact" b
SET "datasetId" = d."id"
FROM "Dataset" d
JOIN "DatasetVersion" v ON v."id" = d."currentVersionId"
WHERE b."id" = (v."lineage" -> 0 ->> 'id')
  AND b."datasetId" IS NULL
  AND b."objectReclaimedAt" IS NULL;
