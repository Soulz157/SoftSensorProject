'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { datasetDraftService } from '@/services/dataset-draft'
import type { FeatureConfig } from '@/lib/feature-engineering'
import type { ScalerMethod } from '@/lib/preprocessing'
import {
  dwDraftIdAtom,
  dwDraftArtifactIdAtom,
  dwDraftGoldArtifactIdAtom,
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
 * have produced a BRONZE/SILVER artifact. Failures are swallowed, same
 * reasoning as `useDatasetBronzeWarm`: this is a background pre-warm with no
 * user-facing failure surface today, because nothing downstream reads
 * `dwDraftGoldArtifactIdAtom` yet (see that atom's own doc comment) — a
 * silent failure here costs nothing a user can currently observe.
 */
export function useDatasetGoldWarm(): (
  features: FeatureConfig[],
  selectedColumns: string[] | null,
  scalers: Record<string, ScalerMethod>,
) => void {
  const draftId = useAtomValue(dwDraftIdAtom)
  const sourceArtifactId = useAtomValue(dwDraftArtifactIdAtom)
  const [, setGoldArtifactId] = useAtom(dwDraftGoldArtifactIdAtom)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tokenRef = useRef(0)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  return useCallback(
    (features, selectedColumns, scalers) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      const token = ++tokenRef.current

      if (!draftId || !sourceArtifactId) return

      timerRef.current = setTimeout(() => {
        void (async () => {
          try {
            const res = await datasetDraftService.createFeatures(
              draftId,
              sourceArtifactId,
              { features, selectedColumns, scalers },
            )
            if (tokenRef.current === token) {
              setGoldArtifactId(res.data.id)
            }
          } catch {
            // Swallowed on purpose — see module doc. No current UI surface
            // reads dwDraftGoldArtifactIdAtom, so there is nothing to show
            // an error against yet.
          }
        })()
      }, GOLD_WARM_DEBOUNCE_MS)
    },
    [draftId, sourceArtifactId, setGoldArtifactId],
  )
}
