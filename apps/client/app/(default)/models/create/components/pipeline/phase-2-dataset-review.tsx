'use client'

import { useMemo, useState } from 'react'
import { Layers, PencilLine } from 'lucide-react'
import { brandBoundedSample } from '@/lib/preprocessing'
import { DataAnalysisCard } from '@/app/(default)/data-studio/create/components/processing/data-analysis-card'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'
import { useDatasetEditHandoff } from '@/hooks/model/use-dataset-edit-handoff'
import { useDataSources } from '@/hooks/use-data-sources'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'
import { useArtifactMetadata } from '@/hooks/dataset/artifact/use-dataset-artifact-metadata'
import { useArtifactColumnStats } from '@/hooks/dataset/artifact/use-dataset-artifact-column-stats'
import { useArtifactRows } from '@/hooks/dataset/artifact/use-artifact-rows'
import { useArtifactHoldout } from '@/hooks/dataset/artifact/use-artifact-holdout'
import { useArtifactFeatureSpec } from '@/hooks/dataset/artifact/use-artifact-feature-spec'
import { inverseScale } from '@/lib/inverse-scale'
import type { Dataset } from '@/lib/preprocessing'
import { perTagStatsOrdered } from '@/lib/dataset-stats'
import { SourceIdentityPanel } from './dataset-review/source-identity-panel'
import { PerTagStatsPanel } from './dataset-review/per-tag-stats-panel'
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
 * `useArtifactHoldout` (MODEL-FLOW-010-T06).
 *
 * REVERSED 2026-08-21 (user request): this step now DOES mount
 * `DataAnalysisCard`. The earlier finding — that the card is welded to the
 * data-studio draft store — was accurate and is not being waved away; the
 * card was made store-agnostic instead. Passing `datasetId`/`artifactId`
 * routes every server-backed tab through the dataset-scoped artifact routes
 * with no `dw*` atom involved, and `showTransforms={false}` keeps its scaler
 * dialog (a WRITE to `dwScalerConfigsAtom`) out of a step whose contract is
 * that it configures nothing. Nothing is shared with the data-studio store any
 * more: supplying both ids also puts the card's tag selection in local state
 * (`useDatasetTagSelection({ isolated: true })`). It previously read
 * `dwHiddenTagsAtom`/`dwFocusedTagAtom` — visibility, not data, but a
 * data-studio session that had hidden tags left this step's Line tab stuck on
 * "Select one or more PI tags to plot", with no sidebar here to undo it.
 */
