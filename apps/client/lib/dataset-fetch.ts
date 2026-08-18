/**
 * Real Data Source fetch helpers for the Dataset Studio wizard.
 *
 * Converts the PI connector's `DataFetchResponse` (apps/python schemas/data.py)
 * into the wizard's `Dataset` shape. Kept as pure functions so the transform
 * can be unit-tested against a fixture without a live PI server — this is the
 * only reliable check for the field-name / status / timestamp mapping.
 */
import type { Dataset, DataRow } from '@/lib/preprocessing'
import type { SensorQuality } from '@/lib/mock-readings'
import type { FetchPeriod, CustomInterval } from '@/store/model-pipeline'
import type { SavedDataSource } from '@/lib/mock-data-sources'

/** Mirrors apps/python schemas/data.py DataFetchResponse. */
export interface PiTagDataPoint {
  timestamp: string
  value: number | string | null
}

export interface PiTagDataResult {
  tag_name: string
  data: PiTagDataPoint[]
  status: string // "ok" | "partial" | "failed"
  error?: string | null
}

export interface PiDataFetchResponse {
  start_time: string
  end_time: string
  total_tags: number
  succeeded_tags: number
  failed_tags: number
  batch_size: number
  results: PiTagDataResult[]
}

const PERIOD_INTERVAL: Record<FetchPeriod, string> = {
  '1min': '1m',
  '5min': '5m',
  '10min': '10m',
  '1h': '1h',
  '1d': '1d',
}

const UNIT_SUFFIX: Record<CustomInterval['unit'], string> = {
  min: 'm',
  hr: 'h',
  day: 'd',
}

/** Resolve the PI summary duration string (e.g. "5m", "1h") for a fetch. */
export function resolveInterval(
  period: FetchPeriod,
  custom: CustomInterval | null,
): string {
  if (custom) return `${custom.value}${UNIT_SUFFIX[custom.unit]}`
  return PERIOD_INTERVAL[period]
}

/**
 * Convert a datetime-local value ("YYYY-MM-DDTHH:MM") to the space-separated
 * form PI Web API expects ("YYYY-MM-DD HH:MM:SS").
 */
export function toPiTime(local: string): string {
  if (!local) return ''
  const [date, time = '00:00'] = local.split('T')
  const hms = time.length === 5 ? `${time}:00` : time
  return `${date} ${hms}`
}

/**
 * Fold a PI fetch response into a wizard `Dataset`. A point is `Good` only when
 * its value is a finite number and its tag's result did not fail; anything else
 * (null, non-numeric, failed tag) becomes a `Bad` cell so downstream cleaning
 * treats it as missing rather than a spurious reading.
 */
export function piResponseToDataset(
  res: PiDataFetchResponse,
  tags: string[] = [],
): Dataset {
  const resultTags = res.results.map(r => r.tag_name)
  const allTags = tags.length > 0 ? tags : resultTags

  const byTs = new Map<string, DataRow>()
  for (const result of res.results) {
    const failed = result.status === 'failed'
    for (const point of result.data) {
      const row = byTs.get(point.timestamp) ?? {
        timestamp: point.timestamp,
        cells: {},
      }
      const numeric =
        typeof point.value === 'number' && Number.isFinite(point.value)
      const good = numeric && !failed
      // Invariant: a Bad cell always carries value 0 (cleaning fills it later);
      // only Good cells keep the real reading.
      row.cells[result.tag_name] = {
        value: good ? (point.value as number) : 0,
        status: good ? 'Good' : ('Bad' as SensorQuality),
      }
      byTs.set(point.timestamp, row)
    }
  }

  const rows = Array.from(byTs.values()).sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : 1,
  )
  return { tags: allTags, rows }
}

/**
 * Overlay user-entered constant tags onto the fetched grid: every existing row
 * reads the constant as a flat Good series (mirrors the prior mock behaviour so
 * inserted/constant tags stay visible alongside real readings). Mutates rows in
 * place, matching the original F8 fetch behaviour exactly.
 */
export function applyConstantOverlay(
  dataset: Dataset,
  constants: Record<string, number>,
  tags: string[],
): Dataset {
  const entries = Object.entries(constants).filter(([tag]) =>
    tags.includes(tag),
  )
  if (entries.length === 0) return dataset
  for (const row of dataset.rows) {
    for (const [tag, value] of entries) {
      row.cells[tag] = { value, status: 'Good' }
    }
  }
  return dataset
}

/**
 * Split a tag list into groups of at most `size` (client-orchestrated batching
 * for P6). `size < 1` is clamped to 1 so a bad Batch Size can never produce an
 * empty/zero-length chunk that would loop forever or drop tags.
 */
export function chunkTags(tags: string[], size: number): string[][] {
  const step = Math.max(1, Math.trunc(size))
  const out: string[][] = []
  for (let i = 0; i < tags.length; i += step) {
    out.push(tags.slice(i, i + step))
  }
  return out
}

