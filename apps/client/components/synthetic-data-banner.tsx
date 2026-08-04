'use client'

import { FlaskConical } from 'lucide-react'

interface Props {
  /** Why real rows could not be loaded. Shown verbatim. */
  reason: string
}

/**
 * Says, out loud, that the rows on screen were GENERATED rather than read from
 * the data source.
 *
 * This banner is the entire safety property of the fallback path. Synthetic
 * readings are numerically plausible — correct tag names, believable ranges, a
 * sensible time axis — so nothing in the table, the charts or the statistics
 * distinguishes them from real measurements. Without it, a legacy recipe that
 * cannot be replayed would quietly present invented numbers as data, and
 * someone could tune a model against them.
 *
 * Neutral styling rather than a warning colour: red and amber are reserved for
 * workspace and plant status in this product, and borrowing them here would
 * dilute the one place operators rely on them.
 */
export function SyntheticDataBanner({ reason }: Props) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 px-4 py-3"
    >
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
      <div className="space-y-0.5 text-sm">
        <p className="font-medium text-foreground">
          Preview data is simulated — not your source data
        </p>
        <p className="text-muted-foreground">
          {reason} The values below are generated for layout only. Re-fetch this
          dataset from its source to work with real measurements.
        </p>
      </div>
    </div>
  )
}
