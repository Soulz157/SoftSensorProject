import {
  computePsi,
  poolHistograms,
  type ColumnPsi,
  type FeatureHistogram,
  type PsiReferenceMap,
  type PsiThresholds,
} from './prediction-psi';

/**
 * MODEL-SERVE-018. The TARGET tag's (y) own PSI verdict, computed with the
 * unchanged `computePsi` over a single-column pool. (MODEL-SERVE-028
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
export function computeTargetPsi(
  targetColumn: string | null,
  rows: Array<FeatureHistogram | null>,
  reference: PsiReferenceMap,
  thresholds: PsiThresholds,
): ColumnPsi | null {
  if (!targetColumn) return null;
  const pooled = poolHistograms(
    rows
      .filter((r): r is FeatureHistogram => r !== null)
      .map((r) => ({ [targetColumn]: r })),
  );
  return computePsi(pooled, reference, thresholds).columns[0] ?? null;
}
