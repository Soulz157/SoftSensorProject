import {
  datasetDraftService,
  type DraftPreprocessingJob,
} from '@/services/dataset-draft'
import { datasetVersionService } from '@/services/dataset-version'
import type { PreprocessingJobStatus } from '@/services/dataset-version'

const TERMINAL: PreprocessingJobStatus[] = ['SUCCEEDED', 'FAILED', 'CANCELED']

/** Shared with `useDatasetDraftPipeline`'s own poll cadence — CLEAN,
 * FEATURE, and EXPORT jobs should all feel the same to a user watching
 * progress. */
export const JOB_POLL_MS = 1_200

/**
 * Generic core poll loop — `GET .../jobs/:jobId` until a terminal status,
 * whatever `fetchJob` happens to call. Extracted from the draft-only
 * `pollDraftJobUntilTerminal` (DS-LAKE-021) so a THIRD caller scoped to a
 * saved dataset (`pollDatasetJobUntilTerminal`, export jobs) does not have
 * to hand-roll its own loop — this file's own original doc comment already
 * argued for exactly one shared loop across CLEAN and FEATURE; a fork for
 * EXPORT would violate that same reasoning.
 *
 * `isCancelled` is checked before each iteration, not owned here — the
 * caller decides what "cancelled" means (a ref flip, an unmount flag) and
 * is responsible for calling whatever cancel-the-job action applies; this
 * function only stops polling once told to. Returns `null` on
 * cancellation, the terminal row otherwise.
 */
export async function pollJobUntilTerminal<
  T extends { status: PreprocessingJobStatus },
>(
  fetchJob: () => Promise<{ data: T }>,
  isCancelled: () => boolean,
): Promise<T | null> {
  while (!isCancelled()) {
    const res = await fetchJob()
    if (TERMINAL.includes(res.data.status)) return res.data
    await new Promise(resolve => setTimeout(resolve, JOB_POLL_MS))
  }
  return null
}

/** Draft-scoped wrapper — unchanged call signature for existing callers
 * (`useDatasetGoldWarm`, `useDatasetDraftPipeline`). */
export function pollDraftJobUntilTerminal(
  draftId: string,
  jobId: string,
  isCancelled: () => boolean,
): Promise<DraftPreprocessingJob | null> {
  return pollJobUntilTerminal(
    () => datasetDraftService.job(draftId, jobId),
    isCancelled,
  )
}

/**
 * DS-LAKE-021. Dataset-scoped wrapper for a job that runs against a SAVED
 * dataset rather than a draft — export is the first caller, but the same
 * `GET /:id/jobs/:jobId` route already backs any saved-dataset job.
 */
export function pollDatasetJobUntilTerminal(
  datasetId: string,
  jobId: string,
  isCancelled: () => boolean,
) {
  return pollJobUntilTerminal(
    () => datasetVersionService.job(datasetId, jobId),
    isCancelled,
  )
}
