'use client'

import { useMemo, useState } from 'react'
import { useAtom } from 'jotai'
import {
  BarChart3,
  BoxSelect,
  Eye,
  GitCompareArrows,
  LineChart as LineChartIcon,
  ScatterChart,
  Table2,
  WandSparkles,
} from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  classifyColumns,
  ScalerMethod,
  toChartRows,
  toModelReady,
  type Dataset,
} from '@/lib/preprocessing'
import { tagDistribution } from '@/lib/data-quality'
import type { TimeRange } from '@/lib/mock-readings'
import { dwScalerConfigsAtom } from '@/store/dataset-studio'
import { SegmentedToggle } from '@/app/(default)/data-visualize/components/segmented-toggle'
import { useDatasetTagSelection } from '@/hooks/dataset/use-dataset-tag-selection'
import { useCompareTags } from '@/hooks/dataset/use-compare-tags'
import { ScatterRegressionChart } from '@/app/(default)/data-visualize/components/scatter-regression-chart'
import { RawTrendChart } from '../chart/raw-data-chart'
import { RawReadingsTable } from '../raw-readings-table'
import { TagHistogramChart } from '../chart/tag-histogram-chart'
import { TagBoxplotChart } from '../chart/tag-boxplot-chart'
import { CorrelationHeatmap } from '../correlation-heatmap'
import { CompareTagsPopover } from './compare-tags-popover'
import { FeatureTransformDialog } from '../feature-engineering/transformation-panel'
import { ScrollArea } from '@/components/ui/scroll-area'

