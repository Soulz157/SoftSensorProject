import { datasetDraftService } from '@/services/dataset-draft'
import { piFetchInputError, toPiTime } from '@/lib/dataset-fetch'
import type { CustomInterval, FetchPeriod } from '@/store/model-pipeline'
import type { CustomDateRange } from '@/store/data-visualize'
import type { SavedDataSource } from '@/lib/mock-data-sources'
import { piSummaryParams, type HistoricalFetchConfig } from '@/lib/fetch-config'

/**
 * Pure (no React, no atoms) draft/bronze creation logic, extracted from
 * `useDatasetDraftPipeline` (DS-LAKE-005B-B-T01) so it has exactly one
 * implementation shared by two callers with different error-surface needs:
 *
 *   - `useDatasetDraftPipeline` (Step 3.2) — a failure is USER-VISIBLE, landed
 *     in `dwDraftSyncStateAtom` and rendered as a banner.
 *   - the background warm fired from `useDatasetStudioFetch` (Step 2, this
 *     task) — a failure must be SILENT: it is a pre-warm, not a user action,
 *     and `ensureBronzeArtifactId` below still runs lazily on the user's
 *     first real Apply/Preview if the warm never landed or failed. Writing
 *     shared state here would make a background failure show the same
 *     "Server sync failed" banner Step 3.2 uses for a real one, before the
 *     user ever reaches that step.
 *
 * Both callers already read/write the SAME shared atoms for the ids
 * (`dwDraftIdAtom` / `dwDraftArtifactIdAtom`), so no id-sharing plumbing is
 * needed here beyond taking the current value and returning the resolved one
 * — only the error handling differs, and that stays in each caller.
 *
 * IN-FLIGHT DEDUP (DS-LAKE-005B-B-T01 follow-up): the background warm and
 * Step 3.2's lazy `ensureBronze` can legitimately race — the user reaches
 * Step 3.2 and clicks Apply while the warm from Step 2 is still in flight.
 * Without dedup that is TWO concurrent `materialize` calls for the same
 * tags, i.e. two server-side source re-fetches and two BRONZE artifacts
 * written for one logical fetch — the exact "same shape as the double-fetch
 * this feature exists to fix" risk. Both exported functions therefore share
 * one in-flight promise per key: a second caller with the same key AWAITS
 * the first caller's request instead of issuing its own. The entry is
 * removed once the promise settles (success OR failure), so a caller that
 * runs AFTER a completed attempt still gets a fresh try — this is a
 * de-duplication window, not a permanent cache; `artifactId`/`draftId`
 * being non-null is what makes a resolved id free on every later call.
 */

const inFlightDrafts = new Map<string, Promise<string>>()
const inFlightArtifacts = new Map<string, Promise<string>>()

async function dedup(
  cache: Map<string, Promise<string>>,
  key: string,
  run: () => Promise<string>,
): Promise<string> {
  const existing = cache.get(key)
  if (existing) return existing
  const promise = run().finally(() => cache.delete(key))
  cache.set(key, promise)
  return promise
}

export interface BronzeContext {
  workspaceId: string
  selectedSources: SavedDataSource[]
  customDateRange: CustomDateRange | null
  customInterval: CustomInterval | null
  fetchConfig: HistoricalFetchConfig
  period: FetchPeriod
  /** DS-LAKE-018-T03. Null means no holdout — behaves exactly as today. */
  holdoutRange: CustomDateRange | null
}

/** Same single-PI-source scope as the wizard's live fetch (F8). */
export async function ensureDraftId(
  ctx: Pick<BronzeContext, 'workspaceId' | 'selectedSources'>,
  draftId: string | null,
): Promise<string> {
  if (draftId) return draftId
  return dedup(inFlightDrafts, ctx.workspaceId, async () => {
    const source = ctx.selectedSources.find(s => s.type === 'aveva')
    if (!source) {
      throw new Error(
        'Server sync currently supports PI / AVEVA sources, same as the wizard fetch.',
      )
    }
    const res = await datasetDraftService.create({
      workspaceId: ctx.workspaceId,
      sourceIds: [source.id],
    })
    return res.data.id
  })
}

/**
 * DS-LAKE-037. Like `ensureDraftId`, but for the wizard-resume snapshot rather
 * than for BRONZE: it must also work for a source the BRONZE path cannot read
 * (a CSV), because the snapshot is configuration only. Prefers the PI source
 * when there is one, so the draft `ensureDraftId` later finds is the SAME row.
 * Shares `inFlightDrafts`, so a snapshot create and a bronze-warm create
 * racing on one workspace issue ONE POST.
 */
export async function ensureWizardDraftId(
  ctx: Pick<BronzeContext, 'workspaceId' | 'selectedSources'> & {
    name?: string
  },
  draftId: string | null,
): Promise<string> {
  if (draftId) return draftId
  return dedup(inFlightDrafts, ctx.workspaceId, async () => {
    const source =
      ctx.selectedSources.find(s => s.type === 'aveva') ??
      ctx.selectedSources[0]
    if (!source) {
      throw new Error('Select a data source before saving a resumable draft.')
    }
    const res = await datasetDraftService.create({
      workspaceId: ctx.workspaceId,
      sourceIds: [source.id],
      name: ctx.name || undefined,
    })
    return res.data.id
  })
}

export async function ensureBronzeArtifactId(
  ctx: BronzeContext,
  draftId: string,
  artifactId: string | null,
  tags: string[],
): Promise<string> {
  if (artifactId) return artifactId
  // The fetch window and summary settings are part of the key: a materialize
  // still in flight for the PREVIOUS Step 2 range must not be handed to a
  // caller asking for the new one (it would return the old, shorter BRONZE).
  const key = [
    draftId,
    ctx.customDateRange?.from ?? '',
    ctx.customDateRange?.to ?? '',
    JSON.stringify(
      piSummaryParams(ctx.fetchConfig, ctx.period, ctx.customInterval),
    ),
    [...tags].sort().join(','),
  ].join('|')
  return dedup(inFlightArtifacts, key, async () => {
    const guard = piFetchInputError(
      ctx.selectedSources,
      tags,
      ctx.customDateRange?.from,
      ctx.customDateRange?.to,
    )
    if (!guard.ok) throw new Error(guard.error)

    const res = await datasetDraftService.materialize(draftId, {
      sourceId: guard.source.id,
      tags,
      startTime: toPiTime(ctx.customDateRange!.from),
      endTime: toPiTime(ctx.customDateRange!.to),
      // Bucket AND the Historical Fetch Settings: the BRONZE is what trains.
      ...piSummaryParams(ctx.fetchConfig, ctx.period, ctx.customInterval),
      // DS-LAKE-018-T03: same toPiTime conversion as startTime/endTime — the
      // python side compares holdout timestamps directly against the
      // materialized frame's own, so both must speak the same format.
      ...(ctx.holdoutRange && {
        holdout: {
          from: toPiTime(ctx.holdoutRange.from),
          to: toPiTime(ctx.holdoutRange.to),
        },
      }),
    })
    return res.data.id
  })
}
