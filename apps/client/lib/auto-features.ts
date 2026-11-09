/**
 * Auto-generated feature recipe (Step 4 "Auto-generate", 2026-10-19).
 *
 * Builds a `FeatureConfig[]` from the kinds the pipeline ALREADY computes -
 * lag, rolling mean/std, delta, pairwise `arith sub`, datetime - so a
 * generated recipe trains, replays its holdout and serves exactly like a
 * hand-built one (`feature_spec.json` pins it; `max_replay_lookback` widens
 * the inference fetch for it). Nothing here is a new transform.
 *
 * Windows are stated in HOURS and converted to ROWS with the dataset's own
 * fetch interval, because `lag(k)`/`rolling(window)` count rows, not time
 * (softsensor_scaling.features, "ROWS, NEVER A DURATION"). Every window is
 * capped at MAX_WINDOW_HOURS.
 *
 * Rolling windows are also capped in ROWS (MAX_ROLLING_ROWS): the server
 * computes `rolling` row by row (`feature_service._compute_feature_column`),
 * measured at ~150 ns per window cell, so 24 h of 1-minute data (1,440 rows)
 * over six months is about a minute PER feature. Lags cost one read per row
 * and need no such cap.
 *
 * The target is never a source: a lag of Y makes the model target-derived,
 * which needs Y history at predict time that a lab tag does not have.
 *
 * Pure module - no React, no IO.
 */

import {
  featureColumnName,
  type FeatureConfig,
  type GroupAgg,
} from '@/lib/feature-engineering'
import { parseDurationMs } from '@/lib/dataset-fetch'

/** Marks a generated config, so the batch can be removed in one click. */
export const AUTO_FEATURE_ID_PREFIX = 'auto:'
export const MAX_WINDOW_HOURS = 24
export const LAG_HOURS = [1, 3, 6, 12, 24] as const
export const ROLLING_HOURS = [3, 6, 12, 24] as const
export const MAX_ROLLING_ROWS = 240
/** Pairwise differences grow as n(n-1)/2; 10 tags is 45 columns. */
export const MAX_PAIR_TAGS = 10
/** Measured server cost of one rolling window cell (see module comment). */
const ROLLING_NS_PER_CELL = 150
/** Above this, the plan says how long the rolling features will take. */
const ROLLING_SLOW_SECONDS = 120

export type AutoFamily =
  | 'lag'
  | 'rolling'
  | 'delta'
  | 'pairwise'
  | 'loop'
  | 'time'

/**
 * Tags of one instrument loop - same ISA letters and loop number, different
 * trailing letter, same attribute: AI602A.PV + AI602B.PV (redundant
 * analyzers), FIC114A..D.PV (parallel passes). See `findLoopGroups`.
 */
export interface LoopGroup {
  /** The loop's label, used in column names: `AI602`, or `AI602.SP`. */
  loop: string
  tags: string[]
}

export const AUTO_FAMILIES: {
  family: AutoFamily
  label: string
  detail: string
}[] = [
  { family: 'lag', label: 'Lags', detail: '1, 3, 6, 12, 24 h back' },
  {
    family: 'rolling',
    label: 'Rolling mean & std',
    detail: '3, 6, 12, 24 h windows',
  },
  {
    family: 'delta',
    label: 'Differences',
    detail: 'change since the previous row',
  },
  {
    family: 'pairwise',
    label: 'Pairwise differences',
    detail: `A − B for each pair of the chosen tags (up to ${MAX_PAIR_TAGS})`,
  },
  {
    family: 'loop',
    label: 'Loop aggregates',
    detail:
      'mean, spread, min, max (and std from 3 tags) across the tags of one loop',
  },
  {
    family: 'time',
    label: 'Time cycle',
    detail: 'hour of day and day of week, as sin/cos',
  },
]

export const DEFAULT_AUTO_FAMILIES: readonly AutoFamily[] = [
  'lag',
  'rolling',
  'delta',
  'loop',
  'time',
]