interface Props {
  dataset: Dataset
  range: TimeRange
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function DataAnalysisCard({ dataset, range }: Props) {
  const { activeTags, focusedTag, colorForTag, selectAll } =
    useDatasetTagSelection(dataset)
  const { compareTags, toggle, atCap } = useCompareTags(activeTags)
  const [tab, setTab] = useState('line')
  const [scaledView, setScaledView] = useState(false)
  const [isViewAll, setIsViewAll] = useState(false)

  // Persist the scaler choice to the real pipeline config (applied downstream
  // at Step 5 export via toModelReady) instead of a dead-end local state.
  const [scalerConfigs, setScalerConfigs] = useAtom(dwScalerConfigsAtom)

  const handleSetScaler = (column: string, method: ScalerMethod) => {
    setScalerConfigs(prev => ({ ...prev, [column]: method }))
  }

  const columnGroups = useMemo(() => classifyColumns(dataset), [dataset])

  // How many columns have an explicit scaler — only these transform; the rest
  // pass through. Drives the Raw/Scaled toggle enablement + caption.
  const scaledTagCount = useMemo(
    () => dataset.tags.filter(t => scalerConfigs[t]).length,
    [dataset.tags, scalerConfigs],
  )

  // Scale ONLY configured columns: pass 'none' for the rest so toModelReady
  // doesn't default them to min-max.
  const scaledDataset = useMemo(() => {
    const cfg = Object.fromEntries(
      dataset.tags.map(t => [t, scalerConfigs[t] ?? 'none']),
    ) as Record<string, ScalerMethod>
    return toModelReady(dataset, cfg)
  }, [dataset, scalerConfigs])

  const showScaled = scaledView && scaledTagCount > 0

  const chartRows = useMemo(() => toChartRows(dataset), [dataset])
  const statRows = useMemo(
    () => activeTags.map(tag => ({ tag, ...tagDistribution(dataset, tag) })),
    [dataset, activeTags],
  )

  if (dataset.tags.length === 0) return null

  return (
    <div className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      {/* Header + focus chip */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          Data Analysis &amp; Visualization
        </h2>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex w-full flex-col">
        <TabsList className="mb-4 inline-flex flex-wrap gap-4 border-b border-border">
          <TabsTrigger value="line" className="gap-2 cursor-pointer">
            <LineChartIcon className="h-3.5 w-3.5" /> Line Chart
          </TabsTrigger>
          <TabsTrigger value="raw-table" className="gap-2 cursor-pointer">
            <Table2 className="h-3.5 w-3.5" /> Raw Table
          </TabsTrigger>
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

        {(tab === 'histogram' || tab === 'boxplot') && (
          <div className="mb-3 flex justify-end">
            <CompareTagsPopover
              activeTags={activeTags}
              compareTags={compareTags}
              toggle={toggle}
              atCap={atCap}
              colorForTag={colorForTag}
            />
          </div>
        )}

        {tab === 'line' && (
          <div className="mb-3 flex justify-end">
            <Button
              variant={isViewAll ? 'default' : 'outline'}
              size="sm"
              aria-pressed={isViewAll}
              onClick={() =>
                setIsViewAll(v => {
                  const next = !v
                  if (next) selectAll()
                  return next
                })
              }
              className={cn(
                isViewAll &&
                  'cursor-pointer bg-primary text-primary-foreground',
                'cursor-pointer',
              )}
            >
              <Eye className="mr-2 h-3.5 w-3.5" />
              View all
            </Button>
          </div>
        )}

        {tab === 'raw-table' && (
          <div className="mb-3 flex flex-wrap items-center justify-end gap-3">
            {scaledTagCount > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  Scaled — {scaledTagCount} column
                  {scaledTagCount > 1 ? 's' : ''}
                </span>
                <SegmentedToggle
                  ariaLabel="Raw or scaled values"
                  value={scaledView ? 'scaled' : 'raw'}
                  onChange={v => setScaledView(v === 'scaled')}
                  options={[
                    { value: 'raw', label: 'Raw' },
                    { value: 'scaled', label: 'Scaled' },
                  ]}
                />
              </div>
            )}
            <FeatureTransformDialog
              numericColumns={columnGroups.numeric}
              categoricalColumns={columnGroups.categorical}
              scalerConfigs={scalerConfigs}
              setScalerConfig={handleSetScaler}
            />
          </div>
        )}

        <div className="min-w-0">
          <TabsContent value="line" className="mt-0">
            <RawTrendChart
              rows={chartRows}
              tags={activeTags}
              range={range}
              hideTagSelector
              focusedTag={focusedTag}
              isViewAll={isViewAll}
            />
          </TabsContent>
          <TabsContent value="raw-table" className="mt-0">
            <RawReadingsTable
              dataset={showScaled ? scaledDataset : dataset}
              scalers={scalerConfigs}
            />
          </TabsContent>
          <TabsContent value="histogram" className="mt-0">
            <TagHistogramChart dataset={dataset} tags={compareTags} />
          </TabsContent>
          <TabsContent value="boxplot" className="mt-0">
            <TagBoxplotChart dataset={dataset} tags={compareTags} />
          </TabsContent>
          <TabsContent value="scatter" className="mt-0">
            <ScatterRegressionChart dataset={dataset} forcedY={focusedTag[0]} />
          </TabsContent>
          <TabsContent value="correlation" className="mt-0">
            <CorrelationHeatmap
              dataset={dataset}
              highlightTag={focusedTag[0]}
            />
          </TabsContent>
        </div>
      </Tabs>

      {statRows.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <ScrollArea className="h-90 w-full overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background shadow-sm">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-3">Tag</TableHead>
                  <TableHead className="text-right">Mean</TableHead>
                  <TableHead className="text-right">Median</TableHead>
                  <TableHead className="text-right">Max</TableHead>
                  <TableHead className="text-right">Min</TableHead>
                  <TableHead className="text-right">
                    Range
                    <span className="text-xs text-muted-foreground">
                      {' '}
                      (Max-Min)
                    </span>
                  </TableHead>
                  <TableHead className="pr-3 text-right items-center">
                    SD
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statRows.map(row => (
                  <TableRow
                    key={row.tag}
                    className={cn(row.tag === focusedTag[0] && 'bg-muted/50')}
                  >
                    <TableCell className="pl-3">
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: colorForTag(row.tag) }}
                        />
                        <span className="truncate font-mono text-xs">
                          {row.tag}
                        </span>
                        {scalerConfigs[row.tag] &&
                          scalerConfigs[row.tag] !== 'none' && (
                            <span
                              title={`Feature transform: ${scalerConfigs[row.tag]} scaler`}
                              className="inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                            >
                              <WandSparkles className="h-3 w-3 shrink-0" />
                              {scalerConfigs[row.tag]}
                            </span>
                          )}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {fmt(row.mean)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {fmt(row.median)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {fmt(row.max)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {fmt(row.min)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {fmt(row.range)}
                    </TableCell>
                    <TableCell className="pr-3 text-right font-mono text-xs tabular-nums">
                      {fmt(row.std)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}
