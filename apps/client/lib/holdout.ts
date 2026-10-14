import type { CustomDateRange } from '@/store/data-visualize'
import type { CustomInterval } from '@/store/model-pipeline'
import type { Dataset } from '@/lib/preprocessing'

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
  /**
   * The target's distinct-value summary inside the draft window, from
   * `describeTargetInWindow`. Null/absent means "could not be counted" (target
   * not in the frame, no rows in the window) and says nothing — a missing
   * count must never read as a flat target. Computed by the caller because it
   * needs the raw frame; kept out of this function so the guards stay cheap.
   */
  targetInWindow?: TargetInWindow | null
}

export interface TargetInWindow {
  /** Distinct finite Good target values inside the window. */
  distinct: number
  /** The one value, when `distinct === 1`; null otherwise. */
  constantValue: number | null
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
  targetInWindow = null,
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

  // Guard 5 — TARGET MUST MOVE INSIDE THE WINDOW. Warning only, never a
  // refusal and never a cut: a lab value that stops updating (sampler
  // stopped, value carried forward) is still real data the user may want to
  // hold out on purpose. But a validation set with ONE target value cannot
  // be scored — r2 is undefined for a constant y_true — so say so before
  // training instead of after a meaningless number.
  if (targetInWindow) {
    if (targetInWindow.distinct === 0) {
      warnings.push(
        'No labelled target values fall inside this window, so validation ' +
          "can't be scored here. Pick a window where the target has readings.",
      )
    } else if (targetInWindow.distinct === 1) {
      const value =
        targetInWindow.constantValue === null
          ? 'a single value'
          : String(targetInWindow.constantValue)
      warnings.push(
        `The target stays at ${value} for this whole window. With one ` +
          "target value, R² can't be scored meaningfully. Consider a window " +
          'where the lab value changes. Nothing is removed — this is only a ' +
          'heads-up.',
      )
    }
  }

  return { refusals, warnings, resolvedLeadInRows }
}

/**
 * The raw frame's column for the chosen target. The target is stored by its
 * CURRENT name, but a tag renamed in Step 1 (`dwEditedTagsAtom`, original ->
 * new) may still be keyed by its original name in the raw frame. Returns null
 * when neither spelling is a column, so the caller stays silent instead of
 * guessing.
 */
export function resolveRawTargetKey(
  rawTags: readonly string[],
  targetTag: string | null,
  editedTags: Readonly<Record<string, string>>,
): string | null {
  if (targetTag === null) return null
  if (rawTags.includes(targetTag)) return targetTag
  const original = Object.keys(editedTags).find(
    key => editedTags[key] === targetTag,
  )
  return original !== undefined && rawTags.includes(original) ? original : null
}

/**
 * Distinct Good target values inside `[range.from, range.to]`, both ends
 * inclusive — the same bounds the server's `_split_holdout` cuts with
 * (`ts >= from`, `ts <= to`), so this counts exactly the rows that would land
 * in the validation file.
 *
 * Returns null — "cannot tell" — when the target is not a column of `raw`, the
 * range is incomplete or unparsable, or no raw row falls in the window. A
 * partial frame must produce no warning rather than a false one.
 */
export function describeTargetInWindow(
  raw: Dataset,
  targetTag: string,
  range: CustomDateRange,
): TargetInWindow | null {
  if (!raw.tags.includes(targetTag)) return null
  const from = toMs(range.from)
  const to = toMs(range.to)
  if (Number.isNaN(from) || Number.isNaN(to)) return null

  const values = new Set<number>()
  let rowsInWindow = 0
  for (const row of raw.rows) {
    const ts = toMs(row.timestamp)
    if (ts < from || ts > to) continue
    rowsInWindow += 1
    const cell = row.cells[targetTag]
    if (cell && cell.status === 'Good' && Number.isFinite(cell.value)) {
      values.add(cell.value)
    }
  }
  if (rowsInWindow === 0) return null

  return {
    distinct: values.size,
    constantValue:
      values.size === 1 ? (values.values().next().value ?? null) : null,
  }
}

/**
 * A timestamp string reduced to naive wall-clock `YYYY-MM-DDTHH:MM:SS`,
 * dropping any `Z`/offset and fractional seconds. The stored holdout boundary
 * is serialised with `toISOString()` (`...Z`) while the sidecar's rows are
 * naive — `new Date()` would read the first as UTC and the second as LOCAL,
 * shifting the cut by the viewer's offset. Fixed-width ISO strings compare
 * correctly as text, so no Date is involved.
 */
function wallClock(value: string): string {
  const s = value.trim().replace(' ', 'T').slice(0, 19)
  return s.length === 16 ? `${s}:00` : s
}

/**
 * Rows of a validation sidecar that sit inside the holdout window. A legacy
 * (BRONZE-stage) sidecar carries a lead-in margin of TRAINING rows ahead of
 * the window, so charting it unclipped would label training rows as
 * validation. Clipped here, in the browser, on wall-clock text (see
 * `wallClock`) rather than via a server `startTime`.
 *
 * `holdoutTo: null` is an open-ended holdout — only the start is enforced.
 */
export function clipToHoldoutWindow(
  dataset: Dataset,
  holdoutFrom: string,
  holdoutTo: string | null,
): Dataset {
  const from = wallClock(holdoutFrom)
  const to = holdoutTo === null ? null : wallClock(holdoutTo)
  return {
    tags: dataset.tags,
    rows: dataset.rows.filter(row => {
      const ts = wallClock(row.timestamp)
      return ts >= from && (to === null || ts <= to)
    }),
  }
}

/**
 * Tags a validation chart starts with: the lab (`.lab`) tags when the dataset
 * has any — the target is a lab value and it is the line that decides whether
 * the split can be scored — otherwise the first few tags. `all` is the full
 * list, so the caller can offer the other view.
 */
export function validationChartTags(tags: readonly string[]): {
  initial: string[]
  all: string[]
  hasLabSubset: boolean
} {
  const all = [...tags]
  const lab = all.filter(tag => tag.toLowerCase().endsWith('.lab'))
  const hasLabSubset = lab.length > 0 && lab.length < all.length
  return {
    initial: lab.length > 0 ? lab : all.slice(0, 4),
    all,
    hasLabSubset,
  }
}
