'use client'

import { useEffect, useRef } from 'react'
import { getCached, setCached } from '@/lib/chart-request-cache'

/**
 * DS-LAKE-005B-D-T06. Shared request lifecycle for Step 3.1's server-backed
 * chart hooks (`useDatasetHistogram`/`useDatasetBoxplot`/`useDatasetScatter`/
 * `useDatasetCorrelation`) — extracted here rather than duplicated 4 times.
 *
 * Three things, all required by this task's own title, none of which the
 * chart hooks had before this task:
 *
 * 1. DEBOUNCE — 600ms, matching `requestFinalPreview`'s own class of
 *    debounce (`use-dataset-draft-pipeline.ts`; `useDatasetGoldWarm` uses
 *    800ms for its heavier feature-engineering call). Step 3.1 edits rules
 *    live, so without this every keystroke would fire one request.
 * 2. ABORT-ON-SUPERSEDE — a NEW dependency change cancels whatever this
 *    hook had pending, both a not-yet-fired debounce timer AND a real
 *    in-flight fetch via `AbortController`. This is stronger than the
 *    sibling hooks' pre-existing `tokenRef`-only guard (which ignores a
 *    stale response but lets the request keep running server-side) — the
 *    request itself is now cancelled, not just its result discarded.
 * 3. CACHE — keyed on `cacheKey`, which the CALLER must build from every
 *    field that determines what the server resolves (see
 *    `chart-request-cache.ts`'s own header for why an operations-only key
 *    is wrong). A cache hit skips the network entirely, still respecting
 *    the debounce/abort discipline for anything already in flight.
 *
 * `fetcher` is deliberately excluded from the effect's own dependency
 * array (same `eslint-disable-next-line react-hooks/exhaustive-deps`
 * convention the sibling hooks already use) — `cacheKey` is the real
 * identity of "has the request changed", and closing over a fresh
 * `fetcher` every render would otherwise re-fire on every render
 * regardless of whether anything meaningful changed.
 */

type Settled<T> =
  | { status: 'ready'; data: T }
  | { status: 'error'; error: string }

interface Options<T> {
  /** `false` skips fetching entirely (mirrors each hook's own "nothing to
   * query yet" guard) — the shared lifecycle still clears any pending
   * timer/in-flight request from a PRIOR enabled state. */
  enabled: boolean
  /** `null` behaves like `enabled: false` — some hooks don't know their
   * full key until an id resolves. Must encode every request-determining
   * field (see this file's own header). */
  cacheKey: string | null
  debounceMs?: number
  fetcher: (signal: AbortSignal) => Promise<T>
  onLoading: () => void
  onSettled: (result: Settled<T>) => void
  /** Called once per transition INTO `!enabled || !cacheKey` — the
   * caller's chance to clear stale data/loading/error from a prior
   * enabled state (e.g. `tags` emptied out). NOT called on every render
   * while already disabled, only on the transition, so callers can
   * unconditionally reset state without re-deriving whether anything
   * actually changed. */
  onIdle: () => void
  /** MODEL-FLOW-016-T11. `false` (default) is every existing caller's
   * behaviour, unchanged. A poll-driven caller that mints a unique
   * `cacheKey` per tick purely to force a fresh fetch (see
   * `use-draft-run-evaluation.ts`'s scoring poll) must pass `true` on
   * those ticks — the module-level cache has no size bound or LRU
   * (`chart-request-cache.ts`'s own header: short TTL, not "forever", but
   * still unbounded storage until each entry's own TTL lapses), so a
   * never-reused key written on every tick is a pure leak, one entry per
   * tick for as long as the caller keeps polling. */
  skipCache?: boolean
}

const DEFAULT_DEBOUNCE_MS = 600

export function useDebouncedAbortableRequest<T>({
  enabled,
  cacheKey,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  fetcher,
  onLoading,
  onSettled,
  onIdle,
  skipCache = false,
}: Options<T>): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const tokenRef = useRef(0)
  // Refs, not deps: `onLoading`/`onSettled`/`onIdle` are inline closures at
  // most call sites and would otherwise force a re-subscribe every render.
  const fetcherRef = useRef(fetcher)
  const onLoadingRef = useRef(onLoading)
  const onSettledRef = useRef(onSettled)
  const onIdleRef = useRef(onIdle)
  fetcherRef.current = fetcher
  onLoadingRef.current = onLoading
  onSettledRef.current = onSettled
  onIdleRef.current = onIdle

  useEffect(() => {
    // Cancel whatever was pending from the PREVIOUS key before doing
    // anything else — this is the abort-on-supersede guarantee.
    if (timerRef.current) clearTimeout(timerRef.current)
    controllerRef.current?.abort()

    if (!enabled || !cacheKey) {
      onIdleRef.current()
      return
    }

    const cached = skipCache ? undefined : getCached<T>(cacheKey)
    if (cached !== undefined) {
      onSettledRef.current({ status: 'ready', data: cached })
      return
    }

    const token = ++tokenRef.current
    timerRef.current = setTimeout(() => {
      onLoadingRef.current()
      const controller = new AbortController()
      controllerRef.current = controller

      void (async () => {
        try {
          const data = await fetcherRef.current(controller.signal)
          if (tokenRef.current !== token) return
          if (!skipCache) setCached(cacheKey, data)
          onSettledRef.current({ status: 'ready', data })
        } catch (err) {
          if (tokenRef.current !== token) return
          if (err instanceof DOMException && err.name === 'AbortError') return
          onSettledRef.current({
            status: 'error',
            error: err instanceof Error ? err.message : 'Request failed',
          })
        }
      })()
    }, debounceMs)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      controllerRef.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cacheKey, debounceMs, skipCache])
}
