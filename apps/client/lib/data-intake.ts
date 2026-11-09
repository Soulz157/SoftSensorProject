/**
 * Pure derivations for the Data Intake analytics page. No React, no IO.
 */
import type { Workspace } from '@/types'
import type {
  IngestionPoint,
  IntakeRange,
  IntakeTotals,
  TagCounts,
  TagQuality,
  TagRow,
} from '@/types/data-intake'
import { formatBytes } from '@/lib/format-bytes'

/** `'all'` = every workspace (admin), otherwise one workspace id. */
export type Scope = 'all' | string

/** Whether the viewer may open this scope. `workspaces` is what the backend
 *  returned for them — members only for a user, every workspace for an admin. */
export function canViewScope(scope: Scope, workspaces: Workspace[]): boolean {
  return scope === 'all' || workspaces.some(ws => ws.id === scope)
}

export const TAG_QUALITY_LABEL: Record<TagQuality, string> = {
  good: 'Good',
  bad: 'Bad',
  questionable: 'Questionable',
  noReading: 'No reading',
  notLive: 'Not live',
}

/** Display order of the proportion bar. */
export const TAG_QUALITY_ORDER: TagQuality[] = [
  'good',
  'questionable',
  'bad',
  'noReading',
  'notLive',
]

export type TagFilter = 'all' | TagQuality

export const TAG_FILTERS: TagFilter[] = [
  'all',
  'bad',
  'questionable',
  'noReading',
  'notLive',
]

export function tagFilterLabel(filter: TagFilter): string {
  return filter === 'all' ? 'All' : TAG_QUALITY_LABEL[filter]
}

export function filterTagRows(rows: TagRow[], filter: TagFilter): TagRow[] {
  return filter === 'all' ? rows : rows.filter(r => r.quality === filter)
}

/** Distinct tags counted across every quality bucket. */
export function totalTags(counts: TagCounts): number {
  return (
    counts.good +
    counts.bad +
    counts.questionable +
    counts.noReading +
    counts.notLive
  )
}

export interface TagSegment {
  quality: TagQuality
  label: string
  count: number
  /** Share of all counted tags, 0–100. */
  pct: number
}

/** Non-empty segments for the proportion bar, in display order. */
export function tagSegments(counts: TagCounts): TagSegment[] {
  const total = totalTags(counts)
  if (total === 0) return []
  return TAG_QUALITY_ORDER.filter(q => counts[q] > 0).map(q => ({
    quality: q,
    label: TAG_QUALITY_LABEL[q],
    count: counts[q],
    pct: (counts[q] / total) * 100,
  }))
}

/** `1234` → `1.2k`, `3_400_000` → `3.4M`. */
export function formatCount(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  return `${(n / 1_000_000_000).toFixed(1)}B`
}

export function formatPct(pct: number | null): string {
  return pct === null ? '—' : `${pct.toFixed(pct < 10 ? 2 : 1)}%`
}

/** `5m ago`, `3h ago`, `2d ago`; `—` when never. */
export function formatRelative(iso: string | null, now: Date): string {
  if (!iso) return '—'
  const mins = Math.max(
    0,
    Math.round((now.getTime() - Date.parse(iso)) / 60_000),
  )
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`
  return `${Math.round(mins / (60 * 24))}d ago`
}

/** Bar width for a dataset against the largest one, 0–100. */
export function storageShare(bytes: number, maxBytes: number): number {
  if (maxBytes <= 0) return 0
  return Math.min(100, (bytes / maxBytes) * 100)
}

export interface SummaryCell {
  key: string
  label: string
  value: string
  /** Secondary line under the value. */
  hint?: string
}

/** The stat grid at the top of the page. Storage hint spells out the split. */
export function summaryCells(totals: IntakeTotals): SummaryCell[] {
  const { tags, storage } = totals
  const live = tags.good + tags.questionable + tags.bad
  return [
    {
      key: 'live-tags',
      label: 'Live tags',
      value: String(live),
      hint: `${tags.good} Good · ${tags.questionable} Questionable · ${tags.bad} Bad`,
    },
    {
      key: 'rows',
      label: 'Rows ingested',
      value: formatCount(totals.rowsIngested),
    },
    {
      key: 'bad-cells',
      label: 'Bad cells',
      value: formatPct(totals.badCellPct),
      hint: 'Scheduled input',
    },
    {
      key: 'storage',
      label: 'Dataset storage',
      value: formatBytes(storage.totalBytes),
      hint: `${formatBytes(storage.savedBytes)} saved · ${formatBytes(storage.activeDraftBytes + storage.cleanupBytes)} drafts`,
    },
    {
      key: 'datasets',
      label: 'Datasets',
      value: String(totals.datasetCount),
    },
    {
      key: 'live-models',
      label: 'Live models',
      value: String(totals.liveModels),
    },
  ]
}

/** Chart rows with a short x-axis label for the selected bucket size. */
export function ingestionChartRows(
  points: IngestionPoint[],
  range: IntakeRange,
): (IngestionPoint & { label: string })[] {
  return points.map(p => {
    const d = new Date(p.bucketStart)
    const label =
      range === '24h'
        ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : range === '7d'
          ? d.toLocaleString([], { weekday: 'short', hour: '2-digit' })
          : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
    return { ...p, label }
  })
}
