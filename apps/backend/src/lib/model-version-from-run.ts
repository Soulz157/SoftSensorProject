import { PrismaTypes } from '@softsensor/prisma';

/**
 * MODEL-SERVE-004. The ModelVersion field mapping, in ONE place.
 *
 * Extracted from Save Model's own `tx.modelVersion.create` (model-draft.
 * authorized.service.ts) rather than copied: `saveDraftService` mints
 * version 1 for a brand-new Model, a retrain mints max(version)+1 for an
 * existing one, and every OTHER field is the same snapshot of the same
 * source run. Two copies of that mapping is how a later column ends up
 * populated on one path and silently null on the other — the exact failure
 * class this ledger's `featureSpecKey` findings keep describing.
 *
 * Callers own their own transaction and their own `version` allocation; this
 * function only builds the row. `stage` is deliberately NOT set — the schema
 * default (STAGING) is what both callers want, and writing it explicitly
 * here would make a future default change silently ineffective. Nothing in
 * this file can create a PRODUCTION version.
 */

/** The subset of a `ModelTrainingRun` row a version is built from. Structural,
 *  not the generated model type, so a caller can pass a `select`ed row. */
export interface VersionSourceRun {
  id: string;
  datasetId: string;
  goldArtifactId: string;
  goldObjectKey: string;
  artifactChecksum: string;
  featureSpecKey: string | null;
  algorithm: string;
  hyperparameters: PrismaTypes.JsonValue;
  imageDigest: string;
  metrics: PrismaTypes.JsonValue | null;
}

export interface BuildModelVersionInput {
  modelId: string;
  /** Allocated by the caller INSIDE its own transaction — hardcoded 1 for a
   *  brand-new Model (Save Model), max(version)+1 for a retrain, never a DB
   *  sequence. See ModelVersion.version's own schema comment. */
  version: number;
  run: VersionSourceRun;
  /** The run's `modelKey` (model.joblib). Passed explicitly, not read off the
   *  run, because both callers must first REFUSE a run that has none — a
   *  version pointing at no object is a promote that fails at load time. */
  modelObjectKey: string;
  /** From run_manifest.json's `model_sha256`. Null is honest ("not recorded
   *  for this run"), never a fabricated value. */
  modelChecksum: string | null;
  /** From run_manifest.json's `framework_versions`. Same honest-null rule. */
  frameworkVersions: Record<string, string> | null;
}

export function buildModelVersionData(
  input: BuildModelVersionInput,
): PrismaTypes.ModelVersionUncheckedCreateInput {
  const { modelId, version, run, modelObjectKey, modelChecksum } = input;
  return {
    modelId,
    version,
    sourceRunId: run.id,
    sourceDatasetId: run.datasetId,
    // Pinned off the run row, one hop — never re-derived through the
    // dataset's CURRENT artifact (MODEL-SERVE-000-T03/T07).
    goldArtifactId: run.goldArtifactId,
    goldObjectKey: run.goldObjectKey,
    artifactChecksum: run.artifactChecksum,
    featureSpecKey: run.featureSpecKey,
    modelObjectKey,
    modelChecksum,
    algorithm: run.algorithm,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    hyperparameters: JSON.parse(JSON.stringify(run.hyperparameters)),
    imageDigest: run.imageDigest,
    ...(input.frameworkVersions !== null && {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      frameworkVersions: JSON.parse(JSON.stringify(input.frameworkVersions)),
    }),
    ...(run.metrics != null && {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      metrics: JSON.parse(JSON.stringify(run.metrics)),
    }),
  };
}

/**
 * MODEL-SERVE-004. The version number a retrain's new row takes: max+1 over
 * this model's existing versions, read INSIDE the caller's transaction with
 * `@@unique([modelId, version])` as the backstop — the same allocation shape
 * DS-LAKE-009-T03 uses for DatasetVersion.versionNumber, named by Save
 * Model's own comment as what a retrain needs.
 *
 * Takes the transaction client so the read and the create cannot straddle a
 * commit boundary. Two concurrent retrains for one model are already
 * impossible (ModelCandidateJob_one_live_per_model), and a genuine race would
 * still fail loudly on the unique index rather than silently reusing a
 * number.
 */
export interface VersionNumberReader {
  modelVersion: {
    findFirst(args: {
      where: { modelId: string };
      orderBy: { version: 'desc' };
      select: { version: true };
    }): Promise<{ version: number } | null>;
  };
}

export async function nextModelVersionNumber(
  tx: VersionNumberReader,
  modelId: string,
): Promise<number> {
  const last = await tx.modelVersion.findFirst({
    where: { modelId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  return (last?.version ?? 0) + 1;
}
