import type { CustomDateRange } from '@/store/data-visualize'
import type { CustomInterval } from '@/store/model-pipeline'

/**
 * Guards for selecting a validation holdout window (DS-LAKE-018-T01). Four
 * checks, all pure — no atoms, no React — so the step component only
 * renders what this returns.
 *
 * DS-LAKE-023-T06: the picker itself moved to Step 4, and now drives TWO
 * different server splits depending on wizard mode — a raw, BRONZE-stage
 * split (edit mode, unchanged since T01) or a feature-bearing, post-features
 * split (create mode, DS-LAKE-023). `featureBearing` on `HoldoutGuardInput`
 * selects which one these guards check against; see its own doc comment.
 *
 * DS-LAKE-018 corrections, recorded here rather than left for whoever
 * implements T03/T04 to re-derive:
 *  - `openDecisions[0]` ("does replay include imputation?") is marked NOT
 *    DECIDED, but T04's own scope_note asserts "the resolved no-imputation
 *    decision" as settled fact — those two statements contradict each
 *    other. Holdout SELECTION (this task) does not touch imputation either
 *    way, so it does not block T01, but T04 cannot be implemented until
 *    this is actually resolved with the user, not silently picked.
 *  - `openDecisions[1]` (lead-in row count: derived from the Step 4 recipe
 *    vs. over-provisioned) reads as already answered by `userDecisions[0]`,
 *    which chose a configured DURATION with a default (`HOLDOUT_LEAD_IN_
 *    DURATION` below) — over-provisioned, not derived. Also does not block
 *    T01.
 */

/**
 * Default lead-in for lag/rolling features that read rows before the
 * holdout boundary — a DURATION, not a row count, so it means the same
 * thing at any fetch interval (userDecisions[0]: `rolling(60)` spans one
 * hour at a 1-minute interval and 60 hours at a 1-hour one). No env var for
 * this exists yet; a plain constant, same precedent as `MATERIALIZE_EPOCH`
 * (pipeline-config.ts) rather than a `NEXT_PUBLIC_*` var for a value that is
 * never configured per-deployment today.
 */
export const HOLDOUT_LEAD_IN_DURATION: CustomInterval = {
  value: 7,
  unit: 'day',
}

/**
 * `images/trainer/train.py`'s own hard floor (train.py:433, "Only {n} rows
 * have a Good target — too few to split"). Cited in guard 2's copy so the
 * number in the UI can't drift out of sync with the check that actually
 * enforces it.
 */
const MIN_LABELLED_ROWS = 30

const UNIT_MS: Record<CustomInterval['unit'], number> = {
  min: 60_000,
  hr: 60 * 60_000,
  day: 24 * 60 * 60_000,
}

function durationMs(d: CustomInterval): number {
  return d.value * UNIT_MS[d.unit]
}

/**
 * Parses the PI summary-duration strings `resolveInterval` (dataset-fetch.ts)
 * returns — "5m", "1h", "1d" — into milliseconds. Same suffix alphabet
 * `resolveInterval`'s own `UNIT_SUFFIX` writes, read back here. Returns null
 * for a string outside that alphabet rather than throwing — the row-count
 * conversion is a nice-to-have, not something a malformed interval should
 * take the whole guard function down for.
 */
function intervalMs(interval: string): number | null {
  const match = /^(\d+)(m|h|d)$/.exec(interval)
  if (!match) return null
  const value = Number(match[1])
  const suffix = match[2] as 'm' | 'h' | 'd'
  const unitMs = { m: 60_000, h: 60 * 60_000, d: 24 * 60 * 60_000 }[suffix]
  return value * unitMs
}

function toMs(iso: string): number {
  return new Date(iso).getTime()
}

function formatDuration(d: CustomInterval): string {
  const suffix = d.unit === 'min' ? 'm' : d.unit === 'hr' ? 'h' : 'd'
  return `${d.value}${suffix}`
}

