import type { PipelineConfig } from '@/lib/pipeline-config'

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
  /** ISO 8601 */
  createdAt: string
  updatedAt: string
  createdBy: string
}
