'use client'

import type { FitRow } from '@/lib/model-metrics'
import { formatWallClockFull } from '@/lib/monitoring'

interface PayloadItem {
  /** Full source row recharts attaches to every payload item. */
  payload?: Partial<FitRow>
}

interface Props {
  active?: boolean
  payload?: PayloadItem[]
  label?: number
  variant: 'fit' | 'residual'
  /** Name of the compared model, when a comparison is active. */
  compareName?: string
}

function scalar(payload: PayloadItem[], key: keyof FitRow): number | undefined {
  const v = payload[0]?.payload?.[key]
  return typeof v === 'number' ? v : undefined
}

function Row({
  color,
  label,
  value,
}: {
  color: string
  label: string
  value: string
}) {
  return (
    <div className="flex items-center justify-between gap-6">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
        />
        {label}
      </span>
      <span className="font-mono font-semibold text-foreground tabular-nums">
        {value}
      </span>
    </div>
  )
}

/**
 * Crosshair tooltip for the two Phase-3 evaluation charts. `variant` selects
 * which measures to show (fit = Actual/Predicted/±1 SD, residual = error).
 *
 * The header is the point's FULL date and time ("Feb 8, 2026 17:30"), not the
 * axis' adaptive form: past a two-day span the axis drops the time of day, and
 * a tooltip exists to name the exact point.
 */
export function EvaluationTooltip({
  active,
  payload,
  label,
  variant,
  compareName,
}: Props) {
  if (!active || !payload || payload.length === 0 || label === undefined) {
    return null
  }

  const fmt = (n: number | undefined) => (n === undefined ? '—' : n.toFixed(2))
  const comparePredict = scalar(payload, 'comparePredict')
  const compareResidual = scalar(payload, 'compareResidual')
  const pct = scalar(payload, 'percentageError')

  return (
    <div className="min-w-48 rounded-lg border border-border bg-popover p-3 text-xs shadow-xl">
      <p className="mb-2 border-b border-border pb-2 font-mono text-muted-foreground">
        {formatWallClockFull(label)}
      </p>
      <div className="space-y-1.5">
        {variant === 'fit' ? (
          <>
            <Row
              color="var(--foreground)"
              label="Actual"
              value={fmt(scalar(payload, 'actual'))}
            />
            <Row
              color="var(--chart-1)"
              label="Predicted"
              value={fmt(scalar(payload, 'predict'))}
            />
            {/* {Array.isArray(band) && (
              <Row
                color="var(--chart-2)"
                label="±1 SD"
                value={`${fmt(band[0])} – ${fmt(band[1])}`}
              />
            )} */}
            {compareName && comparePredict !== undefined && (
              <Row
                color="var(--chart-4)"
                label={compareName}
                value={fmt(comparePredict)}
              />
            )}
          </>
        ) : (
          <>
            <Row
              color="var(--chart-1)"
              label="Residual"
              value={fmt(scalar(payload, 'residual'))}
            />
            <Row
              color="var(--muted-foreground)"
              label="Error %"
              value={pct === undefined ? '—' : `${pct.toFixed(2)}%`}
            />
            {compareName && compareResidual !== undefined && (
              <Row
                color="var(--chart-4)"
                label={compareName}
                value={fmt(compareResidual)}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
