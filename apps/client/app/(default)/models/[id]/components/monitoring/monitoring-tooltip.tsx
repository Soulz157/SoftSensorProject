'use client'

import type { LiveOverlayRow, MonitoringRow } from '@/lib/monitoring'

/** MODEL-SERVE-011-T09. `LiveOverlayRow` widens `MonitoringRow` with the
 *  keys the chart ALREADY draws — `live`, `held`, `heldDeviation`. The
 *  tooltip was still typed to `MonitoringRow` alone, so those three points
 *  read "—" on a crosshair that was sitting on a visible point. */
type TooltipRow = MonitoringRow & LiveOverlayRow

interface PayloadItem {
  dataKey?: string | number
  value?: number | number[]
  /** Full source row recharts attaches to every payload item. */
  payload?: Partial<TooltipRow>
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
  key: keyof TooltipRow,
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
  // MODEL-SERVE-011-T09/T13. The keys the chart draws and this tooltip did
  // did not read. They keep their OWN keys upstream for a safety reason
  // (`held` must never reach the residual or the SD band, and `live` and
  // `predict` are different artifacts with different provenance) — that
  // separation is correct and stays. What was missing is only the READ.
  const scheduled = scalar(payload, 'scheduled')
  const held = scalar(payload, 'held')
  const heldDeviation = scalar(payload, 'heldDeviation')
  const fmt = (n: number | undefined) => (n === undefined ? '—' : n.toFixed(2))
  // A live-overlay point carries no measured pair by construction. Showing
  // its own values INSTEAD of two dashes is the whole fix; showing both
  // would imply the pair exists.
  const hasMeasuredPair = actual !== undefined || predict !== undefined
  // Same question one chart down: a residual and an error % exist only for a
  // MEASURED pair, so a live-overlay point has neither — and printing two
  // dashes beside a visible point says "this could not be computed" about a
  // point that was never in that calculation to begin with.
  const hasMeasuredError = residual !== undefined || pct !== undefined

  return (
    <div className="min-w-44 rounded-lg border border-border bg-popover p-3 text-xs shadow-xl">
      <p className="mb-2 border-b border-border pb-2 font-mono text-muted-foreground">
        {formatLabel(label)}
      </p>
      <div className="space-y-1.5">
        {variant === 'main' ? (
          <>
            {/* The measured pair, unchanged and unqualified — when a point
                has one, that is what a reader is looking at. Kept even when
                both are absent IF nothing else is present, so the tooltip
                never renders as an empty box. */}
            {(hasMeasuredPair ||
              (held === undefined && scheduled === undefined)) && (
              <>
                <Row
                  color="var(--chart-1)"
                  label="Actual"
                  value={fmt(actual)}
                />
                <Row
                  color="var(--chart-4)"
                  label="Predict"
                  value={fmt(predict)}
                />
              </>
            )}
            {/* QUALIFIED LABELS, deliberately. `held` is the target's last
                REPORTED value carried forward by PI — the chart draws it as
                a dashed step under the Actual identity (operator decision
                2026-09-17), but a tooltip is where the reader asks "what IS
                this number", and "Actual" unqualified would claim a
                measurement that was not taken in this interval. Same for
                `live`: it wears the Predict identity on screen, and here it
                says which plane produced it. */}
            {held !== undefined && (
              <Row
                color="var(--chart-1)"
                label="Actual (last reported)"
                value={fmt(held)}
              />
            )}
            {/* MODEL-SERVE-011-T13. Plain "Predict": this chart now carries
                only the window plane, so there is no other prediction for
                the word to be confused with. It stays QUALIFIED in the one
                case where both window-plane series land on a single row —
                two identical labels holding different numbers would be
                worse than a longer one. */}
            {scheduled !== undefined && (
              <Row
                color="var(--chart-4)"
                label={predict === undefined ? 'Predict' : 'Predict (hour avg)'}
                value={fmt(scheduled)}
              />
            )}
          </>
        ) : (
          <>
            {(hasMeasuredError || heldDeviation === undefined) && (
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
            {/* NEVER called a residual. This is `live - held`: the model
                against the last value the lab reported, which on this plant
                is roughly daily. It is excluded from RMSE, R2 and the SD
                band for exactly that reason, and its label has to keep
                saying so. The residual chart already DRAWS this series — it
                simply had no row here either. */}
            {heldDeviation !== undefined && (
              <Row
                color="var(--chart-5)"
                label="Vs last reported"
                value={fmt(heldDeviation)}
              />
            )}
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