export interface AutoFeatureInput {
  /** Source columns (Step 1 tags, never engineered columns). */
  tags: readonly string[]
  targetTag: string | null
  /** The dataset's fetch interval, in ms; null when it cannot be read. */
  intervalMs: number | null
  families: readonly AutoFamily[]
  /** Tags the pairwise family pairs up (a subset of `tags`). */
  pairTags: readonly string[]
  /** Loops the loop family aggregates (from `findLoopGroups`). */
  loopGroups?: readonly LoopGroup[]
  /** Every column the frame already has, so nothing is generated twice. */
  existingColumns: readonly string[]
  /** Rows the dataset spans, for the cost note; null when unknown. */
  rowCount: number | null
  newId?: () => string
}

export interface AutoFeaturePlan {
  configs: FeatureConfig[]
  counts: Record<AutoFamily, number>
  lagRows: number[]
  rollingRows: number[]
  /** Plain-language reasons for anything left out, and the cost note. */
  notes: string[]
}

export function isAutoFeature(cfg: Pick<FeatureConfig, 'id'>): boolean {
  return cfg.id.startsWith(AUTO_FEATURE_ID_PREFIX)
}

export function hoursToRows(hours: number, intervalMs: number): number {
  return Math.round((hours * 3_600_000) / intervalMs)
}

/** Rows per window, deduplicated, inside [minRows, maxRows] and the 24 h cap. */
function ladder(
  hours: readonly number[],
  intervalMs: number,
  minRows: number,
  maxRows: number,
): { rows: number[]; tooShort: number[]; tooLong: number[] } {
  const rows: number[] = []
  const tooShort: number[] = []
  const tooLong: number[] = []
  for (const h of hours) {
    if (h > MAX_WINDOW_HOURS) continue
    const r = hoursToRows(h, intervalMs)
    if (r < minRows) tooShort.push(h)
    else if (r > maxRows) tooLong.push(h)
    else if (!rows.includes(r)) rows.push(r)
  }
  return { rows, tooShort, tooLong }
}

function hoursList(hours: number[]): string {
  return hours.map(h => `${h} h`).join(', ')
}

