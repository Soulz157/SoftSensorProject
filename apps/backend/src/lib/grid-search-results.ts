import type { Logger } from '@nestjs/common';
import { GRID_SEARCH_RESULTS_FILENAME } from '@/lib/artifact-keys';
import { buildRunKey, resolveRunOwner } from '@/lib/model-run-owner';
import {
  getRunGridSearch,
  type RunGridSearch,
} from '@/lib/python-preprocess-client';
import { gridOfJob } from '@/lib/tuning-grid';

/**
 * MODEL-FLOW-038. A grid-search run's ranked combinations, or `null`.
 *
 * No run column records the key (the same shape `cv_gap_predictions.parquet`
 * uses): it is built from the run's owner and the fixed filename. The read is
 * attempted only for a SUCCEEDED run of a grid job, so no run pays a
 * missing-object probe. A storage hiccup is soft — one auxiliary artifact must
 * never fail the fetch it rides on.
 */
export async function readGridSearch(
  run: {
    id: string;
    status: string;
    modelId: string | null;
    modelDraftId: string | null;
  },
  jobCandidates: unknown,
  log: Logger,
): Promise<RunGridSearch | null> {
  if (run.status !== 'SUCCEEDED' || !gridOfJob(jobCandidates)) {
    return null;
  }
  try {
    return await getRunGridSearch(
      buildRunKey(resolveRunOwner(run), run.id, GRID_SEARCH_RESULTS_FILENAME),
    );
  } catch (err) {
    log.error(`could not read grid_search_results for run ${run.id}`, err);
    return null;
  }
}
