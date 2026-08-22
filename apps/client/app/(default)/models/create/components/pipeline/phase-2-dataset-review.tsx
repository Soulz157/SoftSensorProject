'use client'

import { useMemo } from 'react'
import { Layers } from 'lucide-react'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'
import { useDataSources } from '@/hooks/use-data-sources'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'
import { useArtifactMetadata } from '@/hooks/dataset/artifact/use-dataset-artifact-metadata'
import { useArtifactColumnStats } from '@/hooks/dataset/artifact/use-dataset-artifact-column-stats'
import { useArtifactRows } from '@/hooks/dataset/artifact/use-artifact-rows'
import { useArtifactCorrelation } from '@/hooks/dataset/artifact/use-artifact-correlation'
import { useArtifactHoldout } from '@/hooks/dataset/artifact/use-artifact-holdout'
import {
  perTagStatsOrdered,
  topCorrelatedArtifactPairs,
} from '@/lib/dataset-stats'
import { SourceIdentityPanel } from './dataset-review/source-identity-panel'
import { PerTagStatsPanel } from './dataset-review/per-tag-stats-panel'
import { PreviewCorrelationPanel } from './dataset-review/preview-correlation-panel'
import { HoldoutPanel } from './dataset-review/holdout-panel'

interface Props {
  nav: UsePipelineNavResult
}

/**
 * Step 2 — Dataset Review (MODEL-FLOW-010). Reads the dataset selected at
 * Step 1's committed artifact and shows WHAT the user is about to train on
 * before Step 3 configures HOW. Holds no server state of its own: no atom
 * beyond `mpSelectedDatasetAtom` (already set by Step 1) is read, and
 * nothing here PATCHes the ModelDraft.
 *
 * Composition, not a new capability — the same set `DatasetDetailSheet`
 * already proves (`useArtifactMetadata`/`useArtifactColumnStats`/
 * `useArtifactRows`/`useArtifactCorrelation`), plus the new
 * `useArtifactHoldout` (MODEL-FLOW-010-T06). Deliberately NOT
 * `DataAnalysisCard`: that component reads the data-studio DRAFT store
 * (`dw*` atoms), calls draft-only chart routes with no saved-dataset twin,
 * and embeds a mutation UI — wrong data source and wrong contract for a
 * step that configures nothing (see MODEL-FLOW-010's own finding on this).
 */
export function Phase2DatasetReview({ nav }: Props) {
  const dataset = nav.selectedDataset

  const { sources: allSources, loading: sourcesLoading } = useDataSources()
  const { workspaces } = useWorkspaces()

  const datasetId = dataset?.id ?? null
  const artifactId = dataset?.currentArtifactId ?? null
  const tags = useMemo(() => dataset?.tags ?? [], [dataset?.tags])
  const hasArtifact = artifactId !== null

  const {
    metadata,
    loading: metadataLoading,
    error: metadataError,
  } = useArtifactMetadata(datasetId, artifactId)

  const {
    columnStats,
    loading: statsLoading,
    missing: statsMissing,
    error: statsError,
  } = useArtifactColumnStats(datasetId, artifactId)

  const {
    sample,
    loading: sampleLoading,
    error: sampleError,
  } = useArtifactRows(datasetId, artifactId, tags)

  const { correlation, loading: corrLoading } = useArtifactCorrelation(
    datasetId,
    artifactId,
    tags,
  )

  const {
    holdout,
    loading: holdoutLoading,
    error: holdoutError,
  } = useArtifactHoldout(datasetId, artifactId)

  const workspaceName = dataset
    ? (workspaces.find(w => w.id === dataset.workspaceId)?.name ??
      'Unknown Workspace')
    : ''

  const sources = useMemo(() => {
    if (!dataset) return []
    return dataset.sourceIds.map(id => {
      const s = allSources.find(src => src.id === id)
      return { name: s?.name ?? 'Unknown source', type: s?.type ?? null }
    })
  }, [dataset, allSources])

  const perTagStats = useMemo(
    () => perTagStatsOrdered(tags, columnStats?.stats),
    [columnStats, tags],
  )
  const topPairs = useMemo(
    () => topCorrelatedArtifactPairs(correlation),
    [correlation],
  )

  if (!dataset) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl bg-muted/30 py-8 text-center ring-1 ring-foreground/10">
        <Layers className="h-7 w-7 text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground">
          No dataset selected — go back to Step 1.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <SourceIdentityPanel
        dataset={dataset}
        workspaceName={workspaceName}
        sources={sources}
        sourcesLoading={sourcesLoading}
        metadata={metadata}
        metadataLoading={metadataLoading}
        metadataError={metadataError}
      />

      {hasArtifact ? (
        <>
          <section className="space-y-2">
            <p className="text-sm font-semibold text-foreground">
              Per-tag statistics
            </p>
            <PerTagStatsPanel
              stats={perTagStats}
              loading={statsLoading}
              missing={statsMissing}
              error={statsError}
            />
          </section>

          <section className="space-y-2">
            <p className="text-sm font-semibold text-foreground">
              Validation holdout
            </p>
            <HoldoutPanel
              holdout={holdout}
              loading={holdoutLoading}
              error={holdoutError}
            />
          </section>

          <PreviewCorrelationPanel
            sample={sample}
            sampleLoading={sampleLoading}
            sampleError={sampleError}
            topPairs={topPairs}
            correlationLoading={corrLoading}
          />
        </>
      ) : (
        // One shared message for the whole lower half rather than four
        // independent empty states — a dataset with no committed artifact
        // yet has nothing real to show in any of them, for the same reason.
        <div className="rounded-lg border border-border p-6 text-center text-xs text-muted-foreground">
          This dataset has no stored artifact yet — statistics, correlations,
          the validation holdout, and a data preview will appear once its rows
          are committed.
        </div>
      )}
    </div>
  )
}
