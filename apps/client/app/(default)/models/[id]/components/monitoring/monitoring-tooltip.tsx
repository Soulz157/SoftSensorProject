'use client'

import type { MonitoringRow } from '@/lib/monitoring'

interface PayloadItem {
  dataKey?: string | number
  value?: number | number[]
  /** Full source row recharts attaches to every payload item. */
  payload?: Partial<MonitoringRow>
}

interface Props {
  active?: boolean
  payload?: PayloadItem[]
  label?: number
  variant: 'main' | 'residual'
  residualMode?: 'abs' | 'pct'
  formatLabel: (t: number) => string
}

function scalar(
  payload: PayloadItem[],
  key: keyof MonitoringRow,
): number | undefined {
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
 * Shared crosshair tooltip for both synced monitoring charts. `variant` selects
 * which measures to show (main = Actual/Predict, residual = error/%); timestamp
 * is formatted with the active adaptive formatter so it matches the axis.
 */
export function MonitoringTooltip({
  active,
  payload,
  label,
  variant,
  residualMode = 'abs',
  formatLabel,
}: Props) {
  if (!active || !payload || payload.length === 0 || label === undefined) {
    return null
  }

  const actual = scalar(payload, 'actual')
  const predict = scalar(payload, 'predict')
  const residual = scalar(payload, 'residual')
  const pct = scalar(payload, 'percentageError')
  const fmt = (n: number | undefined) => (n === undefined ? '—' : n.toFixed(2))

  return (
    <div className="min-w-44 rounded-lg border border-border bg-popover p-3 text-xs shadow-xl">
      <p className="mb-2 border-b border-border pb-2 font-mono text-muted-foreground">
        {formatLabel(label)}
      </p>
      <div className="space-y-1.5">
        {variant === 'main' ? (
          <>
            <Row color="var(--foreground)" label="Actual" value={fmt(actual)} />
            <Row color="var(--chart-1)" label="Predict" value={fmt(predict)} />
          </>
        ) : (
          <>
            <Row
              color="var(--chart-5)"
              label="Residual"
              value={fmt(residual)}
            />
            <Row
              color="var(--muted-foreground)"
              label="Error %"
              value={pct === undefined ? '—' : `${pct.toFixed(2)}%`}
            />
          </>
        )}
      </div>
      {variant === 'residual' && (
        <p className="mt-2 border-t border-border pt-2 text-[10px] text-muted-foreground">
          Viewing {residualMode === 'pct' ? 'percentage' : 'absolute'} error
        </p>
      )}
    </div>
  )
}
