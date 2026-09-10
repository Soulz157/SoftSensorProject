'use client'

import { useArtifactSplitStats } from '@/hooks/dataset/artifact/use-artifact-split-stats'

/** Where the figure came from — carried so a surface can say so rather than
 *  presenting an artifact-level read as this run's own frozen record. */
export type DistinctLabelledSource = 'run' | 'artifact' | null

export interface RunDistinctLabelledState {
  value: number | null
  source: DistinctLabelledSource
  loading: boolean
  /** Verbatim reason the lookup could not answer, or null. */
  reason: string | null
}

/**
 * MODEL-FLOW-019-T31. ONE resolution of the distinct labelled value count for
 * every Step 5 surface that needs it — the importance table's
 * observations-per-feature line (AC26), the sweep table's own column (AC68),
 * and the sweep launcher's fold-count derivation.
 *
 * WHY THIS EXISTS AT ALL. Those three surfaces each read
 * `run.splitStats?.distinct_labelled_values` independently, and that column is
 * null for 187 of this system's 260 SUCCEEDED runs: a candidate-job run
 * freezes no splitStats BY DESIGN (MODEL-FLOW-014-T06 — N candidates share one
 * split, so freezing per candidate would be N redundant artifact reads for one
 * identical answer). The visible result was "Observations per feature: not
 * recorded for this run" on most runs a user actually opens.
 *
 * The fix a first pass reached for — letting the launcher fetch privately —
 * would have put two panels on ONE screen disagreeing about ONE number: folds
 * derived from 32 while the table directly above still said "not recorded".
 * That is the failure AC41 exists to prevent, arriving through a different
 * door. So the resolution is hoisted here and passed down, the same way
 * `populationOf` is one derivation rather than a per-panel guess.
 *
 * PREFERENCE ORDER, AND WHY IT IS NOT ARBITRARY. The run's own frozen figure
 * wins wherever it exists: it is the record of what this run was actually
 * sized against. Otherwise the artifact is asked, because the count depends
 * only on the artifact and the target — which is precisely the reasoning that
 * made a per-candidate freeze redundant in the first place ("one identical
 * answer"). `[targetY]` as the tag list is the same default `launchDraftRun`
 * freezes against when `splitStatsTags` is omitted, and the endpoint requires
 * at least one tag.
 */
export function useRunDistinctLabelled(
  datasetId: string | null,
  goldArtifactId: string | null,
  targetY: string | null,
  frozen: number | null,
): RunDistinctLabelledState {
  const needsLookup =
    frozen === null && Boolean(datasetId && goldArtifactId && targetY)

  const lookup = useArtifactSplitStats(
    needsLookup ? datasetId : null,
    needsLookup ? goldArtifactId : null,
    targetY ? [targetY] : [],
    needsLookup ? targetY : null,
    // Ratio mode: the figure read here is independent of where the split
    // falls, so this argument is required rather than meaningful.
    0.8,
  )

  if (frozen !== null) {
    return { value: frozen, source: 'run', loading: false, reason: null }
  }

  if (!needsLookup) {
    return { value: null, source: null, loading: false, reason: null }
  }

  const value = lookup.splitStats?.distinct_labelled_values ?? null
  return {
    value,
    source: value === null ? null : 'artifact',
    loading: lookup.loading,
    reason: lookup.missing ?? lookup.refusal ?? lookup.error,
  }
}
