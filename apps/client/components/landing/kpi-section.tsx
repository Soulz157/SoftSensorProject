'use client'

import {
  DEMO_MODEL,
  demoKpis,
  formatKpiValue,
  predictionAt,
  predictionHistory,
  sparkPoints,
  type DemoKpi,
} from '@/lib/landing-demo'
import { useDemoTick } from '@/hooks/landing/use-demo-tick'
import { DayTimeline } from './day-timeline'

export const KPI_SECTION_ID = 'landing-kpis'

const SPARK_W = 48
const SPARK_H = 16

/**
 * Below the landing hero, reached by scrolling: sensor vs lab over the last
 * 24 hours, then four KPI tiles. Ticks once a second (the timeline's "now",
 * the first tile's live prediction); reduced motion holds it still.
 * Illustrative data only.
 */
export function KpiSection() {
  const step = useDemoTick()

  return (
    <section
      id={KPI_SECTION_ID}
      aria-labelledby={`${KPI_SECTION_ID}-title`}
      className="relative z-10 scroll-mt-6 border-t border-border px-6 py-16 md:px-10"
    >
      <div className="mb-8 max-w-2xl space-y-2">
        <h2
          id={`${KPI_SECTION_ID}-title`}
          className="text-xl font-semibold tracking-[-0.02em] text-balance"
        >
          A lab value every hour, not every 6 hours.
        </h2>
        <p className="text-sm text-muted-foreground">
          One illustrative model, scored the way the app scores yours.
        </p>
      </div>
      <DayTimeline step={step} />
      <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {demoKpis().map(k => (
          <KpiTile key={k.id} kpi={k} step={step} />
        ))}
      </ul>
    </section>
  )
}

function KpiTile({ kpi, step }: { kpi: DemoKpi; step: number }) {
  return (
    <li className="flex min-w-0 flex-col gap-1 rounded-lg bg-card p-4 ring-1 ring-foreground/10">
      <span className="text-sm text-muted-foreground">{kpi.label}</span>
      <span className="font-mono text-2xl font-semibold tracking-tight text-foreground tabular-nums">
        <span className="whitespace-nowrap">
          {formatKpiValue(kpi.value, kpi.digits)}
        </span>
        {kpi.unit && (
          <span className="ml-1.5 text-sm font-normal text-muted-foreground">
            {kpi.unit}
          </span>
        )}
      </span>
      <span className="text-xs text-muted-foreground">{kpi.note}</span>
      {kpi.live && <LiveReadout step={step} />}
    </li>
  )
}

function LiveReadout({ step }: { step: number }) {
  // Wraps (never truncates) so a narrow phone tile still shows the value.
  return (
    <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-2 font-mono text-xs text-muted-foreground">
      <svg
        width={SPARK_W}
        height={SPARK_H}
        className="shrink-0 overflow-visible"
        aria-hidden
      >
        <polyline
          points={sparkPoints(predictionHistory(step), SPARK_W, SPARK_H)}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="1.25"
          strokeLinejoin="round"
        />
      </svg>
      <span className="whitespace-nowrap">
        Now{' '}
        <span className="text-foreground tabular-nums">
          {predictionAt(step).toFixed(1)} {DEMO_MODEL.unit}
        </span>
      </span>
    </span>
  )
}
