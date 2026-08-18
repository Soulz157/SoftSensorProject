/**
 * DS-LAKE-005B-D-T06. Short-lived module-level cache for Step 3.1's
 * server-backed chart requests (histogram/boxplot/scatter/correlation).
 *
 * CACHE KEY DISCIPLINE (this task's own scope_note, the reason this
 * module exists rather than each hook rolling its own): a cache keyed
 * only on an operations hash would serve a STALE matrix after a topK
 * change or a ranking flip changes WHICH columns got resolved, with
 * identical operations. Every caller of `getCached`/`setCached` MUST
 * build its key from every REQUEST-side field that can change which
 * columns the server resolves — tags/xTag+yTag, binCount/kdeSamples/
 * outlierCap/topK, not just the operations hash. The resolved list itself
 * isn't known until the response arrives, so the key is built from what
 * DETERMINES it (deterministic given the same inputs), not the resolved
 * list's own contents — see each hook's own cache-key construction for
 * the concrete field list per endpoint.
 *
 * Short TTL, not "forever": the underlying artifact can be superseded by
 * a background job (GOLD promotion, a new SILVER commit) between two
 * requests that otherwise look identical, and this cache has no way to
 * observe that — a long-lived cache would silently serve pre-promotion
 * data. 30s trades a few redundant requests during a burst of edits for
 * never serving genuinely stale data across an artifact transition.
 */

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

const DEFAULT_TTL_MS = 30_000

const cache = new Map<string, CacheEntry<unknown>>()

export function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return undefined
  }
  return entry.data as T
}

export function setCached<T>(
  key: string,
  data: T,
  ttlMs: number = DEFAULT_TTL_MS,
): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs })
}

/** Test-only escape hatch — module-level state must not leak between
 * test cases. */
export function clearChartRequestCache(): void {
  cache.clear()
}
