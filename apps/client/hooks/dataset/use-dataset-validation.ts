'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import { datasetDraftService } from '@/services/dataset-draft'
import type { ValidationReport } from '@/services/dataset-draft'
import {
  dwDraftIdAtom,
  dwDraftArtifactIdAtom,
  dwDraftGoldArtifactIdAtom,
} from '@/store/dataset-studio'

export type DatasetValidationStatus =
  | 'unavailable'
  | 'pending'
  | 'PASS'
  | 'FAIL'

export interface DatasetValidationState {
  status: DatasetValidationStatus
  report: ValidationReport | null
  error: string | null
  /** DS-LAKE-008-T03 wires this to fire on recipe changes. */
  revalidate: () => void
  /** DS-LAKE-005B-B-T01 (Step 5 leg). Exposed so Save can finalize/save the
   * SAME draft+artifact this hook is already gating on, instead of a second
   * component re-deriving `goldArtifactId ?? silverArtifactId` itself and
   * risking the two falling out of sync. */
  draftId: string | null
  gateArtifactId: string | null
}

/**
 * DS-LAKE-008-T01. Runs the Step 5 validation gate against whichever draft
 * artifact currently exists — GOLD (Step 4's server-side feature warm,
 * `useDatasetGoldWarm`) if ready, else SILVER (Step 3.2's clean job) —
 * same fallback order `useDatasetGoldWarm` itself documents.
 *
 * Gated on ARTIFACT PRESENCE, not wizard mode. `use-dataset-edit-hydration.ts`
 * never sets `dwDraftIdAtom`/`dwDraftArtifactIdAtom`/`dwDraftGoldArtifactIdAtom`
 * (confirmed by grep — edit mode hydrates the dataset directly, not through
 * a draft), so a gate artifact is simply absent there and `status` falls out
 * to `unavailable` automatically. Deliberately NOT branching on
 * `mode === 'edit'` — a second, redundant condition would drift from the
 * real one the day edit-mode hydration starts setting draft atoms too
 * (plausibly DS-LAKE-009's job, not this one's).
 *
 * `unavailable` and `pending` are kept distinct on purpose: `unavailable`
 * means the gate does not apply (nothing to validate yet — Save is
 * ungated); `pending` means a gate artifact exists and the call has not
 * resolved (Save must wait). Collapsing them would either block Save with
 * nothing to check against, or silently skip validation while a real
 * artifact sits there unchecked.
 *
 * `report` is cleared at the start of every run (including `revalidate`),
 * so `status` reads `pending` — never a stale PASS/FAIL from the artifact
 * that existed a moment ago — until the new call resolves. This is the
 * mechanism T03's "a stale PASS cannot survive a recipe change" AC depends
 * on; `revalidate` is exposed now so T03 only has to call it, not rebuild
 * this reset logic.
 *
 * A network/request failure is treated as blocking, not as PASS: `report`
 * stays null on error, so `status` stays `pending` — fail closed, matching
 * this feature's own "FAILED validation makes Save unreachable" AC in
 * spirit (an unknown result must not be treated as a good one). `error` is
 * exposed separately so the card can show why.
 */
export function useDatasetValidation(): DatasetValidationState {
  const draftId = useAtomValue(dwDraftIdAtom)
  const silverArtifactId = useAtomValue(dwDraftArtifactIdAtom)
  const goldArtifactId = useAtomValue(dwDraftGoldArtifactIdAtom)
  const gateArtifactId = goldArtifactId ?? silverArtifactId

  const [report, setReport] = useState<ValidationReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const tokenRef = useRef(0)

  const run = useCallback(() => {
    const token = ++tokenRef.current
    setReport(null)
    setError(null)
    if (!draftId || !gateArtifactId) return

    void (async () => {
      try {
        const res = await datasetDraftService.validate(
          draftId,
          gateArtifactId,
          {},
        )
        if (tokenRef.current === token) setReport(res.data)
      } catch (err) {
        if (tokenRef.current === token) {
          setError(
            err instanceof Error ? err.message : 'Validation failed to run',
          )
        }
      }
    })()
  }, [draftId, gateArtifactId])

  useEffect(() => {
    run()
    // Re-run only when the gate artifact itself changes — `run`'s identity
    // already changes exactly when draftId/gateArtifactId do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, gateArtifactId])

  const status: DatasetValidationStatus = !gateArtifactId
    ? 'unavailable'
    : report
      ? report.status
      : 'pending'

  return { status, report, error, revalidate: run, draftId, gateArtifactId }
}
