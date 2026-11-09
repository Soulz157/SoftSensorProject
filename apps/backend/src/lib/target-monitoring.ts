import {
  computeRangeDrift,
  poolHistograms,
  type ColumnRangeDrift,
  type FeatureHistogram,
  type DriftReferenceMap,
  type DriftThresholds,
} from './input-range-drift';

/**
 * MODEL-SERVE-018. The TARGET tag's (y) own training-range verdict, computed with the
 * unchanged `computeRangeDrift` over a single-column pool. (MODEL-SERVE-028
 * removed its z-score twin, `computeTargetDrift`, with the rest of the
 * mean-shift drift signal.)
 *
 * Deliberately a SEPARATE computation from the feature report, never a
 * column appended to it: the report-level `status` is a worst-of fold over
 * `columns`, and model health / the retrain suggestion read that fold. Target
 * drift is label/concept shift, display-only by the user's call
 * (MODEL-SERVE-018-D01), so it must not be able to raise either.
 *
 * `null` means "nothing to show": no target on the source run, or no window
 * in range carried a target histogram.
 */
export function computeTargetDrift(
  targetColumn: string | null,
  rows: Array<FeatureHistogram | null>,
  reference: DriftReferenceMap,
  thresholds: DriftThresholds,
): ColumnRangeDrift | null {
  if (!targetColumn) return null;
  const pooled = poolHistograms(
    rows
      .filter((r): r is FeatureHistogram => r !== null)
      .map((r) => ({ [targetColumn]: r })),
  );
  return computeRangeDrift(pooled, reference, thresholds).columns[0] ?? null;
}
