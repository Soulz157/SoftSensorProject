'use client'

import { LayoutGrid } from 'lucide-react'
import type { SavedDataset } from '@/store/datasets'
import type { DataSourceKind } from '@/lib/mock-data-sources'
import type { DraftArtifactMetadata } from '@/services/dataset-draft'
import { artifactTimeSpanLabel } from '@/lib/dataset-stats'
import { SOURCE_META, STAGE_LABEL } from '@/lib/dataset-source-meta'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { StatTile } from '../../stat-tile'

export interface ReviewSource {
  name: string
  type: DataSourceKind | null
}

interface Props {
  dataset: SavedDataset
  workspaceName: string
  sources: ReviewSource[]
  /** True while `useDataSources()` is still loading — mirrors
   * `DatasetDetailSheet`'s own skeleton discipline so this panel never
   * flashes "Unknown source" before the real name arrives. */
  sourcesLoading: boolean
  metadata: DraftArtifactMetadata | null
  metadataLoading: boolean
  metadataError: string | null
}

/**
 * Source, identity, and footer-level stats — MODEL-FLOW-010-T03. Same
 * composition `DatasetDetailSheet` already proves: source badges from
 * `useDataSources()`, stage badge from `currentArtifactType`, rows/time span
 * from the artifact FOOTER (`useArtifactMetadata`), never a row payload.
 */
export function SourceIdentityPanel({
  dataset,
  workspaceName,
  sources,
  sourcesLoading,
  metadata,
  metadataLoading,
  metadataError,
}: Props) {
  const rowCount = metadata?.rowCount ?? dataset.rowCount ?? 0
  const timeSpan = artifactTimeSpanLabel(metadata?.startTime, metadata?.endTime)

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <LayoutGrid className="h-3.5 w-3.5" />
          {workspaceName}
        </div>
        <h2 className="text-lg font-semibold text-foreground">
          {dataset.name}
        </h2>
        {dataset.description && (
          <p className="text-sm text-muted-foreground">{dataset.description}</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {sourcesLoading ? (
            sources.map((_, i) => (
              <Skeleton key={i} className="h-5 w-24 rounded-full" />
            ))
          ) : sources.length === 0 ? (
            <Badge variant="secondary">No source</Badge>
          ) : (
            sources.map((s, i) => {
              const meta = s.type ? SOURCE_META[s.type] : null
              const Icon = meta?.icon
              return (
                <Badge
                  key={`${s.name}-${i}`}
                  variant="secondary"
                  className="gap-1.5 font-medium text-foreground"
                >
                  {Icon && <Icon className="h-3 w-3 text-primary" />}
                  {meta?.label ?? 'Source'}
                  <span className="text-muted-foreground">· {s.name}</span>
                </Badge>
              )
            })
          )}
          {dataset.currentArtifactType && (
            <Badge
              variant="outline"
              className="font-mono text-[10px] text-muted-foreground"
            >
              {STAGE_LABEL[dataset.currentArtifactType]}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatTile
          label="Rows"
          value={
            metadataLoading && !dataset.rowCount
              ? '…'
              : rowCount.toLocaleString()
          }
          surface="muted"
          valueSize="md"
        />
        <StatTile
          label="Features"
          value={String(dataset.tags.length)}
          surface="muted"
          valueSize="md"
        />
        <StatTile
          label="Time span of data"
          value={
            metadataLoading ? '…' : metadataError ? 'Unavailable' : timeSpan
          }
          sub={metadataError ?? undefined}
          surface="muted"
          valueSize="md"
        />
      </div>
    </div>
  )
}
