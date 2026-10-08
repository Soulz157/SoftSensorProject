-- DS-LAKE-022-T03. Hand-split so existing rows stay NULL (pre-reorder) and
-- only NEW inserts pick up the default going forward — a single
-- `ADD COLUMN ... DEFAULT 2` would backfill every pre-existing artifact row
-- to 2, which is false: they were produced by the OLD (pre-reorder)
-- pipeline order. See DatasetArtifact.pipelineVersion's doc comment in
-- schema.prisma.
ALTER TABLE "DatasetArtifact" ADD COLUMN "pipelineVersion" INTEGER;
ALTER TABLE "DatasetArtifact" ALTER COLUMN "pipelineVersion" SET DEFAULT 2;
