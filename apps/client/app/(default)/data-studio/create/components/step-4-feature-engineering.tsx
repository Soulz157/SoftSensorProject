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
  dwFeaturedDatasetAtom,
  dwFeaturePresetAtom,
  dwGoldWarmErrorAtom,
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
  const goldWarmError = useAtomValue(dwGoldWarmErrorAtom)
  const targetTag = useAtomValue(dwTargetTagAtom)
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

  // DS-LAKE-006-T06: "Step 4 drives the full feature-engineering transform
  // server-side." No new UI — this fires in the background whenever the
  // recipe settles (debounced inside the hook itself). `featured` below
  // (the LOCAL derived atom driving this component's own panels/tag
  // sidebar) is untouched and stays the bounded interactive preview —
  // genuinely bounded as of DS-LAKE-006-AC5's fix, via
  // `useDatasetFeaturePreviewSample` above, not just in name.
  const warmGold = useDatasetGoldWarm()
  useEffect(() => {
    warmGold(featureConfigs, selectedColumns, scalerConfigs, targetTag)
  }, [warmGold, featureConfigs, selectedColumns, scalerConfigs, targetTag])

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

      {goldWarmError && (
        <p className="text-xs text-muted-foreground">
          Feature engineering failed to run server-side:{' '}
          <span className="text-foreground">{goldWarmError}</span>
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
    </div>
  )
}
