'use client'

import { useEffect } from 'react'
import { useAtomValue } from 'jotai'
import { Binary, Wrench } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import {
  featureColumnName,
  type FeatureConfig,
} from '@/lib/feature-engineering'
import {
  dwDraftArtifactIdAtom,
  dwEditRootValidationRowCountAtom,
  dwFeaturedDatasetAtom,
  dwFeaturePresetAtom,
  dwFeaturePreviewSampleStateAtom,
  dwHoldoutRangeAtom,
  dwModeAtom,
  dwRawDatasetAtom,
  dwTargetTagAtom,
  dwTimeRangeAtom,
} from '@/store/dataset-studio'
import type { UseDatasetPipelineNavResult } from '@/hooks/dataset/use-dataset-pipeline-nav'
import { useDatasetGoldWarm } from '@/hooks/dataset/use-dataset-gold-warm'
import { useDatasetFeaturePreviewSample } from '@/hooks/dataset/use-dataset-feature-preview-sample'
import { ExtractionPanel } from './feature-engineering/extraction-panel'
import { CreationPanel } from './feature-engineering/creation-panel'
import { DataAnalysisCard } from './processing/data-analysis-card'
import { ValidationHoldoutSection } from './processing/validation-holdout-section'
import { PERIOD_TO_RANGE } from '@/store/model-pipeline'
import { cn } from '@/lib/utils'
import { EditLockBanner } from './step-1-tags'

interface Props {
  nav: UseDatasetPipelineNavResult
}

/**
 * Step 4 — Feature Engineering. Authors the `FeatureConfig[]` recipe (plus
 * per-column scaling and selection) that the pipeline applies as
 * raw → applyFeatures → precleanse → fill → select → scale. Column NAMES
 * (`raw.tags`) come from `dwRawDatasetAtom`; the live preview VALUES
 * (`featured`, below) come from a bounded server page, not the full raw
 * dataset — see `useDatasetFeaturePreviewSample` (DS-LAKE-006-AC5).
 */