export function planAutoFeatures(input: AutoFeatureInput): AutoFeaturePlan {
  const newId =
    input.newId ?? (() => `${AUTO_FEATURE_ID_PREFIX}${crypto.randomUUID()}`)
  const counts: Record<AutoFamily, number> = {
    lag: 0,
    rolling: 0,
    delta: 0,
    pairwise: 0,
    loop: 0,
    time: 0,
  }
  const notes: string[] = []
  const configs: FeatureConfig[] = []
  const taken = new Set(input.existingColumns)
  const want = new Set(input.families)
  const sources = input.tags.filter(t => t !== input.targetTag)

  const push = (family: AutoFamily, cfg: FeatureConfig) => {
    const col = featureColumnName(cfg)
    if (taken.has(col)) return
    taken.add(col)
    configs.push(cfg)
    counts[family]++
  }

  let lagRows: number[] = []
  let rollingRows: number[] = []
  const windowed = want.has('lag') || want.has('rolling')
  if (windowed && input.intervalMs === null) {
    notes.push(
      'Lags and rolling windows need the fetch interval, which could not be read - they were left out.',
    )
  } else if (windowed && input.intervalMs !== null) {
    const lags = ladder(
      LAG_HOURS,
      input.intervalMs,
      1,
      Number.POSITIVE_INFINITY,
    )
    const rolls = ladder(ROLLING_HOURS, input.intervalMs, 2, MAX_ROLLING_ROWS)
    if (want.has('lag')) {
      lagRows = lags.rows
      if (lags.tooShort.length > 0)
        notes.push(
          `Lags of ${hoursList(lags.tooShort)} are shorter than one row at this interval - left out.`,
        )
    }
    if (want.has('rolling')) {
      rollingRows = rolls.rows
      if (rolls.tooShort.length > 0)
        notes.push(
          `Rolling windows of ${hoursList(rolls.tooShort)} span fewer than 2 rows at this interval - left out.`,
        )
      if (rolls.tooLong.length > 0)
        notes.push(
          `Rolling windows of ${hoursList(rolls.tooLong)} are over ${MAX_ROLLING_ROWS} rows at this interval and too slow to compute - left out. A coarser interval keeps them.`,
        )
    }
  }

  for (const tag of sources) {
    for (const k of lagRows) push('lag', { id: newId(), kind: 'lag', tag, k })
  }
  for (const tag of sources) {
    for (const window of rollingRows) {
      push('rolling', {
        id: newId(),
        kind: 'rolling',
        tag,
        window,
        agg: 'mean',
      })
      push('rolling', { id: newId(), kind: 'rolling', tag, window, agg: 'std' })
    }
  }
  if (want.has('delta')) {
    for (const tag of sources)
      push('delta', { id: newId(), kind: 'delta', tag })
  }
  if (want.has('pairwise')) {
    const chosen = input.pairTags.filter(
      (t, i, all) => sources.includes(t) && all.indexOf(t) === i,
    )
    const paired = chosen.slice(0, MAX_PAIR_TAGS)
    if (chosen.length > MAX_PAIR_TAGS)
      notes.push(
        `Pairwise differences use the first ${MAX_PAIR_TAGS} of ${chosen.length} chosen tags.`,
      )
    if (paired.length < 2)
      notes.push('Pairwise differences need at least 2 chosen tags.')
    for (let i = 0; i < paired.length; i++) {
      for (let j = i + 1; j < paired.length; j++) {
        push('pairwise', {
          id: newId(),
          kind: 'arith',
          op: 'sub',
          tags: [paired[i]!, paired[j]!],
        })
      }
    }
  }
  if (want.has('loop')) {
    const groups = (input.loopGroups ?? [])
      .map(g => ({ ...g, tags: g.tags.filter(t => sources.includes(t)) }))
      .filter(g => g.tags.length >= 2)
    if (groups.length === 0)
      notes.push(
        'No loop has 2 or more chosen tags (e.g. AI602A and AI602B) - loop aggregates were left out.',
      )
    for (const g of groups) {
      const aggs: GroupAgg[] = ['mean', 'spread', 'min', 'max']
      if (g.tags.length >= 3) aggs.push('std')
      for (const agg of aggs) {
        push('loop', {
          id: newId(),
          kind: 'group',
          name: `${g.loop}__grp_${agg}`,
          tags: g.tags,
          agg,
        })
      }
    }
  }
  if (want.has('time')) {
    const daily = input.intervalMs !== null && input.intervalMs >= 86_400_000
    if (daily)
      notes.push('Hour of day is constant at a daily interval - left out.')
    else {
      push('time', { id: newId(), kind: 'datetime', part: 'hourSin' })
      push('time', { id: newId(), kind: 'datetime', part: 'hourCos' })
    }
    push('time', { id: newId(), kind: 'datetime', part: 'dayOfWeekSin' })
    push('time', { id: newId(), kind: 'datetime', part: 'dayOfWeekCos' })
  }

  if (input.rowCount !== null && rollingRows.length > 0) {
    const cells =
      input.rowCount *
      rollingRows.reduce((a, w) => a + w, 0) *
      2 *
      sources.length
    const seconds = (cells * ROLLING_NS_PER_CELL) / 1e9
    if (seconds > ROLLING_SLOW_SECONDS)
      notes.push(
        `Rolling features will take about ${Math.round(seconds / 60)} min to compute on ${input.rowCount.toLocaleString()} rows. Fewer tags or a coarser interval is faster.`,
      )
  }

  return { configs, counts, lagRows, rollingRows, notes }
}

/** Rows a fetch window spans at this interval; null when either is unknown. */
export function estimateRowCount(
  from: string | null | undefined,
  to: string | null | undefined,
  intervalMs: number | null,
): number | null {
  if (!from || !to || intervalMs === null) return null
  const span = new Date(to).getTime() - new Date(from).getTime()
  if (!Number.isFinite(span) || span <= 0) return null
  return Math.floor(span / intervalMs) + 1
}

/**
 * The frame's own cadence: the median gap between consecutive timestamps.
 * Preferred over the configured fetch interval, which a CSV source does not
 * have and an edit-mode session cannot fully restore (the Step 2 bucket
 * override is not part of the saved recipe). Null under 2 parseable rows.
 */
