'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/fetcher'
import type { ModelVersionNumber } from '@/lib/model-version-number'
import { modelVersionService } from '@/services/model-version'

/**
 * MODEL-SERVE-017. Remove a model version that was never deployed.
 *
 * SAME SHAPE AS `useModelPromote`, AND FOR THE SAME REASON. The client
 * cannot decide whether a version is removable: "never deployed" also means
 * it was never promoted in the past (it would be rollback's target) and
 * nothing — no prediction job, log or inference window — still points at
 * it, none of which the versions list carries. So the server decides, and a
 * 422 is surfaced with the server's OWN sentence rather than a reworded
 * guess. Unlike promote there is no override: every refusal here is a fact
 * about other rows, not a threshold a reason can cross.
 */
export interface UseModelRemoveVersionResult {
  remove: (modelId: string, version: ModelVersionNumber) => Promise<void>
  /** The server's refusal text — non-null exactly while the refusal dialog
   *  should be open. */
  refusal: string | null
  dismissRefusal: () => void
  busy: boolean
}

export function useModelRemoveVersion(
  onRemoved: () => void,
): UseModelRemoveVersionResult {
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  return {
    remove: async (modelId, version) => {
      setBusy(true)
      try {
        const removed = await modelVersionService.remove(modelId, version)
        setRefusal(null)
        toast.success(`Version ${removed.version} removed`)
        onRemoved()
      } catch (err) {
        // 422 is the server refusing on the state of OTHER rows — worth a
        // dialog, because the reason is specific and actionable ("promote
        // another version first", "3 inference window(s) reference it").
        // Anything else (403, 404, network) is a toast like everywhere.
        if (err instanceof ApiError && err.status === 422) {
          setRefusal(err.message)
          return
        }
        setRefusal(null)
        toast.error(
          err instanceof Error && err.message
            ? err.message
            : 'Could not remove this version.',
        )
      } finally {
        setBusy(false)
      }
    },
    refusal,
    dismissRefusal: () => setRefusal(null),
    busy,
  }
}
