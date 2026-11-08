'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { dataIntakeService } from '@/services/data-intake'
import type { Scope } from '@/lib/data-intake'
import type { DataIntake, IntakeRange } from '@/types/data-intake'

export type LoadState = 'loading' | 'error' | 'ready'

/**
 * Data Intake figures for one workspace, or every workspace (`scope: 'all'`,
 * admin only). A failure is returned as `error`, never as empty "all good"
 * data. When `scope` or `range` changes the previous figures stay in `data`
 * while `isFetching` is true, so the page can dim them instead of blanking.
 */
export function useDataIntake(
  scope: Scope,
  range: IntakeRange,
  enabled = true,
) {
  const { status } = useSession()
  const [data, setData] = useState<DataIntake | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isFetching, setIsFetching] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (status !== 'authenticated' || !enabled) return
    let ignore = false
    // `queueMicrotask`: state is set after the effect body, not inside it.
    queueMicrotask(async () => {
      if (ignore) return
      setIsFetching(true)
      setError(null)
      try {
        const res =
          scope === 'all'
            ? await dataIntakeService.getAll(range)
            : await dataIntakeService.getWorkspace(scope, range)
        // A body without `data` is a failed load, not an empty "ready" page.
        if (!res?.data) throw new Error('Empty data intake response')
        if (!ignore) setData(res.data)
      } catch {
        if (!ignore) {
          // Drop the old figures: stale counts beside an error read as current.
          setData(null)
          setError("Couldn't load data intake.")
        }
      } finally {
        if (!ignore) setIsFetching(false)
      }
    })
    return () => {
      ignore = true
    }
  }, [status, enabled, scope, range, nonce])

  const refetch = useCallback(() => setNonce(n => n + 1), [])

  const state: LoadState = error ? 'error' : data === null ? 'loading' : 'ready'

  return { data, state, isFetching, error, refetch }
}
