import type { TimeRange } from '@/lib/mock-readings'

/** Mirrors `apps/backend/src/api/v1/workspace/authorized/
 *  workspace-data-intake.authorized.service.ts`. */
export type IntakeRange = TimeRange

/** Arrival quality of a live tag's last fetch (`TagObservation.lastStatus`),
 *  NOT PI's own flag. `notLive` = the model's schedule is off or its last
 *  fetch is older than three cadences. */
export type TagQuality =
  | 'good'
  | 'bad'
  | 'questionable'
  | 'noReading'
  | 'notLive'

export interface TagCounts {
  good: number
  bad: number
  questionable: number
  noReading: number
  notLive: number
}

export interface IngestionPoint {
  /** ISO 8601 UTC. */
  bucketStart: string
  scheduledRows: number
  predictRows: number
  /** Share of scheduled input cells that were not Good, 0–100; null = no rows. */
  badCellPct: number | null
}

export interface IntakeStorage {
  savedBytes: number
  activeDraftBytes: number
  /** Drafts already saved/abandoned whose objects are not yet reclaimed. */
  cleanupBytes: number
  totalBytes: number
}

export interface IntakeTotals {
  liveModels: number
  tags: TagCounts
  rowsIngested: number
  badCellPct: number | null
  storage: IntakeStorage
  datasetCount: number
}

export interface TagRow {
  modelId: string
  modelName: string
  tag: string
  quality: TagQuality
  lastValue: number | null
  lastSeenAt: string | null
  heldMinutes: number | null
}

export interface WorkspaceIntakeDataset {
  id: string
  name: string
  tagCount: number
  rowCount: number
  missingPct: number
  sizeBytes: number
  updatedAt: string
}

interface IntakeBase {
  range: IntakeRange
  from: string
  to: string
  totals: IntakeTotals
  ingestion: IngestionPoint[]
}

export interface WorkspaceIntake extends IntakeBase {
  scope: 'workspace'
  workspaceId: string
  tags: TagRow[]
  datasets: WorkspaceIntakeDataset[]
}

export interface WorkspaceIntakeRow {
  id: string
  name: string
  liveModels: number
  tags: TagCounts
  rowsIngested: number
  storageBytes: number
  datasetCount: number
}

export interface AllWorkspacesIntake extends IntakeBase {
  scope: 'all'
  workspaces: WorkspaceIntakeRow[]
}

export type DataIntake = WorkspaceIntake | AllWorkspacesIntake
