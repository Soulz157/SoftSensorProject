'use client'

import type { ReactNode } from 'react'
import type {
  ColumnRangeDrift,
  InputTrendSeries,
} from '@/services/model-monitoring'
import { DistributionChart } from './distribution-chart'
import { DistributionTable } from './distribution-table'
import { InputDriftStats } from './input-drift-stats'
import { InputTrendChart } from './input-trend-chart'
import { InputWindowTable } from './input-window-table'

interface Props {
  col: ColumnRangeDrift
  series: InputTrendSeries | undefined
  plane: 'window' | 'predict'
  isTarget?: boolean
}

/**
 * MODEL-SERVE-036. Deep Detail for one tag: the trend at full size, the
 * figures behind the badge, the live distribution against training, and
 * the per-window breakdown. All four read the same windows as the badge.
 */
export function InputDriftDetail({
  col,
  series,
  plane,
  isTarget = false,
}: Props) {
  const noRange = col.trainMin === null || col.trainMax === null

  return (
    <div className="space-y-5 px-4 pt-3 pb-4">
      <Section title="Trend">
        {noRange && (
          <p className="mb-2 text-xs text-muted-foreground">
            No training range recorded for this input, so no range lines are
            drawn — retrain the model to record one.
          </p>
        )}
        {series && series.points.length > 0 ? (
          <InputTrendChart
            column={col.column}
            series={series}
            trainMin={col.trainMin}
            trainMax={col.trainMax}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            {isTarget
              ? 'The target is not stored with the input windows, so no trend is drawn. Its verdict comes from each window’s own target counts.'
              : 'No live values for this input in the selected range.'}
          </p>
        )}
      </Section>

      <Section title="Summary">
        <InputDriftStats col={col} series={series} />
      </Section>

      <Section title="Distribution vs training">
        {col.bins && col.status !== 'INSUFFICIENT_DATA' ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <DistributionChart bins={col.bins} liveTotal={col.liveTotal} />
            <DistributionTable bins={col.bins} liveTotal={col.liveTotal} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {col.bins
              ? 'Too few live values to compare distributions yet.'
              : 'No training distribution recorded for this input.'}
          </p>
        )}
      </Section>

      <Section title={plane === 'window' ? 'Per window' : 'Per hour'}>
        <InputWindowTable
          windows={series?.windows ?? []}
          unit={plane === 'window' ? 'window' : 'hour'}
        />
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-medium text-foreground">{title}</h4>
      {children}
    </section>
  )
}
