import {
  computeDrift,
  poolFeatureStats,
  type ColumnAggregate,
  type ColumnBaselineMap,
  type ColumnDrift,
  type DriftThresholds,
} from './prediction-drift';
import {
  computePsi,
  poolHistograms,
  type ColumnPsi,
  type FeatureHistogram,
  type PsiReferenceMap,
  type PsiThresholds,
} from './prediction-psi';

/**
 * MODEL-SERVE-018. The TARGET tag's (y) own drift and PSI verdicts, computed
 * with the unchanged `computeDrift`/`computePsi` over a single-column pool.
 *
 * Deliberately a SEPARATE computation from the feature report, never a
 * column appended to it: the report-level `status` is a worst-of fold over
 * `columns`, and model health / the retrain suggestion read that fold. Target
 * drift is label/concept shift, display-only by the user's call
 * (MODEL-SERVE-018-D01), so it must not be able to raise either.
 *
 * `null` means "nothing to show": no target on the source run, or no window
 * in range carried a target aggregate with at least one Good sample.
 */
export function computeTargetDrift(
  targetColumn: string | null,
  rows: Array<ColumnAggregate | null>,
  baseline: ColumnBaselineMap,
  thresholds: DriftThresholds,
): ColumnDrift | null {
  if (!targetColumn) return null;
  const pooled = poolFeatureStats(
    rows
      .filter((r): r is ColumnAggregate => r !== null)
      .map((r) => ({ [targetColumn]: r })),
  );
  return computeDrift(pooled, baseline, thresholds).columns[0] ?? null;
}

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
