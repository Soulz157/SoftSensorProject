import { useCallback, useRef } from 'react'
import { useAtom } from 'jotai'
import { MOCK_PI_TAGS } from '@/lib/mock-readings'
import {
  tagListAtom,
  type DiscoveredTag,
  type TagDiscoveryStatus,
} from '@/store/data-visualize'

/**
 * Simulated PI tag-list (catalog) discovery.
 *
 * Same Phase-6 placeholder as `use-dataset-fetch.ts` / `mock-readings.ts`: a real
 * PI Web API call enumerates the server's tags and returns a status per tag. Swap
 * path is one file — replace the `setInterval` body with a `services/` fetch that
 * resolves the same `DiscoveredTag[]`; this hook's return shape stays the same.
 *
 * Unlike `use-dataset-fetch` (resolves all-at-once at the end), discovery resolves
 * tags one-by-one (staggered) so each card shows a live per-tag status.
 */

const STEP_MS = 300
/** Tag whose discovery resolves to `error` in the mock (demos the Error state). */
const ERROR_TAG = 'FI-404'

export type TagListStatus = 'idle' | 'fetching' | 'done'

export interface UseTagListFetchResult {
  tags: DiscoveredTag[]
  status: TagListStatus
  start: () => void
  retry: () => void
}

export function useTagListFetch(): UseTagListFetchResult {
  const [tags, setTags] = useAtom(tagListAtom)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const run = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)

    // Seed the catalog: every tag starts as `fetching`.
    setTags(
      MOCK_PI_TAGS.map(t => ({
        piTag: t.piTag,
        label: t.label,
        description: t.description,
        unit: t.unit,
        chartIndex: t.chartIndex,
        status: 'fetching' as const,
      })),
    )

    // Resolve one tag per tick (staggered) — mirrors per-tag enumeration.
    let i = 0
    timerRef.current = setInterval(() => {
      const tag = MOCK_PI_TAGS[i]
      i += 1
      if (!tag) {
        if (timerRef.current) clearInterval(timerRef.current)
        timerRef.current = null
        return
      }
      const piTag = tag.piTag
      const resolved: TagDiscoveryStatus =
        piTag === ERROR_TAG ? 'error' : 'complete'
      setTags(prev =>
        prev.map(t => (t.piTag === piTag ? { ...t, status: resolved } : t)),
      )
    }, STEP_MS)
  }, [setTags])

  // No unmount cleanup: the interval self-terminates when discovery completes.
  // Clearing it on unmount breaks React Strict Mode's mount→unmount→mount cycle —
  // the seeded tags persist in the global atom, so the start-guard skips the
  // restart and every card stays stuck on `Fetching…`.
  const status: TagListStatus =
    tags.length === 0
      ? 'idle'
      : tags.some(t => t.status === 'fetching')
        ? 'fetching'
        : 'done'

  return { tags, status, start: run, retry: run }
}
