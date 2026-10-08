import { Cpu, Database, FileText, Plug, type LucideIcon } from 'lucide-react'
import type { DataSourceKind } from '@/lib/mock-data-sources'
import type { DatasetArtifactStage } from '@/services/dataset-draft'

/**
 * Shared by `DatasetDetailSheet` (Data Studio) and the Model wizard's Step 2
 * Dataset Review (MODEL-FLOW-010) — one definition so the source badges
 * never drift between the two callers.
 */
export const SOURCE_META: Record<
  DataSourceKind,
  { label: string; icon: LucideIcon }
> = {
  aveva: { label: 'AVEVA PI', icon: Cpu },
  sql: { label: 'SQL', icon: Database },
  csv: { label: 'CSV', icon: FileText },
  api: { label: 'API', icon: Plug },
}

/** `currentArtifactId` is stage-polymorphic (see `SavedDataset.currentArtifactType`'s
 * doc comment) — every number shown against this badge describes whichever
 * stage it names, so it has to be visible, not inferred. */
export const STAGE_LABEL: Record<DatasetArtifactStage, string> = {
  BRONZE: 'Raw',
  SILVER: 'Cleaned',
  GOLD: 'Feature-engineered',
  FINAL: 'Processed',
}
