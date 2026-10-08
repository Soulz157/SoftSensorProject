'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  modelVersionService,
  type ModelVersionRow,
} from '@/services/model-version'

/**
 * MODEL-SERVE-016-T02. Every version of one model, newest first.
 *
 * `refetch` exists because promoting from the table changes the stage of TWO
 * rows — the incoming version and whichever one it displaced — and patching
 * the list locally would mean reimplementing the server's own promote rules
 * on this side. Re-reading is shorter and cannot drift from them.
 *
 * It bumps a nonce rather than calling the fetch directly, and every result
 * is KEYED BY THE MODEL ID IT CAME FROM, with `loading` derived from
 * comparing that key to the current `modelId`. The obvious shape —
 * `setLoading(true)` at the top of the fetch — writes state synchronously
 * during the effect body on mount, which cascades a render and trips
 * `react-hooks/set-state-in-effect`. Keying also means a result for a model
 * the user has navigated away from can never render under the new one's
 * name.
 *
 * A REFETCH KEEPS THE OLD ROWS ON SCREEN. `loading` is false while the keys
 * still match, so promoting does not blank the table for a round trip — the
 * stage chips simply update when the new read lands.
 */
export function useModelVersions(modelId: string | null) {
  const [result, setResult] = useState<{
    modelId: string
    versions: ModelVersionRow[]
  } | null>(null)
  const [failure, setFailure] = useState<{
    modelId: string
    message: string
  } | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!modelId) return

    let active = true
    modelVersionService
      .list(modelId)
      .then(versions => {
        if (!active) return
        setResult({ modelId, versions })
        setFailure(null)
      })
      .catch((err: unknown) => {
        if (!active) return
        setFailure({
          modelId,
          message:
            err instanceof Error && err.message
              ? err.message
              : 'Could not load versions.',
        })
      })

    return () => {
      active = false
    }
  }, [modelId, nonce])

  const matches = modelId !== null && result?.modelId === modelId
  const failed = modelId !== null && failure?.modelId === modelId

  return {
    versions: matches && result ? result.versions : [],
    loading: modelId !== null && !matches && !failed,
    error: failed && failure ? failure.message : null,
    refetch: useCallback(() => setNonce(n => n + 1), []),
  }
}
