'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import { dwSelectedSourcesAtom } from '@/store/dataset-studio'
import { dataSourceService } from '@/services/data-sources'

/** Server caps tag_names at 500; stay well under so a long preset can't 422. */
const CHUNK = 200

export interface TagResolution {
  sourceId: string
  actualName: string | null
  description: string | null
  unit: string | null
  pointType: string | null
  value: number | string | null
  isGood: boolean | null
  questionable: boolean | null
  substituted: boolean | null
  timestamp: string | null
}

export interface UseTagResolutionResult {
  /** key = tag name. Present in the map ⇒ found in PI. First source wins. */
  resolved: Map<string, TagResolution>
  notFound: string[]
  loading: boolean
  /**
   * The CHECK failed — not "the tags are missing". Callers must not read an
   * empty `resolved` as absence when this is set: on a PI timeout every tag
   * would otherwise be reported missing, sending the engineer to look for
   * forty tags that are all fine.
   */
  error: string | null
  refetch: () => void
}

function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}

/**
 * Ask PI, by name, whether these tags exist — independent of whichever page
 * the tag catalog happens to be showing.
 *
 * Deliberately separate from useDatasetTagMetadata: that hook browses a paged
 * catalog, this one answers a single closed question about a known list. A
 * preset's forty required tags are spread across four hundred catalog pages,
 * so comparing against the loaded rows reported nearly all of them missing.
 */
const EMPTY_RESULT: {
  resolved: Map<string, TagResolution>
  notFound: string[]
} = { resolved: new Map(), notFound: [] }

function resolveFromCache(
  names: string[],
  ids: string[],
  cache: Map<string, TagResolution | null>,
): { resolved: Map<string, TagResolution>; notFound: string[] } {
  const resolved = new Map<string, TagResolution>()
  for (const name of names) {
    // `ids` order decides when the same name exists on several servers.
    for (const id of ids) {
      const hit = cache.get(`${id}::${name}`)
      if (hit) {
        resolved.set(name, hit)
        break
      }
    }
  }
  const notFound = names.filter(
    n => !resolved.has(n) && ids.every(id => cache.has(`${id}::${n}`)),
  )
  return { resolved, notFound }
}

export function useTagResolution(tagNames: string[]): UseTagResolutionResult {
  const sources = useAtomValue(dwSelectedSourcesAtom)
  // Last settled fetch, tagged with the request it answers. `loading`, the
  // cleared error on a new request and the empty result with nothing to
  // resolve are DERIVED from it during render, never set in the effect body.
  const [settled, setSettled] = useState<{
    key: string
    resolved: Map<string, TagResolution>
    notFound: string[]
    error: string | null
  } | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)

  // `${sourceId}::${tagName}` → TagResolution | null (null = confirmed absent).
  // Held in state (never replaced) so render can read it.
  const [cache] = useState(() => new Map<string, TagResolution | null>())

  const ids = useMemo(
    () => sources.filter(s => s.type === 'aveva').map(s => s.id),
    [sources],
  )
  const idsKey = JSON.stringify(ids)
  // Sorted + deduped so a reordered list doesn't retrigger the effect.
  const namesKey = JSON.stringify([...new Set(tagNames)].sort())
  const names = useMemo(() => JSON.parse(namesKey) as string[], [namesKey])

  const requestKey =
    names.length > 0 && ids.length > 0
      ? JSON.stringify([namesKey, idsKey, reloadNonce])
      : null
  const allCached =
    requestKey !== null &&
    ids.every(id => names.every(n => cache.has(`${id}::${n}`)))

  useEffect(() => {
    if (!requestKey) return

    const jobs = ids.flatMap(id =>
      chunk(
        names.filter(n => !cache.has(`${id}::${n}`)),
        CHUNK,
      ).map(batch => ({ id, batch })),
    )
    if (jobs.length === 0) return

    const ctrl = new AbortController()

    void Promise.allSettled(
      jobs.map(j =>
        dataSourceService.resolveTags(j.id, j.batch, { signal: ctrl.signal }),
      ),
    ).then(results => {
      if (ctrl.signal.aborted) return
      const failed = new Set<string>()

      results.forEach((r, i) => {
        const job = jobs[i]
        if (!job) return
        if (r.status === 'rejected') {
          failed.add(job.id)
          return
        }
        for (const t of r.value.data.tags) {
          cache.set(
            `${job.id}::${t.tagName}`,
            t.exists
              ? {
                  sourceId: job.id,
                  actualName: t.actualName ?? t.tagName,
                  description: t.description,
                  unit: t.unit,
                  pointType: t.pointType,
                  value: t.value,
                  isGood: t.isGood,
                  questionable: t.questionable,
                  substituted: t.substituted,
                  timestamp: t.timestamp,
                }
              : null,
          )
        }
      })

      setSettled({
        key: requestKey,
        ...resolveFromCache(names, ids, cache),
        error: failed.size
          ? `Could not verify tags against ${failed.size} of ${ids.length} source(s).`
          : null,
      })
    })

    return () => ctrl.abort()
  }, [requestKey, names, ids, cache])

  // Fully cached: read straight from the cache. Otherwise the last settled
  // result stays on screen while the next request loads; nothing to resolve
  // shows nothing.
  const { resolved, notFound } = useMemo(
    () =>
      requestKey === null
        ? EMPTY_RESULT
        : allCached
          ? resolveFromCache(names, ids, cache)
          : (settled ?? EMPTY_RESULT),
    // `settled` stands in for cache writes: every write is followed by one.
    [requestKey, allCached, names, ids, cache, settled],
  )
  const settledHere = settled?.key === requestKey ? settled : null
  const loading = requestKey !== null && !allCached && settledHere === null
  const error =
    requestKey !== null && !allCached ? (settledHere?.error ?? null) : null

  const refetch = useCallback(() => {
    cache.clear()
    setReloadNonce(n => n + 1)
  }, [cache])

  return { resolved, loading, error, notFound, refetch }
}
