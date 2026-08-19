import type { PipelineConfig } from '@/lib/pipeline-config'
import type { DatasetArtifactStage } from '@/services/dataset-draft'

/**
 * A dataset assembled from one or more `DataSource` connections via the
 * `/data-studio/create` wizard. Backed by the real `Dataset` Prisma model
 * (NestJS `authorized/dataset` module) — fetched through `services/dataset.ts`
 * / `hooks/dataset/use-datasets.ts`, no longer localStorage.
 *
 * `pipelineConfig` carries the full recipe (feature engineering + crop + outlier
 * + fill) so a model referencing this dataset re-derives the processed rows
 * deterministically. `fileUrl` is an optional S3 snapshot (null in the mock era).
 */
export interface SavedDataset {
  id: string
  name: string
  description: string | null
  workspaceId: string
  sourceIds: string[]
  tags: string[]
  pipelineConfig: PipelineConfig
  fileUrl: string | null
  rowCount: number
  missingPct: number
  /**
   * Committed artifact to hydrate real rows from, or `null`.
   *
   * Null for every dataset saved before the versioning slice — which is all of
   * them at the time of writing. Anything reading stored rows must handle the
   * null branch (materialise on demand, else fall back to synthetic rows with
   * a visible banner); treating it as always-present shows an empty dataset.
   */
  currentVersionId: string | null
  /**
   * Artifact the wizard hydrates rows from (DS-LAKE-004). Both pointers are
   * read: legacy datasets only ever have `currentVersionId`, new ones only
   * ever get `currentArtifactId`. No longer optional — the server always
   * includes it (null when absent), so a stale cached response missing the
   * key is not a case the client needs to model.
   */
  currentArtifactId: string | null
  /**
   * Pipeline stage of the artifact `currentArtifactId` points at — BRONZE
   * (raw fetch, via `createRaw`) or FINAL (adopted at Save). Null exactly
   * when `currentArtifactId` is null. The pointer is stage-polymorphic, so
   * nothing that reads real rows through it may treat "has an artifact" and
   * "has a RAW artifact" as the same fact — see `use-dataset-version-rows.ts`.
   */
  currentArtifactType: DatasetArtifactStage | null
  /** ISO 8601 */
  createdAt: string
  updatedAt: string
  createdBy: string
}
