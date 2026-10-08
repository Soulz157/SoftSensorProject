'use client'

import type { ArtifactHoldout } from '@/services/dataset-version'
import { artifactTimeSpanLabel } from '@/lib/dataset-stats'
import { Skeleton } from '@/components/ui/skeleton'
import { StatTile } from '../../stat-tile'

interface Props {
  holdout: ArtifactHoldout | null
  loading: boolean
  error: string | null
}

function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—'
  return `${n.toFixed(2)}%`
}

/**
 * Validation-holdout window — MODEL-FLOW-010-T06. `holdout: null` with no
 * `error` is the normal case for a dataset with no holdout, not a failure.
 *
 * The missing/Bad rate is shown beside the window and row count, never
 * omitted when present: DS-LAKE-018's resolved no-imputation decision means
 * the holdout stays raw, so a MISSING_VALUE hole reaches predict() and
 * depresses the score with no other trace of why. A holdout captured before
 * this field existed shows `missingPct: null` — the panel says so plainly
 * rather than silently dropping the tile or implying a clean 0%.
 */
export function HoldoutPanel({ holdout, loading, error }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <p className="rounded-lg border border-border p-4 text-center text-xs text-muted-foreground">
        Could not load the validation holdout — {error}
      </p>
    )
  }

  if (!holdout) {
    return (
      <p className="rounded-lg border border-border p-4 text-center text-xs text-muted-foreground">
        This dataset has no validation holdout — training will use the
        configured train/test split alone.
      </p>
    )
  }

  const window = artifactTimeSpanLabel(holdout.holdoutFrom, holdout.holdoutTo)

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <StatTile
        label="Holdout window"
        value={window}
        surface="muted"
        valueSize="md"
      />
      <StatTile
        label="Holdout rows"
        value={holdout.rowCount.toLocaleString()}
        surface="muted"
        valueSize="md"
      />
      <StatTile
        label="Missing / Bad rate"
        value={fmtPct(holdout.missingPct)}
        sub={
          holdout.missingPct === null
            ? 'missing rate not recorded for this holdout'
            : undefined
        }
        surface="muted"
        valueSize="md"
      />
    </div>
  )
}