function formatMs(ms: number): string {
  const days = ms / UNIT_MS.day
  if (days >= 1) return `${days.toFixed(1)}d`
  const hours = ms / UNIT_MS.hr
  if (hours >= 1) return `${hours.toFixed(1)}h`
  return `${Math.round(ms / UNIT_MS.min)}m`
}

export interface HoldoutGuardInput {
  /** Step 2's own fetch window — what will actually be materialized. */
  fetchRange: CustomDateRange
  /** The user's holdout selection, or null when none is chosen. */
  holdoutRange: CustomDateRange | null
  /**
   * `resolveInterval()`'s result (e.g. "5m", "1h") — the PI summary duration
   * that sets row spacing, needed to convert the lead-in DURATION into rows.
   */
  interval: string
  /**
   * Whether a target tag has already been chosen. DS-LAKE-023-T06 CORRECTION:
   * the doc comment here previously claimed this was "always false" because
   * the picker sat at Step 2/3.1, before `dwTargetTagAtom` could be set. That
   * was already stale when written — the target is set at STEP 1
   * (`unified-tag-table.tsx`), not Step 4 as the old comment also claimed —
   * and is doubly moot now that the picker itself mounts at Step 4, after
   * both. Kept as a real parameter, not hard-coded, so this guard cannot go
   * stale the same way twice.
   */
  targetChosen: boolean
  /** Overridable for tests; defaults to `HOLDOUT_LEAD_IN_DURATION`. */
  leadIn?: CustomInterval
  /**
   * DS-LAKE-023-T06. True for a holdout cut AFTER feature engineering
   * (create mode's path, mounted at Step 4) — that split trims lead-in to
   * zero at the server (T01: `_split_holdout(..., lead_in=timedelta(0))`),
   * since the sidecar already carries its derived columns computed on the
   * continuous frame before the cut. Guard 3 (lead-in availability) is
   * skipped entirely for this kind — checking it would refuse a perfectly
   * valid selection for a shortfall that no longer has any effect. Guard
   * 4's warning also changes: DS-LAKE-023 reverses the leakage concern
   * `decisions.holdout_ui_moves_split_does_not` (DS-LAKE-022) was built on
   * — a derived value never spans the cut any more (features run on the
   * continuous frame first), so the warning is reworded to name the
   * training DISTRIBUTION rather than a feature-value defect that no
   * longer exists.
   *
   * Defaults to false — edit mode's legacy, BRONZE-stage split keeps both
   * guards exactly as they read before this feature.
   */
  featureBearing?: boolean
}

export interface HoldoutGuardResult {
  /** Non-empty means the selection MUST be rejected — do not commit it. */
  refusals: string[]
  /** Informational; the selection is still valid despite these. */
  warnings: string[]
  /**
   * Rows of lead-in actually available before the holdout boundary, bounded
   * by both the configured duration and what the fetch window can supply.
   * Null when there is no holdout, the range was refused, or `interval`
   * could not be parsed. Recorded so T04 can check sufficiency without
   * re-deriving the duration against an interval it would have to look up.
   */
  resolvedLeadInRows: number | null
}

const NO_HOLDOUT: HoldoutGuardResult = {
  refusals: [],
  warnings: [],
  resolvedLeadInRows: null,
}

