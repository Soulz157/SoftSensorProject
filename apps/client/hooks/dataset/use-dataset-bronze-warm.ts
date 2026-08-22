'use client'

import { useCallback } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { ensureDraftId, ensureBronzeArtifactId } from './dataset-draft-bronze'
import {
  dwWorkspaceIdAtom,
  dwSelectedSourcesAtom,
  dwCustomDateRangeAtom,
  dwHoldoutRangeAtom,
  dwCustomIntervalAtom,
  dwFetchConfigAtom,
  dwTimeRangeAtom,
  dwDraftIdAtom,
  dwDraftArtifactIdAtom,
  dwBronzeWarmStateAtom,
} from '@/store/dataset-studio'

/**
 * Background pre-warm for the draft BRONZE artifact (DS-LAKE-005B-B-T01),
 * fired once Step 2's client fetch completes.
 *
 * Today `ensureBronze` inside `useDatasetDraftPipeline` only runs LAZILY, on
 * the user's first Apply/Preview in Step 3.2 — `materialize` is a blocking
 * inline call ("can take minutes"), so that first action pays the full
 * source-fetch cost again, even though Step 2 just fetched the same tags.
 * Calling it here removes that stall for the common case without changing
 * Step 2's UX or waiting on it: this fires AFTER `fetchState` already
 * reports `done`, and its own success/failure is invisible to the user.
 *
 * Deliberately does NOT touch `dwDraftSyncStateAtom` — that atom drives the
 * "Syncing… / Synced to the server. / Server sync failed" banner in Step
 * 3.2, and a background pre-warm failing (or a CSV-only / non-PI source
 * throwing `ensureDraftId`'s "PI / AVEVA only" error) is not a user-facing
 * event. If this warm never runs or fails, `ensureBronze` in
 * `useDatasetDraftPipeline` still resolves the artifact lazily on the real
 * first Apply — unchanged fallback behaviour, proven by the existing
 * `useDatasetDraftPipeline` test suite, which this hook does not touch.
 *
 * HOW A FAILURE REACHES THE UI: by design, usually not directly — a failed
 * warm just means the user's first Apply in Step 3.2 pays the stall this
 * hook exists to remove, which is the same experience as before this task.
 * The one case where it DOES surface is a genuine race: if the user reaches
 * Step 3.2 and clicks Apply WHILE this warm is still in flight,
 * `ensureBronzeArtifactId`'s in-flight dedup (dataset-draft-bronze.ts) makes
 * `useDatasetDraftPipeline`'s `ensureBronze` await THIS SAME request rather
 * than firing a second one — so a failure there DOES land in
 * `dwDraftSyncStateAtom` and the banner, correctly, because at that point a
 * real user action is genuinely waiting on it. The dedup's primary purpose
 * is preventing two concurrent `materialize` calls (two server-side source
 * re-fetches, two BRONZE artifacts) for one logical fetch, not observability
 * — but it is also the only path a background failure has to the user.
 *
 * DS-LAKE-015-T01: also drives `dwBronzeWarmStateAtom` (idle -> materializing
 * -> ready | failed) purely for PROGRESS display (Step 3.1's "preparing"
 * banner, Step 2's "still preparing" note) — this is additive, not a
 * reversal of the failure-invisibility design two paragraphs up.
 * `dwDraftSyncStateAtom` is still never touched here.
 */
export function useDatasetBronzeWarm(): (tags: string[]) => void {
  const workspaceId = useAtomValue(dwWorkspaceIdAtom)
  const selectedSources = useAtomValue(dwSelectedSourcesAtom)
  const customDateRange = useAtomValue(dwCustomDateRangeAtom)
  const holdoutRange = useAtomValue(dwHoldoutRangeAtom)
  const customInterval = useAtomValue(dwCustomIntervalAtom)
  const fetchConfig = useAtomValue(dwFetchConfigAtom)
  const period = useAtomValue(dwTimeRangeAtom)
  const [draftId, setDraftId] = useAtom(dwDraftIdAtom)
  const [artifactId, setArtifactId] = useAtom(dwDraftArtifactIdAtom)
  const [, setWarmState] = useAtom(dwBronzeWarmStateAtom)

  return useCallback(
    (tags: string[]) => {
      setWarmState('materializing')
      void (async () => {
        try {
          const id = await ensureDraftId(
            { workspaceId, selectedSources },
            draftId,
          )
          if (id !== draftId) setDraftId(id)
          const artId = await ensureBronzeArtifactId(
            {
              workspaceId,
              selectedSources,
              customDateRange,
              holdoutRange,
              customInterval,
              fetchConfig,
              period,
            },
            id,
            artifactId,
            tags,
          )
          if (artId !== artifactId) setArtifactId(artId)
          setWarmState('ready')
        } catch {
          // Swallowed on purpose — see module doc. `ensureBronze` in
          // useDatasetDraftPipeline is the real, user-visible retry point.
          setWarmState('failed')
        }
      })()
    },
    [
      workspaceId,
      selectedSources,
      customDateRange,
      holdoutRange,
      customInterval,
      fetchConfig,
      period,
      draftId,
      artifactId,
      setDraftId,
      setArtifactId,
      setWarmState,
    ],
  )
}
