'use client'

import { useState } from 'react'
import {
  BarChart3,
  BoxSelect,
  GitCompareArrows,
  ScatterChart,
} from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTagStats } from '@/hooks/use-tag-stats'
import type { Dataset } from '@/lib/preprocessing'
import { TagHistogramChart } from './chart/tag-histogram-chart'
import { TagBoxplotChart } from './chart/tag-boxplot-chart'
import { ScatterRegressionChart } from '@/app/(default)/data-visualize/components/scatter-regression-chart'
import { CorrelationHeatmap } from './correlation-heatmap'
import { TagStatsSidebar } from './tag-stats-sidebar'

interface Props {
  dataset: Dataset
}

type AnalysisTab = 'histogram' | 'boxplot' | 'scatter' | 'correlation'

export function StatisticalAnalysisSection({ dataset }: Props) {
  const [activeTab, setActiveTab] = useState<AnalysisTab>('histogram')
  const {
    allStats,
    selectedTag,
    setSelectedTag,
    selectedRow,
    selectedTags,
    setSelectedTags,
    toggleTag,
  } = useTagStats(dataset)

  if (dataset.tags.length === 0) return null

  const sidebarMode =
    activeTab === 'histogram' || activeTab === 'boxplot' ? 'multi' : 'single'

  return (
    <div className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <h2 className="text-sm font-medium text-foreground">
        Statistical Analysis
      </h2>

      <Tabs
        value={activeTab}
        onValueChange={v => setActiveTab(v as AnalysisTab)}
        className="w-full flex flex-col"
      >
        <TabsList className="mb-4 inline-flex gap-4 border-b border-border">
          <TabsTrigger value="histogram" className="gap-2 cursor-pointer">
            <BarChart3 className="h-3.5 w-3.5" /> Histogram
          </TabsTrigger>
          <TabsTrigger value="boxplot" className="gap-2 cursor-pointer">
            <BoxSelect className="h-3.5 w-3.5" /> Box Plot
          </TabsTrigger>
          <TabsTrigger value="scatter" className="gap-2 cursor-pointer">
            <ScatterChart className="h-3.5 w-3.5" /> Scatter Plot
          </TabsTrigger>
          <TabsTrigger value="correlation" className="gap-2 cursor-pointer">
            <GitCompareArrows className="h-3.5 w-3.5" /> Correlation Heatmap
          </TabsTrigger>
        </TabsList>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
          <div className="min-w-0">
            <TabsContent value="histogram" className="mt-0">
              <TagHistogramChart dataset={dataset} tags={selectedTags} />
            </TabsContent>
            <TabsContent value="boxplot" className="mt-0">
              <TagBoxplotChart dataset={dataset} tags={selectedTags} />
            </TabsContent>
            <TabsContent value="scatter" className="mt-0">
              <ScatterRegressionChart dataset={dataset} forcedY={selectedTag} />
            </TabsContent>
            <TabsContent value="correlation" className="mt-0">
              <CorrelationHeatmap
                dataset={dataset}
                highlightTag={selectedTag}
              />
            </TabsContent>
          </div>

          <TagStatsSidebar
            stats={allStats}
            mode={sidebarMode}
            selectedTag={selectedTag}
            onSelectTag={setSelectedTag}
            selectedRow={selectedRow}
            selectedTags={selectedTags}
            onToggleTag={toggleTag}
            onSetSelectedTags={setSelectedTags}
          />
        </div>
      </Tabs>
    </div>
  )
}