export function describeHoldoutSelection({
  fetchRange,
  holdoutRange,
  interval,
  targetChosen,
  leadIn = HOLDOUT_LEAD_IN_DURATION,
  featureBearing = false,
}: HoldoutGuardInput): HoldoutGuardResult {
  if (!holdoutRange) return NO_HOLDOUT

  const fetchFrom = toMs(fetchRange.from)
  const fetchTo = toMs(fetchRange.to)
  const holdoutFrom = toMs(holdoutRange.from)
  const holdoutTo = toMs(holdoutRange.to)

  // An incomplete draft (still typing one edge) parses to NaN — say nothing
  // yet rather than flash a refusal mid-entry.
  if ([fetchFrom, fetchTo, holdoutFrom, holdoutTo].some(Number.isNaN)) {
    return NO_HOLDOUT
  }

  const refusals: string[] = []
  const warnings: string[] = []

  // Guard 1 — HOLDOUT INSIDE THE FETCH WINDOW. Refuse at selection time, not
  // after a multi-minute fetch discovers there are no rows there.
  if (holdoutFrom > holdoutTo) {
    refusals.push('Holdout start must be on or before holdout end.')
  } else if (holdoutFrom < fetchFrom || holdoutTo > fetchTo) {
    refusals.push(
      'Holdout window must fall entirely inside the fetch window above — ' +
        'a holdout outside it has no rows to split from.',
    )
  }
  if (refusals.length > 0) {
    return { refusals, warnings, resolvedLeadInRows: null }
  }

  // Guard 2 — TRAIN REMAINDER SUFFICIENT. The real check needs the LABELLED
  // row count, which needs a target tag. Warn about the gap rather than
  // claim a check that cannot run here.
  if (!targetChosen) {
    warnings.push(
      `Target tag isn't chosen yet, so the training remainder can't be ` +
        `checked from here — training refuses runs with fewer than ` +
        `${MIN_LABELLED_ROWS} labelled rows after the holdout is removed. ` +
        'Revisit this once a target is set.',
    )
  }

  // Guard 3 — LEAD-IN ACTUALLY AVAILABLE. RAW-holdout only (see
  // `featureBearing`'s own doc comment): a feature-bearing split trims
  // lead-in to zero at the server, so there is nothing to be short of, and
  // checking anyway would refuse a valid selection for a shortfall with no
  // effect.
  let resolvedLeadInRows: number | null = null
  if (!featureBearing) {
    const stepMs = intervalMs(interval)
    const configuredLeadInMs = durationMs(leadIn)
    const availableLeadInMs = Math.max(0, holdoutFrom - fetchFrom)
    const cappedLeadInMs = Math.min(configuredLeadInMs, availableLeadInMs)
    resolvedLeadInRows =
      stepMs !== null && stepMs > 0 ? Math.floor(cappedLeadInMs / stepMs) : null

    if (availableLeadInMs < configuredLeadInMs) {
      warnings.push(
        `Only ${formatMs(availableLeadInMs)} of lead-in is available before ` +
          `the holdout starts (${formatDuration(leadIn)} configured) — lag/` +
          "rolling features on the holdout's first rows may fall short. " +
          'Move the holdout later, or widen the fetch window, to capture the ' +
          'full lead-in.',
      )
    }
  }

  // Guard 4 — TRAILING IS RECOMMENDED, NOT REQUIRED. Warn, do not block:
  // holding out a specific mid-window period is a legitimate reason to
  // accept the gap this creates. Wording branches on `featureBearing`
  // (DS-LAKE-023): the OLD claim ("read rows from the wrong side of it")
  // described a real defect only the RAW/BRONZE-stage split still has —
  // a feature-bearing split computes on the continuous frame first, so no
  // derived value ever spans the cut. The training-distribution concern
  // (two discontinuous pieces) is real either way.
  if (holdoutTo < fetchTo) {
    warnings.push(
      featureBearing
        ? 'This holdout is not at the end of the fetch window, which splits ' +
            'the training set into two pieces. Features are computed BEFORE ' +
            'the split, so no derived value spans the gap — but the training ' +
            'data itself is still discontinuous, which can matter for a model ' +
            'that assumes a continuous time series. Fine for deliberately ' +
            'holding out a specific period; a trailing holdout avoids the ' +
            'split entirely.'
        : 'This holdout is not at the end of the fetch window, which splits ' +
            'the training set into two pieces — lag/rolling features computed ' +
            'across that gap read rows from the wrong side of it. Fine for ' +
            'deliberately holding out a specific period; a trailing holdout ' +
            'avoids the gap entirely.',
    )
  }

  return { refusals, warnings, resolvedLeadInRows }
}
