'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/fetcher'
import type { ModelVersionNumber } from '@/lib/model-version-number'
import { modelVersionService } from '@/services/model-version'

/**
 * Promote a model version to PRODUCTION, including the recorded-override
 * path the r2 floor requires (MODEL-SERVE-001-T06).
 *
 * TWO STEPS, AND THE FIRST ONE NEVER CARRIES AN OVERRIDE. The client cannot
 * know a version's r2 ahead of time — `input-schema` returns the stage and
 * feature columns but no metrics — and fetching metrics purely to pre-judge
 * would duplicate the floor's own rule on this side, where it could drift
 * out of step with the server's. So the server decides: attempt a plain
 * promote, and only if IT refuses do we offer the override, quoting its own
 * message rather than a guess at what went wrong.
 *
 * The 422 branch also covers refusals an override CANNOT fix (the model
 * object is gone, its checksum changed). Showing the server's exact text
 * keeps the dialog truthful in those cases too: a reason submitted against
 * one of them simply fails again with the same message, rather than being
 * silently promoted on a missing artifact.
 */
export interface UseModelPromoteResult {
  /** Attempt a promote. Opens the override dialog if the server refuses
   *  with a 422 rather than reporting it as a dead end. `version` is
   *  branded (MODEL-SERVE-001-T08) so a caller cannot pass a bare literal —
   *  it must come from a version the server actually returned. */
  promote: (modelId: string, version: ModelVersionNumber) => Promise<void>
  /** Re-attempt, carrying the reason the user typed. */
  confirmOverride: (reason: string) => Promise<void>
  /** The server's own refusal text — non-null exactly while the override
   *  dialog should be open. Never written by this hook itself. */
  overridePrompt: string | null
  dismissOverride: () => void
  busy: boolean
}

export function useModelPromote(onPromoted: () => void): UseModelPromoteResult {
  const [busy, setBusy] = useState(false)
  const [overridePrompt, setOverridePrompt] = useState<string | null>(null)
  // Held so the confirm step re-targets the SAME version the first attempt
  // was refused for, never whatever the page happens to show by then.
  const [pending, setPending] = useState<{
    modelId: string
    version: ModelVersionNumber
  } | null>(null)

  async function run(
    modelId: string,
    version: ModelVersionNumber,
    override?: { reason: string },
  ) {
    setBusy(true)
    try {
      const promoted = await modelVersionService.promote(
        modelId,
        version,
        override,
      )
      setOverridePrompt(null)
      setPending(null)
      toast.success(`Version ${promoted.version} is now in production`)
      onPromoted()
    } catch (err) {
      // 422 is the server saying "not on these terms" — a floor refusal
      // takes a reason, the artifact refusals do not, and its message says
      // which. Anything else (403, 404, network) is not an override case.
      if (err instanceof ApiError && err.status === 422) {
        setPending({ modelId, version })
        setOverridePrompt(err.message)
        return
      }
      setOverridePrompt(null)
      setPending(null)
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : 'Could not promote this version.',
      )
    } finally {
      setBusy(false)
    }
  }

  return {
    promote: (modelId, version) => run(modelId, version),
    confirmOverride: async (reason: string) => {
      const target = pending
      // Guarded rather than assumed: an empty reason would be recorded as a
      // justification that says nothing, and the dialog's own disabled
      // Confirm is a UI affordance, not an invariant.
      if (!target || !reason.trim()) return
      await run(target.modelId, target.version, { reason: reason.trim() })
    },
    overridePrompt,
    dismissOverride: () => {
      setOverridePrompt(null)
      setPending(null)
    },
    busy,
  }
}
