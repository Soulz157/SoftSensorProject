'use client'

import { Info, TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { GoldRowDropEstimate } from '@/lib/preprocessing'

/** From this share of rows dropped, the notice is a warning, not a note. */
export const GOLD_ROW_LOSS_WARN_PCT = 50

const nf = new Intl.NumberFormat('en-US')
// One decimal below 10% and near 100%, so a few rows kept never reads as
// "100%" (36,309 of 36,480 is 99.5%, not all of them).
const pct = (n: number) => {
  if (n >= 99.5 && n < 100) return `${(Math.floor(n * 10) / 10).toFixed(1)}%`
  return `${n < 10 ? n.toFixed(1) : Math.round(n)}%`
}

/**
 * Step 5, above Continue: how many rows the saved (GOLD) dataset will lose.
 *
 * The server drops every row that still holds a non-Good reading in a saved
 * feature tag (`estimateGoldRowDrop` mirrors that rule). An Exclude range
 * marks readings Bad and keeps their values, so without a fill step after it
 * each one costs its whole row — the preview of one tag never shows that.
 * Nothing when no row is lost; a neutral note below GOLD_ROW_LOSS_WARN_PCT;
 * a warning at or above it; Continue is disabled by the caller when every
 * row would go.
 */
export function GoldRowLossNotice({
  estimate,
}: {
  estimate: GoldRowDropEstimate
}) {
  const { total, dropped, kept, byTag } = estimate
  if (total === 0 || dropped === 0) return null

  const share = (dropped / total) * 100
  const warn = kept === 0 || share >= GOLD_ROW_LOSS_WARN_PCT
  const top = byTag.slice(0, 3)
  const Icon = warn ? TriangleAlert : Info

  return (
    <Alert variant={warn ? 'destructive' : 'default'} role="status">
      <Icon />
      <AlertTitle>
        {kept === 0
          ? `Saving would remove all ${nf.format(total)} rows`
          : `Saving will remove ${nf.format(dropped)} of ${nf.format(total)} rows (${pct(share)})`}
      </AlertTitle>
      <AlertDescription>
        <p>
          A row is removed from the saved dataset when any tag in it is Bad —
          excluded by a range, or Bad from the source with no fill step.
        </p>
        {top.length > 0 && (
          <p>
            Most from{' '}
            {top.map((t, i) => (
              <span key={t.tag}>
                {i > 0 && ', '}
                <span className="font-mono">{t.tag}</span> {pct(t.pct)}
              </span>
            ))}
            .
          </p>
        )}
        <p>
          To keep rows: switch the range to Clip, widen it, or add a fill step
          for these tags.
          {kept === 0 && ' Continue stays off until at least one row is kept.'}
        </p>
      </AlertDescription>
    </Alert>
  )
}