export function Phase2DatasetReview({ nav }: Props) {
  const dataset = nav.selectedDataset

  const { sources: allSources, loading: sourcesLoading } = useDataSources()
  const { workspaces } = useWorkspaces()

  // The hand-off writes the draft before navigating and aborts on failure —
  // see the hook. This step itself still PATCHes nothing: no mount effect and
  // no control here touches the draft.
  const { leaving, handOff } = useDatasetEditHandoff()
  const [editDialogOpen, setEditDialogOpen] = useState(false)

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

  // Still fetched here, not inside the card: the card's `dataset` prop is the
  // bounded frame its Line/Raw Table tabs render, and this is the step's own
  // bounded read (200 rows x 50 tags — MODEL-FLOW-010-V03's cap). Correlation
  // is no longer fetched here at all; the card asks the server itself.
  const { sample } = useArtifactRows(datasetId, artifactId, tags)

  // DS-LAKE-025-T06. `artifactId` here is the saved dataset's FINAL — the
  // post-`to_model_ready` frame, scaled to [0,1] by default with no UI
  // affordance to have declined. The card's OWN "show scaled preview" toggle
  // (`showScaled` in data-analysis-card.tsx) is inert with `showTransforms=
  // {false}` (`activeScalers` forced to `NO_SCALERS`, so `scaledTagCount` is
  // always 0) — it can only preview a FORWARD scale on top of whatever
  // `dataset` already is, never undo one already baked into the bytes. So
  // this is the one place that can fix it: same `scalingParams` inversion
  // `dataset-detail-sheet.tsx`'s Data preview and the Compare modal's train
  // side already apply, using the same `useArtifactFeatureSpec`.
  const { featureSpec } = useArtifactFeatureSpec(datasetId, artifactId)
  const scalingParams = featureSpec?.scalingParams ?? null

  const engineeringUnitSample = useMemo<Dataset | null>(() => {
    if (!sample) return null
    if (!scalingParams) return sample
    return {
      tags: sample.tags,
      rows: sample.rows.map(row => {
        const cells = { ...row.cells }
        for (const tag of sample.tags) {
          const cell = cells[tag]
          if (!cell) continue
          const inverted = inverseScale(cell.value, scalingParams[tag])
          // Left as-is (still scaled) when it cannot be inverted — never a
          // guessed value, same discipline the other two surfaces use.
          if (inverted !== null) cells[tag] = { ...cell, value: inverted }
        }
        return { ...row, cells }
      }),
    }
  }, [sample, scalingParams])

  // `BoundedSample` is a branded type and the brand is the whole point: it
  // certifies the frame came from a bounded server page. `useArtifactRows`
  // is exactly that, so branding here states a fact rather than dodging the
  // gate — an unbounded frame still cannot reach the card.
  const boundedSample = useMemo(
    () => brandBoundedSample(engineeringUnitSample ?? { tags: [], rows: [] }),
    [engineeringUnitSample],
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

  async function confirmEditDataset() {
    if (!dataset) return
    // Stays open when the draft could not be saved, so the error the hook
    // raises is read next to the action that caused it.
    if (await handOff(dataset, allSources)) setEditDialogOpen(false)
  }

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
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          What this model will train on. Nothing here is configured — that is
          the next step.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={() => setEditDialogOpen(true)}
        >
          <PencilLine className="h-3.5 w-3.5" />
          Edit dataset
        </Button>
      </div>

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
          {/* <section className="space-y-2">
            <p className="text-sm font-semibold text-foreground">
              Per-tag statistics
            </p>
            <PerTagStatsPanel
              stats={perTagStats}
              loading={statsLoading}
              missing={statsMissing}
              error={statsError}
            />
          </section> */}

          <section className="space-y-2">
            <p className="text-sm font-semibold text-foreground">
              Validation Data
            </p>
            <HoldoutPanel
              holdout={holdout}
              loading={holdoutLoading}
              error={holdoutError}
            />
          </section>

          {/* Replaces the old PreviewCorrelationPanel outright rather than
              sitting beside it — the card's Raw Table tab IS that bounded
              preview and its Correlation tab IS those ranked pairs, so
              keeping both would render the same two things twice on one
              screen. The panel file is left in place, so restoring it is a
              one-line change if the tabs turn out to be too much here.

              `range` only picks the trend chart's x-axis tick format; this
              step has no range concept of its own (the artifact's real span
              is shown by SourceIdentityPanel above), so it takes the neutral
              middle option rather than implying a window that was chosen. */}
          <DataAnalysisCard
            dataset={boundedSample}
            range="7d"
            datasetId={datasetId}
            artifactId={artifactId}
            showTransforms={false}
            showTagSelector
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

      {/* Warn-and-navigate, not an overlay and not a URL-addressable resume:
          the dataset wizard is a route, so leaving is a real navigation and
          the dialog says exactly what survives it. The copy may promise a
          resume only because Step 1's Drafts in progress can honour one
          (T08) — and it names that location, so keep the two in step. */}
      <AlertDialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Edit “{dataset.name}”?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  You will leave this wizard and open the dataset in Data
                  Studio.
                </p>
                <p>
                  Your model draft is saved first. Pick it up again from{' '}
                  <span className="font-medium text-foreground">
                    New Model → Step 1 → Drafts in progress
                  </span>{' '}
                  — the browser Back button will not restore it.
                </p>
                <p>
                  If the edit removes the tag you selected as the target, you
                  will be asked to choose a new one when you return.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={leaving}>Stay here</AlertDialogCancel>
            <AlertDialogAction
              disabled={leaving}
              onClick={event => {
                // The dialog closes on click by default; leaving must wait
                // for the PATCH so a failure can keep the user here.
                event.preventDefault()
                void confirmEditDataset()
              }}
            >
              {leaving ? 'Saving draft…' : 'Save draft & edit dataset'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
