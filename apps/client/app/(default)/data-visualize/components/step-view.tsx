'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { LineChart, ScatterChart, Table2 } from 'lucide-react'
import { SegmentedToggle } from './segmented-toggle'
import { DataTableView } from './data-table-view'
import { SensorTrendChart } from './sensor-trend-chart'
import { ScatterRegressionChart } from './scatter-regression-chart'
import { toChartRows, type Dataset } from '@/lib/preprocessing'
import type { TimeRange } from '@/lib/mock-readings'

type ViewMode = 'chart' | 'table'
type ChartKind = 'series' | 'scatter'

interface Props {
  dataset: Dataset
  range: TimeRange
  showQuality?: boolean
  summary?: ReactNode
}

export function StepView({ dataset, range, showQuality, summary }: Props) {
  const [view, setView] = useState<ViewMode>('chart')
  const [kind, setKind] = useState<ChartKind>('series')
  const rows = useMemo(() => toChartRows(dataset), [dataset])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{summary}</p>
        <div className="flex items-center gap-2">
          {view === 'chart' && (
            <SegmentedToggle
              ariaLabel="Chart type"
              value={kind}
              onChange={setKind}
              options={[
                {
                  value: 'series',
                  label: 'Time-series',
                  icon: <LineChart className="h-3.5 w-3.5" />,
                },
                {
                  value: 'scatter',
                  label: 'Scatter',
                  icon: <ScatterChart className="h-3.5 w-3.5" />,
                },
              ]}
            />
          )}
          <SegmentedToggle
            ariaLabel="View mode"
            value={view}
            onChange={setView}
            options={[
              {
                value: 'chart',
                label: 'Chart',
                icon: <LineChart className="h-3.5 w-3.5" />,
              },
              {
                value: 'table',
                label: 'Table',
                icon: <Table2 className="h-3.5 w-3.5" />,
              },
            ]}
          />
        </div>
      </div>

      {view === 'table' ? (
        <DataTableView dataset={dataset} showQuality={showQuality} />
      ) : kind === 'series' ? (
        <SensorTrendChart rows={rows} tags={dataset.tags} range={range} />
      ) : (
        <ScatterRegressionChart dataset={dataset} />
      )}
    </div>
  )
}
