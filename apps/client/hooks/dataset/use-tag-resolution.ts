'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
export function useTagResolution(tagNames: string[]): UseTagResolutionResult {
  const sources = useAtomValue(dwSelectedSourcesAtom)
  const [resolved, setResolved] = useState<Map<string, TagResolution>>(
    new Map(),
  )
  const [notFound, setNotFound] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)

  // `${sourceId}::${tagName}` → TagResolution | null (null = confirmed absent)
  const cache = useRef(new Map<string, TagResolution | null>())

  const ids = useMemo(
    () => sources.filter(s => s.type === 'aveva').map(s => s.id),
    [sources],
  )
  const idsKey = JSON.stringify(ids)
  // Sorted + deduped so a reordered list doesn't retrigger the effect.
  const namesKey = JSON.stringify([...new Set(tagNames)].sort())

  useEffect(() => {
    const names: string[] = JSON.parse(namesKey)
    if (names.length === 0 || ids.length === 0) {
      setResolved(new Map())
      setError(null)
      setLoading(false)
      return
    }

    const build = () => {
      const map = new Map<string, TagResolution>()
      for (const name of names) {
        // `ids` order decides when the same name exists on several servers.
        for (const id of ids) {
          const hit = cache.current.get(`${id}::${name}`)
          if (hit) {
            map.set(name, hit)
            break
          }
        }
      }
      return map
    }

    const buildNotFound = (map: Map<string, TagResolution>) =>
      names.filter(
        n => !map.has(n) && ids.every(id => cache.current.has(`${id}::${n}`)),
      )

    const commit = () => {
      const map = build()
      setResolved(map)
      setNotFound(buildNotFound(map))
    }

    const jobs = ids.flatMap(id =>
      chunk(
        names.filter(n => !cache.current.has(`${id}::${n}`)),
        CHUNK,
      ).map(batch => ({ id, batch })),
    )

    if (jobs.length === 0) {
      commit()
      setResolved(build())
      setError(null)
      setLoading(false)
      return
    }

    const ctrl = new AbortController()
    setLoading(true)
    setError(null)

    Promise.allSettled(
      jobs.map(j =>
        dataSourceService.resolveTags(j.id, j.batch, { signal: ctrl.signal }),
      ),
    )
      .then(results => {
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
            cache.current.set(
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

        commit()
        setError(
          failed.size
            ? `Could not verify tags against ${failed.size} of ${ids.length} source(s).`
            : null,
        )
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })

    return () => ctrl.abort()
  }, [namesKey, idsKey, reloadNonce])

  const refetch = useCallback(() => {
    cache.current.clear()
    setReloadNonce(n => n + 1)
  }, [])

  return { resolved, loading, error, notFound, refetch }
}
