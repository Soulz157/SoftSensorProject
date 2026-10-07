'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import type { ModelVersionNumber } from '@/lib/model-version-number'
import { modelVersionService } from '@/services/model-version'

/**
 * Label a STAGING version from the Versions tab. The server owns the
 * "STAGING only" rule (a promote can land after the list was fetched), so
 * any refusal is quoted from the server as a toast — there is no retry path
 * that would justify a dialog the way promote's override has one.
 */
export interface UseModelRenameVersionResult {
  /** Resolves true when the rename was saved. */
  rename: (
    modelId: string,
    version: ModelVersionNumber,
    name: string,
  ) => Promise<boolean>
  busy: boolean
}

export function useModelRenameVersion(
  onRenamed: () => void,
): UseModelRenameVersionResult {
  const [busy, setBusy] = useState(false)

  return {
    rename: async (modelId, version, name) => {
      setBusy(true)
      try {
        const trimmed = name.trim()
        const renamed = await modelVersionService.rename(
          modelId,
          version,
          trimmed === '' ? null : trimmed,
        )
        toast.success(
          renamed.name
            ? `v${renamed.version} renamed to "${renamed.name}"`
            : `v${renamed.version} name cleared`,
        )
        onRenamed()
        return true
      } catch (err) {
        toast.error(
          err instanceof Error && err.message
            ? err.message
            : 'Could not rename this version.',
        )
        return false
      } finally {
        setBusy(false)
      }
    },
    busy,
  }
}
