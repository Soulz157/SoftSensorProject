'use client'

import { useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { Binary, CheckSquare, Wrench } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import {
  applyFeatures,
  featureColumnName,
  type FeatureConfig,
} from '@/lib/feature-engineering'
import { dwRawDatasetAtom, dwTimeRangeAtom } from '@/store/dataset-studio'
import type { UseDatasetPipelineNavResult } from '@/hooks/dataset/use-dataset-pipeline-nav'
import { ExtractionPanel } from './feature-engineering/extraction-panel'
import { CreationPanel } from './feature-engineering/creation-panel'
import { SelectionPanel } from './feature-engineering/selection-panel'
import { DataAnalysisCard } from './processing/data-analysis-card'
import { useDatasetTagSelection } from '@/hooks/dataset/use-dataset-tag-selection'
import { PERIOD_TO_RANGE } from '@/store/model-pipeline'

interface Props {
  nav: UseDatasetPipelineNavResult
}

/**
 * Step 4 — Feature Engineering. Authors the `FeatureConfig[]` recipe (plus
 * per-column scaling and selection) that the pipeline applies as
 * raw → applyFeatures → precleanse → fill → select → scale. All columns are
 * derived from the real fetched dataset (`dwRawDatasetAtom`).
 */
export function Step4FeatureEngineering({ nav }: Props) {
  const raw = useAtomValue(dwRawDatasetAtom)
  const {
    featureConfigs,
    setFeatureConfigs,
    selectedColumns,
    setSelectedColumns,
  } = nav

  const period = useAtomValue(dwTimeRangeAtom)
  const range = PERIOD_TO_RANGE[period]

  const originalColumns = raw.tags
  const featured = useMemo(
    () => applyFeatures(raw, featureConfigs),
    [raw, featureConfigs],
  )
  const engineeredColumns = useMemo(
    () => featured.tags.filter(t => !originalColumns.includes(t)),
    [featured.tags, originalColumns],
  )
  const allColumns = featured.tags

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
        </div>
        <Badge variant="secondary" className="tabular-nums">
          {selectedCount} / {allColumns.length} features
        </Badge>
      </div>

      <Tabs defaultValue="extraction" className="flex flex-col space-y-4">
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

        <DataAnalysisCard dataset={raw} range={range} />
      </Tabs>
    </div>
  )
}
