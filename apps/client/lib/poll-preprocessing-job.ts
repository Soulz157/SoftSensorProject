import {
  datasetDraftService,
  type DraftPreprocessingJob,
} from '@/services/dataset-draft'
import type { PreprocessingJobStatus } from '@/services/dataset-version'

const TERMINAL: PreprocessingJobStatus[] = ['SUCCEEDED', 'FAILED', 'CANCELED']

/** Shared with `useDatasetDraftPipeline`'s own poll cadence — CLEAN and
 * FEATURE jobs should feel the same to a user watching progress. */
export const JOB_POLL_MS = 1_200

/**
 * Poll `GET .../jobs/:jobId` until a terminal status.
 *
 * Extracted so `useDatasetGoldWarm` (FEATURE) and `useDatasetDraftPipeline`
 * (CLEAN) share ONE poll loop rather than each hand-rolling its own —
 * DS-LAKE-006-T06's reversal moved feature engineering onto the same async
 * job runner CLEAN already used, so the polling mechanics are identical;
 * only what each caller DOES with a terminal result differs (CLEAN updates
 * `syncState`+`dwDraftArtifactIdAtom`, FEATURE updates
 * `dwDraftGoldArtifactIdAtom`+`dwGoldWarmErrorAtom`), which is why this
 * returns the raw terminal row rather than mutating any caller's state
 * itself.
 *
 * `isCancelled` is checked before each iteration, not owned here — the
 * caller decides what "cancelled" means (a ref flip, an unmount flag) and
 * is responsible for calling `cancelJob` itself; this function only stops
 * polling once told to. Returns `null` on cancellation, the terminal row
 * otherwise.
 */
export async function pollDraftJobUntilTerminal(
  draftId: string,
  jobId: string,
  isCancelled: () => boolean,
): Promise<DraftPreprocessingJob | null> {
  while (!isCancelled()) {
    const res = await datasetDraftService.job(draftId, jobId)
    if (TERMINAL.includes(res.data.status)) return res.data
    await new Promise(resolve => setTimeout(resolve, JOB_POLL_MS))
  }
  return null
}
