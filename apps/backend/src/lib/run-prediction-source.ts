/**
 * MODEL-FLOW-019-T20. WHICH object key holds WHICH population, for one run.
 *
 * A pure derivation with no Prisma/Nest import, in `lib/` for the same reason
 * the client keeps `lib/metric-source.ts` pure: this is the one rule that
 * decides whether a series a reader is about to plot is the run's own TEST
 * split or the dataset's raw validation HOLDOUT, and this whole feature
 * exists because those two were once displayed identically.
 *
 * The asymmetry is real and is not an accident of naming:
 *
 * - A CV run has NO test split at all (it never made one — `cv_folds.json`
 *   describes the configuration). Its `predictionsKey` is therefore written
 *   ONLY by the scoring phase, and what it holds is the HOLDOUT series
 *   (MODEL-FLOW-016-T07, unchanged by this task).
 * - A non-CV run's `predictionsKey` is written at training `complete()` time
 *   and holds its TEST split. Its holdout series lives in
 *   `holdoutPredictionsKey` — a separate column precisely so nothing can
 *   overwrite the test split.
 *
 * MODEL-FLOW-019-T26 changed WHEN that second column is populated, and
 * nothing else here. It was once "only if a user triggered scoring"; a
 * non-CV run now writes its holdout series inline at training time, so the
 * column is populated at `complete()` alongside `predictionsKey`. Scoring
 * remains the backfill path for the 252 runs trained before that landed, so
 * null is still a common and legitimate answer below — a caller must keep
 * stating WHY a series is absent rather than assuming a fresh run.
 *
 * So `predictionsKey` alone answers neither question; `cvFoldsKey` is what
 * disambiguates it, and every reader must go through here rather than
 * re-deriving that from a column name that means two different things.
 */

/** The two populations a run can have a per-row series for. Mirrors the
 *  client's `EvaluationPopulation` (`lib/metric-source.ts`) — a fold
 *  ESTIMATE is not a series and so is not a member here either. */
export type PredictionPopulation = 'test' | 'holdout';

/** The three columns this derivation reads. Named structurally rather than
 *  as the Prisma row type so a test fixture satisfies it without a cast. */
export interface RunPredictionKeys {
  cvFoldsKey: string | null;
  predictionsKey: string | null;
  holdoutPredictionsKey: string | null;
}

/**
 * The object key holding `population`'s series for this run, or null when
 * the run has no such series.
 *
 * Null is a legitimate, common answer and never an error: a CV run has no
 * test split, an unscored run has no holdout, and a still-training run has
 * neither. The caller states which of those it is (`holdoutAbsenceOf`'s own
 * three facts) — this function only resolves keys.
 */
export function predictionKeyFor(
  run: RunPredictionKeys,
  population: PredictionPopulation,
): string | null {
  const isCv = Boolean(run.cvFoldsKey);
  if (population === 'test') {
    // A CV run's predictionsKey is its HOLDOUT, so it must not be served as
    // a test split — that substitution is the exact conflation this feature
    // exists to prevent, and it would look entirely plausible on a chart.
    return isCv ? null : run.predictionsKey;
  }
  return isCv ? run.predictionsKey : run.holdoutPredictionsKey;
}
