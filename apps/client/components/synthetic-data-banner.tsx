'use client'

import { FlaskConical } from 'lucide-react'

interface Props {
  /** Why real rows could not be loaded. Shown verbatim in the default
   * message; ignored when `message` is supplied. */
  reason: string
  /** Override for the default "Preview data is simulated" headline — used
   * by the edit-mode non-BRONZE warning (DS-LAKE-013), which is not about
   * synthetic rows at all but reuses this banner's neutral styling. */
  title?: string
  /** Override for the default synthetic-data body copy. */
  message?: string
}

/**
 * Neutral-styled inline notice for the wizard's row-provenance disclosures.
 * Two callers today:
 *
 *  - The default (no `title`/`message`) says, out loud, that the rows on
 *    screen were GENERATED rather than read from the data source. This is
 *    the entire safety property of the synthetic-rows fallback path:
 *    synthetic readings are numerically plausible — correct tag names,
 *    believable ranges, a sensible time axis — so nothing in the table, the
 *    charts or the statistics distinguishes them from real measurements.
 *    Without it, a legacy recipe that cannot be replayed would quietly
 *    present invented numbers as data, and someone could tune a model
 *    against them.
 *  - `wizard-shell.tsx`'s edit-mode stage warning, which overrides both:
 *    the rows ARE real, just already past the pipeline stage Step 3 is
 *    about to run again.
 *
 * Neutral styling rather than a warning colour either way: red and amber are
 * reserved for workspace and plant status in this product, and borrowing
 * them here would dilute the one place operators rely on them.
 */
export function SyntheticDataBanner({ reason, title, message }: Props) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 px-4 py-3"
    >
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
      <div className="space-y-0.5 text-sm">
        <p className="font-medium text-foreground">
          {title ?? 'Preview data is simulated — not your source data'}
        </p>
        <p className="text-muted-foreground">
          {message ??
            `${reason} The values below are generated for layout only. Re-fetch this dataset from its source to work with real measurements.`}
        </p>
      </div>
    </div>
  )
}
