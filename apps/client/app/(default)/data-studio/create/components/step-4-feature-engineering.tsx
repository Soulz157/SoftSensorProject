'use client'

import { useEffect, useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { Binary, CheckSquare, Wrench } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import {
  featureColumnName,
  type FeatureConfig,
} from '@/lib/feature-engineering'
import {
  dwDraftArtifactIdAtom,
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
import { SelectionPanel } from './feature-engineering/selection-panel'
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

  // HOLD — DS-LAKE-023 edit-mode re-split pass, in progress. The earlier
  // version of this block called `ensureDraft`/`ensureBronze` here to seed
  // `dwDraftArtifactIdAtom` with a fresh raw BRONZE on Step 4 mount. Found
  // (2026-08-25) to be WRONG before it shipped: in edit mode this atom is
  // the pipeline's CHAINED source — `useDatasetDraftPipeline.applyClean`
  // advances it to the CLEANED SILVER once Step 5 runs — not a pinned
  // BRONZE the way create mode keeps it. Seeding it with raw BRONZE here
  // would make the warm below run features+scale on UNCLEANED rows,
  // silently skipping cleaning for any edit-mode holdout re-split. There is
  // also no stored pointer to the pre-features cleaned artifact of the
  // original run to adopt instead (`adoptedBronzeArtifactId` names only the
  // RAW lineage root). Reverted pending a decision on how edit mode should
  // source this job — see this session's own findings for the two real
  // options. `sourceArtifactId`/`mode` stay read above for
  // `ValidationHoldoutSection`'s gating below.

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
  const engineeredColumns = useMemo(
    () => featured.tags.filter(t => !originalColumns.includes(t)),
    [featured.tags, originalColumns],
  )
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

      {/* {locked && (
        <EditLockBanner>
          Features and column selection are locked while editing preprocessing —
          they define the schema downstream models depend on.
        </EditLockBanner>
      )} */}

      {warmError && (
        <p className="text-xs text-muted-foreground">
          Feature engineering failed to run server-side:{' '}
          <span className="text-foreground">{warmError}</span>
        </p>
      )}

      <Tabs
        defaultValue="extraction"
        className={cn(
          'flex flex-col space-y-4',
          // locked && 'pointer-events-none opacity-60',
        )}
      >
        <TabsList className="flex h-11 items-center justify-start rounded-lg bg-muted/50 p-1 w-full max-w-2xl">
          <TabsTrigger
            value="extraction"
            className="flex-1 flex items-center justify-center gap-2 h-9 text-xs sm:text-sm"
          >
            <Binary className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Extraction</span>
            <span className="sm:hidden">Extract</span>
          </TabsTrigger>
          <TabsTrigger
            value="creation"
            className="flex-1 flex items-center justify-center gap-2 h-9 text-xs sm:text-sm"
          >
            <Wrench className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Creation</span>
            <span className="sm:hidden">Create</span>
          </TabsTrigger>
          <TabsTrigger
            value="selection"
            className="flex-1 flex items-center justify-center gap-2 h-9 text-xs sm:text-sm"
          >
            <CheckSquare className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Selection</span>
            <span className="sm:hidden">Select</span>
          </TabsTrigger>
        </TabsList>

        <div className="rounded-xl border border-border bg-card p-6 min-h-100">
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
            value="selection"
            className="m-0 border-none p-0 outline-none"
          >
            <SelectionPanel
              allColumns={allColumns}
              engineeredColumns={engineeredColumns}
              selectedColumns={selectedColumns}
              setSelectedColumns={setSelectedColumns}
            />
          </TabsContent>
        </div>

        <DataAnalysisCard dataset={featured} range={range} />
      </Tabs>

      <ValidationHoldoutSection
        // DS-LAKE-023 (edit-mode re-split pass): also gated on the warm
        // itself being pending. `previewFetchState` reflects a bounded
        // HEAD-page preview fetch, which can read 'ready' while the
        // CURRENT recipe's own features job is still in flight — without
        // this, Apply could fire against a source artifact that is about
        // to be replaced by that in-flight job.
        //
        // Edit mode additionally requires `sourceArtifactId` (see the HOLD
        // comment above `warmGold`): without it, `warmGold` would silently
        // no-op on Apply — the atom write would land but nothing would ever
        // reach the server, the exact D6 bug this pass exists to fix, just
        // reintroduced from a different angle. Left disabled rather than
        // silently broken until edit mode's source question is resolved.
        disabled={
          previewFetchState !== 'ready' ||
          warmState === 'pending' ||
          (mode === 'edit' && !sourceArtifactId)
        }
        // Edit mode's holdout is NOT feature-bearing yet — see the HOLD
        // comment above `warmGold`. Stays conditional until that's settled.
        featureBearing={mode !== 'edit'}
        status={warmState}
        error={warmError}
      />
    </div>
  )
}