export function inferIntervalMs(timestamps: readonly string[]): number | null {
  const times = timestamps
    // Naive wall-clock 'YYYY-MM-DD HH:MM:SS' - the T keeps every engine parsing it.
    .map(t => new Date(t.replace(' ', 'T')).getTime())
    .filter(t => Number.isFinite(t))
  const gaps: number[] = []
  for (let i = 1; i < times.length; i++) {
    const gap = times[i]! - times[i - 1]!
    if (gap > 0) gaps.push(gap)
  }
  if (gaps.length === 0) return null
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]!
}

/** "1 h", "10 min", "1 d" - how the dialog names the interval. */
export function formatIntervalMs(ms: number): string {
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000} d`
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000} h`
  if (ms % 60_000 === 0) return `${ms / 60_000} min`
  return `${Math.round(ms / 1000)} s`
}

/**
 * The interval the generator converts hours with: the data's own cadence
 * when the sample shows one, else the configured fetch bucket.
 */
export function resolveFeatureInterval(
  timestamps: readonly string[],
  configured: string,
): { ms: number | null; source: 'data' | 'fetch' | null } {
  const fromData = inferIntervalMs(timestamps)
  if (fromData !== null) return { ms: fromData, source: 'data' }
  const fromFetch = parseDurationMs(configured)
  return fromFetch !== null
    ? { ms: fromFetch, source: 'fetch' }
    : { ms: null, source: null }
}

/**
 * Column selection after a batch of features is added. `null` (keep every
 * column) stays null; an explicit selection gains the new columns, each once.
 */
export function selectionWithFeatures(
  selected: string[] | null,
  added: readonly FeatureConfig[],
): string[] | null {
  if (selected === null) return null
  const cols = added
    .map(featureColumnName)
    .filter((c, i, all) => !selected.includes(c) && all.indexOf(c) === i)
  return [...selected, ...cols]
}

/** The recipe and selection without the auto-generated batch. */
export function withoutAutoFeatures(
  configs: readonly FeatureConfig[],
  selected: string[] | null,
): { configs: FeatureConfig[]; selected: string[] | null } {
  const gone = new Set(configs.filter(isAutoFeature).map(featureColumnName))
  return {
    configs: configs.filter(c => !isAutoFeature(c)),
    selected: selected === null ? null : selected.filter(c => !gone.has(c)),
  }
}

/** `AI602A.PV` -> { base: 'AI602', attr: 'PV' }; null for a non-ISA name. */
function parseLoopTag(tag: string): { base: string; attr: string } | null {
  const dot = tag.indexOf('.')
  const name = dot === -1 ? tag : tag.slice(0, dot)
  const attr = dot === -1 ? '' : tag.slice(dot + 1)
  const m = /^([A-Za-z]+)(\d+)([A-Za-z]*)$/.exec(name)
  if (!m) return null
  return { base: `${m[1]!.toUpperCase()}${m[2]}`, attr }
}

/**
 * Groups tags by instrument loop (2026-10-19 user decision: automatic, by
 * name). Same letters + loop number, any trailing letter, same attribute -
 * AI602A.PV/AI602B.PV are one loop; AI602A.PV/AI602A.SP are not (a value and
 * its setpoint), nor are FIC107/FY107 (different measurements). Only loops
 * with 2+ tags are returned, in first-seen order.
 */
export function findLoopGroups(tags: readonly string[]): LoopGroup[] {
  const byKey = new Map<string, LoopGroup>()
  for (const tag of tags) {
    const parsed = parseLoopTag(tag)
    if (!parsed) continue
    const loop =
      parsed.attr && parsed.attr.toUpperCase() !== 'PV'
        ? `${parsed.base}.${parsed.attr}`
        : parsed.base
    const key = `${parsed.base}|${parsed.attr.toUpperCase()}`
    const group = byKey.get(key)
    if (group) group.tags.push(tag)
    else byKey.set(key, { loop, tags: [tag] })
  }
  return [...byKey.values()].filter(g => g.tags.length >= 2)
}
