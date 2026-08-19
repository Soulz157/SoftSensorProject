'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { datasetDraftService } from '@/services/dataset-draft'
import { pollDraftJobUntilTerminal } from '@/lib/poll-preprocessing-job'
import type { FeatureConfig } from '@/lib/feature-engineering'
import type { ScalerMethod } from '@/lib/preprocessing'
import {
  dwDraftIdAtom,
  dwDraftArtifactIdAtom,
  dwDraftGoldArtifactIdAtom,
  dwGoldWarmErrorAtom,
} from '@/store/dataset-studio'

const GOLD_WARM_DEBOUNCE_MS = 800

/**
 * Background GOLD warm for Step 4 (DS-LAKE-006-T06).
 *
 * "Step 4 drives the full feature-engineering transform server-side" — this
 * is what makes that literally true: every time the recipe (features,
 * selection, scalers) changes, a debounced call runs applyFeatures ->
 * selectColumns -> toModelReady SERVER-SIDE against the draft's current
 * source artifact (normally SILVER), producing a real GOLD artifact.
 * `dwFeaturedDatasetAtom` (the LOCAL derived atom Step 4's own UI reads for
 * instant feedback) is untouched by this hook — that stays the "bounded
 * interactive preview" the AC names; this hook is the other half.
 * CORRECTION (DS-LAKE-006-AC5 audit): as originally written, that preview
 * was NOT actually bounded — it read `dwRawDatasetAtom` (the full dataset)
 * directly. Fixed by `useDatasetFeaturePreviewSample`
 * (dwFeaturePreviewSampleAtom, a real bounded `/rows` page), which
 * `dwFeaturedDatasetAtom` now reads instead. This sentence was true in
 * intent from T06's own design but not in the code until that fix landed.
 *
 * Debounced (800ms, matching `requestFinalPreview`'s own 600ms class of
 * debounce in `use-dataset-draft-pipeline.ts`, slightly longer since a
 * feature-engineering run is a heavier server call than a preview) and
 * token-guarded — a fast burst of edits (add feature, remove feature,
 * toggle a column) fires ONE server call for the settled recipe, not one
 * per keystroke, and a stale in-flight response can never overwrite a
 * newer one.
 *
 * NO-OPS when the draft or its source artifact do not exist yet — GOLD is
 * always derived FROM something; there is nothing to warm before Step 2/3.2
 * have produced a BRONZE/SILVER artifact.
 *
 * ASYNC JOB, not an inline call (DS-LAKE-006-T06 reversal): starts a
 * `PreprocessingJob` (`stage: 'FEATURE'`) via `startFeaturesJob` (202) and
 * polls it with `pollDraftJobUntilTerminal`, the SAME poller
 * `useDatasetDraftPipeline` uses for CLEAN — feature engineering now runs
 * as a background job for the same reason cleaning does (formula-kind
 * presets can take real time; a synchronous request risked timing out).
 * The inline `POST .../features` route (`createFeatures`) is UNTOUCHED and
 * still works — this hook is the only caller being switched over.
 *
 * Failures are surfaced via `dwGoldWarmErrorAtom`, not swallowed — the
 * dominant real-world failure used to be a feature preset whose equations
 * compile to `kind: 'formula'`, which `feature_service.py` now DOES
 * implement (`formula_service.py`, arithmetic-only grammar); what remains
 * is a genuine 422 (an out-of-grammar formula) or a job landing FAILED,
 * whose `error` field is now what populates this atom, not a caught
 * exception. Three readers of `dwDraftGoldArtifactIdAtom` exist today
 * (`DataAnalysisCard`, `step-5-review-save.tsx`, `useDatasetValidation`),
 * so a silent failure here is no longer harmless — it used to leave Step 5
 * refusing to save with no visible reason.
 */
export function useDatasetGoldWarm(): (
  features: FeatureConfig[],
  selectedColumns: string[] | null,
  scalers: Record<string, ScalerMethod>,
  targetY?: string | null,
) => void {
  const draftId = useAtomValue(dwDraftIdAtom)
  const sourceArtifactId = useAtomValue(dwDraftArtifactIdAtom)
  const [, setGoldArtifactId] = useAtom(dwDraftGoldArtifactIdAtom)
  const [, setGoldWarmError] = useAtom(dwGoldWarmErrorAtom)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tokenRef = useRef(0)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  return useCallback(
    (features, selectedColumns, scalers, targetY) => {
      // Guard BEFORE cancel/token-bump, not after: `sourceArtifactId` flips
      // through null during a BRONZE re-fetch, which busts this callback's
      // memoization (it's a dep below) and re-fires the outer effect even
      // when the recipe itself didn't change. With the guard last, that
      // transient null cancelled an already-scheduled, still-valid warm and
      // replaced it with nothing — a real warm silently lost, not just a
      // no-op skipped.
      if (!draftId || !sourceArtifactId) return

      if (timerRef.current) clearTimeout(timerRef.current)
      const token = ++tokenRef.current
      // Clear any stale error from a prior attempt as soon as a new one is
      // scheduled — an old "formula not implemented" message must not
      // outlive the recipe edit that was meant to fix it.
      setGoldWarmError(null)

      timerRef.current = setTimeout(() => {
        void (async () => {
          try {
            const started = await datasetDraftService.startFeaturesJob(
              draftId,
              sourceArtifactId,
              { features, selectedColumns, scalers, targetY },
            )
            // A newer edit superseded this attempt before the job even
            // started polling — stop here, same as the post-poll check
            // below; `isCancelled` then keeps the poll loop itself from
            // running once superseded, not just its final write.
            if (tokenRef.current !== token) return

            const job = await pollDraftJobUntilTerminal(
              draftId,
              started.data.jobId,
              () => tokenRef.current !== token,
            )
            if (tokenRef.current !== token || !job) return

            if (job.status === 'SUCCEEDED') {
              if (job.resultArtifactId) setGoldArtifactId(job.resultArtifactId)
              setGoldWarmError(null)
            } else if (job.status === 'FAILED') {
              // No longer swallowed — see module doc. `job.error` carries
              // the runner's own recorded message (`readMessage` on the
              // backend never surfaces a raw error), e.g. an out-of-grammar
              // formula's `FormulaError` text for the dominant real case: a
              // feature preset's equations.
              setGoldWarmError(job.error ?? 'Feature engineering failed.')
            }
            // CANCELED: nothing to show — the job's own cancel flow (not
            // reachable from this hook today) already reset relevant state.
          } catch (err) {
            // Covers the 202-request itself failing (network, 4xx before a
            // job row even exists) — the async job's OWN failure is handled
            // above via job.status, not this catch.
            if (tokenRef.current === token) {
              setGoldWarmError(
                err instanceof Error
                  ? err.message
                  : 'Feature engineering failed.',
              )
            }
          }
        })()
      }, GOLD_WARM_DEBOUNCE_MS)
    },
    [draftId, sourceArtifactId, setGoldArtifactId, setGoldWarmError],
  )
}