export function Step4FeatureEngineering({ nav }: Props) {
  const raw = useAtomValue(dwRawDatasetAtom)
  const featurePreset = useAtomValue(dwFeaturePresetAtom)
  const targetTag = useAtomValue(dwTargetTagAtom)
  const holdoutRange = useAtomValue(dwHoldoutRangeAtom)
  const previewFetchState = useAtomValue(dwFeaturePreviewSampleStateAtom)
  const mode = useAtomValue(dwModeAtom)
  const sourceArtifactId = useAtomValue(dwDraftArtifactIdAtom)
  // DS-LAKE-024-T03: create mode has no equivalent gate at all (it always
  // had a pinned BRONZE source), so this is true there unconditionally.
  // Edit mode arms once `useDatasetEditHydration` resolves the edit draft's
  // BRONZE into `sourceArtifactId` — see the comment above
  // `ValidationHoldoutSection` below for why this and `featureBearing` move
  // together.
  const editModeArmed = mode !== 'edit' || Boolean(sourceArtifactId)
  // DS-LAKE-024-T04. A DIFFERENT condition from `editModeArmed`, layered on
  // top of it: even once the edit draft's root has resolved, the picker
  // must stay disabled if THAT root was already split at materialize time
  // — re-splitting it would silently double-cut rows, since
  // `startFeaturesJob` (this section's live apply path) has no guard of
  // its own (see `dwEditRootValidationRowCountAtom`'s doc comment). Zero
  // instances in production data today (every adopted root is pristine),
  // but the branch is real — a resplit child's own root is not.
  const rootValidationRowCount = useAtomValue(dwEditRootValidationRowCountAtom)
  const editRootIsPristine = mode !== 'edit' || rootValidationRowCount === null
  const holdoutDisabledReason =
    editModeArmed && !editRootIsPristine
      ? 'This dataset was already split into a validation holdout when it was fetched — re-fetch it from source to choose a new one.'
      : undefined
  useDatasetFeaturePreviewSample()
  const {
    featureConfigs,
    setFeatureConfigs,
    selectedColumns,
    setSelectedColumns,
    scalerConfigs,
  } = nav

  const period = useAtomValue(dwTimeRangeAtom)
  const range = PERIOD_TO_RANGE[period]

  // RESOLVED (DS-LAKE-024): an earlier version of this block called
  // `ensureDraft`/`ensureBronze` here to seed `dwDraftArtifactIdAtom` with a
  // FRESH raw BRONZE on Step 4 mount — a NEW source fetch, silently
  // discarding whatever cleaning the saved recipe already described. That
  // was reverted (2026-08-25) before it shipped. DS-LAKE-024 answers "how
  // should edit mode source this job" properly instead of seeding it here:
  // `useDatasetEditHydration` resolves (or creates) a real edit draft as
  // soon as the wizard mounts, pointing `dwDraftArtifactIdAtom` at the
  // dataset's own already-adopted, lineage-pinned BRONZE — same bytes, no
  // new fetch. `sourceArtifactId` below is therefore non-null as soon as
  // that resolves, which is what arms `ValidationHoldoutSection` below: the
  // reordered pipeline (DS-LAKE-022/023) cuts the holdout at THIS stage,
  // before cleaning runs, in both modes — so waiting for a clean pass first
  // would be waiting for a stage that comes later, not earlier.

  // DS-LAKE-006-T06: "Step 4 drives the full feature-engineering transform
  // server-side." No new UI — this fires in the background whenever the
  // recipe settles (debounced inside the hook itself). `featured` below
  // (the LOCAL derived atom driving this component's own panels/tag
  // sidebar) is untouched and stays the bounded interactive preview —
  // genuinely bounded as of DS-LAKE-006-AC5's fix, via
  // `useDatasetFeaturePreviewSample` above, not just in name.
  //
  // DS-LAKE-023 (edit-mode re-split pass): `holdoutRange` joins the recipe
  // as a 5th dependency, in BOTH modes now — picking/clearing a holdout
  // below re-fires this SAME debounced warm, exactly like editing a
  // feature config does, so a holdout edit and a recipe edit can never
  // race into two competing job calls. `warmState`/`warmError` drive
  // `ValidationHoldoutSection`'s "Applying…" and, via
  // `dwFeatureArtifactStampAtom`, `useDatasetCleaningScaleCommit`'s
  // stale-artifact refusal at Step 5.
  const {
    warm: warmGold,
    status: warmState,
    error: warmError,
  } = useDatasetGoldWarm()
  useEffect(() => {
    warmGold(
      featureConfigs,
      selectedColumns,
      scalerConfigs,
      targetTag,
      holdoutRange,
    )
  }, [
    warmGold,
    featureConfigs,
    selectedColumns,
    scalerConfigs,
    targetTag,
    holdoutRange,
  ])

  const originalColumns = raw.tags
  const featured = useAtomValue(dwFeaturedDatasetAtom)
  const allColumns = featured.tags
  // DS-LAKE-005B-D-T07: DataAnalysisCard now takes `featured` directly
  // (the bounded local preview above) instead of a separately-computed
  // full-frame `analysisDataset` — the gap DS-LAKE-005B-B-T01's
  // blockedReason named (no server endpoint could supply its histogram/
  // boxplot/scatter/correlation data) is closed as of D-T01/T03/T04/T05b;
  // `dataset` is now `BoundedSample`-typed on that component and a
  // HEAD-1,000 sample is exactly what it's built to accept.

  const addFeature = (cfg: FeatureConfig) => {
    setFeatureConfigs(prev => [...prev, cfg])
    if (selectedColumns !== null) {
      const col = featureColumnName(cfg)
      if (!selectedColumns.includes(col)) {
        setSelectedColumns([...selectedColumns, col])
      }
    }
  }

  const removeFeature = (id: string) => {
    setFeatureConfigs(prev => prev.filter(c => c.id !== id))
    const cfg = featureConfigs.find(c => c.id === id)
    if (cfg && selectedColumns !== null) {
      const col = featureColumnName(cfg)
      setSelectedColumns(selectedColumns.filter(c => c !== col))
    }
  }

  const renameFeature = (id: string, newName: string) => {
    const cfg = featureConfigs.find(c => c.id === id)
    if (!cfg || cfg.kind !== 'formula') return

    const oldCol = featureColumnName(cfg)
    const newCol = featureColumnName({ ...cfg, name: newName })
    if (newCol === oldCol) return

    setFeatureConfigs(prev =>
      prev.map(c => (c.id === id ? { ...c, name: newName } : c)),
    )
    if (selectedColumns !== null) {
      setSelectedColumns(
        selectedColumns.map(col => (col === oldCol ? newCol : col)),
      )
    }
  }

  const selectedCount =
    selectedColumns === null ? allColumns.length : selectedColumns.length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-foreground">
            Feature Engineering
          </h2>
          <p className="text-xs text-muted-foreground">
            Extract, create, scale, and select the columns for your dataset.
          </p>
          {featurePreset && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Applied from preset:{' '}
              <span className="font-mono text-foreground">
                {featurePreset.name}
              </span>
            </p>
          )}
        </div>
        <Badge variant="secondary" className="tabular-nums">
          {selectedCount} / {allColumns.length} features
        </Badge>
      </div>

      {/* DS-LAKE-024-T07. Was: "Features and column selection are locked
          while editing preprocessing" — commented out, not corrected, when
          T02 gave edit mode a real draft and made adding a feature here
          actually work (that banner's own claim went false the moment it
          did). Restated instead of restored: features/column-selection are
          NOT locked in edit mode, but the underlying TAG SET is (Step 1) —
          openDecisions[2]'s boundary, stated here because this is where a
          user would naturally try to reference a tag that was never
          fetched. Every panel below already REFUSES that reference
          (ExtractionPanel/CreationPanel/FormulaPanel's source-column
          pickers and free-text validators are all bounded to
          `originalColumns` = `raw.tags`) — this banner explains the refusal
          instead of leaving it to be discovered as a disabled Add button. */}
      {mode === 'edit' && (
        <EditLockBanner>
          You can create features from this dataset&apos;s existing tags and
          choose which columns to keep — but you can&apos;t add a tag that
          wasn&apos;t originally fetched (Step 1 is locked). An expression
          referencing one is refused, not silently computed.
        </EditLockBanner>
      )}

      {warmError && (
        <p className="text-xs text-muted-foreground">
          Feature engineering failed to run server-side:{' '}
          <span className="text-foreground">{warmError}</span>
        </p>
      )}

      <Tabs
        defaultValue="creation"
        className={cn(
          'flex flex-col space-y-4',
          // locked && 'pointer-events-none opacity-60',
        )}
      >
        <TabsList className="flex h-11 items-center justify-start rounded-lg bg-muted/50 p-1 w-full max-w-2xl">
          <TabsTrigger
            value="creation"
            className="flex-1 flex items-center justify-center gap-2 h-9 text-xs sm:text-sm"
          >
            <Wrench className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Creation</span>
            <span className="sm:hidden">Create</span>
          </TabsTrigger>
          <TabsTrigger
            value="extraction"
            className="flex-1 flex items-center justify-center gap-2 h-9 text-xs sm:text-sm"
          >
            <Binary className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Extraction</span>
            <span className="sm:hidden">Extract</span>
          </TabsTrigger>
        </TabsList>

        <div className="rounded-xl border border-border bg-card p-6 min-h-100">
          <TabsContent
            value="creation"
            className="m-0 border-none p-0 outline-none"
          >
            <CreationPanel
              sourceColumns={originalColumns}
              features={featureConfigs}
              onAdd={addFeature}
              onRemove={removeFeature}
              onRename={renameFeature}
            />
          </TabsContent>

          <TabsContent
            value="extraction"
            className="m-0 border-none p-0 outline-none"
          >
            <ExtractionPanel
              sourceColumns={originalColumns}
              features={featureConfigs}
              onAdd={addFeature}
              onRemove={removeFeature}
            />
          </TabsContent>
        </div>

        <ValidationHoldoutSection
          // DS-LAKE-023 (edit-mode re-split pass): also gated on the warm
          // itself being pending. `previewFetchState` reflects a bounded
          // HEAD-page preview fetch, which can read 'ready' while the
          // CURRENT recipe's own features job is still in flight — without
          // this, Apply could fire against a source artifact that is about
          // to be replaced by that in-flight job.
          //
          // DS-LAKE-024-T03: edit mode additionally requires `sourceArtifactId`
          // — without it, `warmGold` would silently no-op on Apply, the exact
          // D6 bug this pass exists to fix. `editModeArmed` below is the SAME
          // condition `featureBearing` uses: the two are armed together or
          // neither, because a picker that is clickable but not feature-bearing
          // just routes Apply through the legacy, non-feature-bearing resplit
          // path instead of silently doing nothing — a different-looking
          // version of the same defect.
          disabled={
            previewFetchState !== 'ready' ||
            warmState === 'pending' ||
            !editModeArmed ||
            !editRootIsPristine
          }
          disabledReason={holdoutDisabledReason}
          featureBearing={editModeArmed}
          status={warmState}
          error={warmError}
        />

        <DataAnalysisCard dataset={featured} range={range} />
      </Tabs>
    </div>
  )
}
