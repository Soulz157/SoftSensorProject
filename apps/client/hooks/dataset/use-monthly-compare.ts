'use client'

import { useState } from 'react'
import { datasetDraftService } from '@/services/dataset-draft'
import type {
  DraftBoxplotResult,
  DraftHistogramResult,
} from '@/services/dataset-draft'
import { datasetArtifactService } from '@/services/dataset-version'
import { windowParams, type MonthOption } from '@/lib/time-window'
import { settleWithConcurrency, type MonthResult } from '@/lib/monthly-compare'
import { useDebouncedAbortableRequest } from './internal/use-debounced-abortable-request'

/**
 * Which route family reads the artifact — the SAME choice `DataAnalysisCard`
 * already makes for its other server-backed tabs (draft leg vs. the
 * dataset-gated leg for edit mode's adopted BRONZE / an explicit caller).
 * Passing it in, rather than re-deriving it here, keeps the two from ever
 * disagreeing about which artifact is being charted.
 */
export type ArtifactLeg =
  | { kind: 'draft'; draftId: string | null; artifactId: string | null }
  | { kind: 'dataset'; datasetId: string | null; artifactId: string | null }

export interface MonthlyCompareState<T> {
  /** One entry per picked month, in picked order. Null until the first
   * response for the current request lands. */
  results: MonthResult<T>[] | null
  loading: boolean
  /** Set only when EVERY month failed — a partial failure is reported per
   * month through `results[i].error`. */
  error: string | null
}

type Kind = 'histogram' | 'boxplot'

/** At most this many month requests in flight — "All months" can be 24. */
const MONTH_REQUEST_CONCURRENCY = 4

function legIds(leg: ArtifactLeg): [string | null, string | null] {
  return leg.kind === 'draft'
    ? [leg.draftId, leg.artifactId]
    : [leg.datasetId, leg.artifactId]
}

function fetchOne(
  kind: Kind,
  leg: ArtifactLeg,
  tag: string,
  month: MonthOption,
  signal: AbortSignal,
): Promise<DraftHistogramResult | DraftBoxplotResult> {
  const [ownerId, artifactId] = legIds(leg)
  const tags = [tag]
  const window = windowParams(month.window)
  // Two service shapes: the draft leg takes `operations` (Step 3.1 replays
  // live rules through it — `[]` here, same as the card's own tabs), the
  // dataset leg's service always sends `[]` itself.
  if (leg.kind === 'draft') {
    const body = { operations: [], tags, ...window }
    return (
      kind === 'histogram'
        ? datasetDraftService.histogram(ownerId!, artifactId!, body, signal)
        : datasetDraftService.boxplot(ownerId!, artifactId!, body, signal)
    ).then(res => res.data)
  }
  const body = { tags, ...window }
  return (
    kind === 'histogram'
      ? datasetArtifactService.histogram(ownerId!, artifactId!, body, signal)
      : datasetArtifactService.boxplot(ownerId!, artifactId!, body, signal)
  ).then(res => res.data)
}

/**
 * DS-LAKE-031-D02. One request per picked month (the endpoints take a single
 * window), at most `MONTH_REQUEST_CONCURRENCY` in flight, each settled on its
 * own so one failed month does not sink the comparison — the merge names it
 * instead.
 *
 * Rides `useDebouncedAbortableRequest` for debounce, abort-on-supersede and
 * the 30s chart cache. A response with SOME failed months is cached like any
 * other; the short TTL bounds how long a transient failure can stick. Only
 * the all-failed case rejects, and that is never cached.
 *
 * `enabled` lets the card keep this idle for the tab that is not showing, so
 * the monthly mode costs no hidden requests.
 */
function useMonthlyCompare<T extends DraftHistogramResult | DraftBoxplotResult>(
  kind: Kind,
  leg: ArtifactLeg,
  tag: string | null,
  months: MonthOption[],
  enabled: boolean,
): MonthlyCompareState<T> {
  const [results, setResults] = useState<MonthResult<T>[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [ownerId, artifactId] = legIds(leg)
  const monthsKey = months.map(m => m.key).join(',')
  const active =
    enabled && !!ownerId && !!artifactId && !!tag && months.length > 0
  const cacheKey = active
    ? `monthly-${kind}|${leg.kind}|${ownerId}|${artifactId}|${tag}|${monthsKey}`
    : null

  useDebouncedAbortableRequest<MonthResult<T>[]>({
    enabled: active,
    cacheKey,
    fetcher: async signal => {
      const settled = await settleWithConcurrency(
        months,
        MONTH_REQUEST_CONCURRENCY,
        m => fetchOne(kind, leg, tag!, m, signal) as Promise<T>,
      )
      // Rethrow an abort so the shared hook can recognise and ignore it.
      for (const s of settled) {
        if (
          s.status === 'rejected' &&
          s.reason instanceof DOMException &&
          s.reason.name === 'AbortError'
        ) {
          throw s.reason
        }
      }
      const out = settled.map(
        (s, i): MonthResult<T> =>
          s.status === 'fulfilled'
            ? { month: months[i]!, data: s.value, error: null }
            : {
                month: months[i]!,
                data: null,
                error:
                  s.reason instanceof Error
                    ? s.reason.message
                    : 'Request failed',
              },
      )
      if (out.every(r => r.data === null)) {
        throw new Error(out[0]?.error ?? 'Every month failed to load')
      }
      return out
    },
    onLoading: () => {
      setResults(null)
      setError(null)
      setLoading(true)
    },
    onSettled: result => {
      if (result.status === 'ready') {
        setResults(result.data)
      } else {
        setError(result.error)
      }
      setLoading(false)
    },
    onIdle: () => {
      setResults(null)
      setLoading(false)
      setError(null)
    },
  })

  return { results, loading, error }
}

export function useMonthlyHistograms(
  leg: ArtifactLeg,
  tag: string | null,
  months: MonthOption[],
  enabled: boolean,
): MonthlyCompareState<DraftHistogramResult> {
  return useMonthlyCompare<DraftHistogramResult>(
    'histogram',
    leg,
    tag,
    months,
    enabled,
  )
}

export function useMonthlyBoxplots(
  leg: ArtifactLeg,
  tag: string | null,
  months: MonthOption[],
  enabled: boolean,
): MonthlyCompareState<DraftBoxplotResult> {
  return useMonthlyCompare<DraftBoxplotResult>(
    'boxplot',
    leg,
    tag,
    months,
    enabled,
  )
}