/**
 * Merge an incoming batch `Dataset` into `base`, returning a BRAND-NEW
 * `{ tags, rows }` (never a mutated reference) so jotai's `Object.is` bail-out
 * does not swallow an incremental fetch write. Tags are the ordered union (base
 * first, then new tags from `incoming`); rows are merged by timestamp and sorted.
 *
 * Because client tag-batches produce ragged timestamp sets, every row is
 * backfilled so it carries a cell for EVERY tag in the union — a missing cell
 * becomes `{ value: 0, status: 'Bad' }`, preserving the invariant
 * `piResponseToDataset` documents (missing/failed = Bad value 0) end-to-end
 * through the cleaning path.
 */
export function mergeDataset(base: Dataset, incoming: Dataset): Dataset {
  const tags = [...base.tags]
  for (const tag of incoming.tags) {
    if (!tags.includes(tag)) tags.push(tag)
  }

  const byTs = new Map<string, DataRow>()
  for (const row of base.rows) {
    byTs.set(row.timestamp, {
      timestamp: row.timestamp,
      cells: { ...row.cells },
    })
  }
  for (const row of incoming.rows) {
    const merged = byTs.get(row.timestamp) ?? {
      timestamp: row.timestamp,
      cells: {},
    }
    for (const [tag, cell] of Object.entries(row.cells)) {
      merged.cells[tag] = cell
    }
    byTs.set(row.timestamp, merged)
  }

  const rows = Array.from(byTs.values()).sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : 1,
  )
  // Backfill so every row has a cell for every tag (ragged batches otherwise
  // leave holes that the cleaning path reads as 0/Good instead of missing).
  for (const row of rows) {
    for (const tag of tags) {
      if (!row.cells[tag]) row.cells[tag] = { value: 0, status: 'Bad' }
    }
  }
  return { tags, rows }
}

const DURATION_UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

/**
 * Parse a PI summary-duration string ("30s", "1m", "10m", "1h", "1d") into
 * milliseconds. Returns null for anything that does not match `\d+[smhd]` so
 * callers can fall back to a known-good bucket rather than a wrong one.
 */
export function parseDurationMs(duration: string): number | null {
  const match = /^(\d+)\s*([smhd])$/.exec(duration.trim())
  if (!match) return null
  const value = Number(match[1])
  const unitMs = DURATION_UNIT_MS[match[2] as string]
  if (!Number.isFinite(value) || value <= 0 || unitMs === undefined) return null
  return value * unitMs
}

/** Format a Date as the PI space-separated time ("YYYY-MM-DD HH:MM:SS") using
 * LOCAL fields — never UTC — so the window is not silently shifted by the
 * viewer's timezone offset. */
export function dateToPiTime(date: Date): string {
  if (Number.isNaN(date.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ` +
    `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
  )
}

/**
 * Compute a SMALL preview window from the fetch range: start → start + maxRows
 * buckets, capped at the real end. `durationStr` is the effective summary bucket
 * (e.g. "1m"); if it cannot be parsed the window falls back to a 1-minute bucket
 * — NEVER the full end — so a bad duration override can never turn a preview
 * into a full-range archive read. Inputs are the wizard's datetime-local strings
 * ("YYYY-MM-DDTHH:MM"), parsed as local time.
 */
export function previewWindow(
  fromLocal: string,
  toLocal: string,
  durationStr: string,
  maxRows = 100,
): { startTime: string; endTime: string } {
  const bucketMs = parseDurationMs(durationStr) ?? DURATION_UNIT_MS.m
  const fromMs = new Date(fromLocal).getTime()
  const toMs = new Date(toLocal).getTime()
  const capMs = Number.isFinite(toMs)
    ? toMs
    : fromMs + maxRows * (bucketMs as number)
  const endMs = Math.min(fromMs + maxRows * (bucketMs as number), capMs)
  return {
    startTime: toPiTime(fromLocal),
    endTime: dateToPiTime(new Date(endMs)),
  }
}

/**
 * Validate the wizard's live-fetch inputs against the single-PI-source scope
 * (shared by full fetch and preview so both report the same limitation). On
 * success returns the resolved PI source; otherwise a user-facing message.
 */
export function piFetchInputError(
  sources: SavedDataSource[],
  tags: string[],
  from: string | undefined,
  to: string | undefined,
): { ok: true; source: SavedDataSource } | { ok: false; error: string } {
  if (tags.length === 0) return { ok: false, error: 'No tags selected' }
  const piSources = sources.filter(s => s.type === 'aveva')
  if (piSources.length === 0) {
    return {
      ok: false,
      error:
        'Live fetch in the wizard currently supports PI / AVEVA sources. SQL and REST fetch need table/endpoint selection that is not available here yet.',
    }
  }
  if (sources.length > 1) {
    return {
      ok: false,
      error:
        'Select a single PI source to fetch — multi-source merge is not supported yet.',
    }
  }
  if (!from || !to) {
    return { ok: false, error: 'Set a start and end time before fetching.' }
  }
  const source = piSources[0]
  if (!source) return { ok: false, error: 'No PI source selected.' }
  return { ok: true, source }
}
