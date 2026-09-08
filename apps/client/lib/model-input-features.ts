/**
 * Pure derivation for the Model detail Input Data tab — left-joins the
 * trained X feature list (`featureColumns`, predict-time order) against
 * live drift status and logged prediction values. No React, no IO,
 * matching the `lib/` convention of `model-config.ts`/`dataset-stats.ts`.
 */
import type { DriftReport, DriftStatus } from '@/services/model-monitoring'
import type { ArtifactScalingParams } from '@/services/dataset-version'
import type { LivePredictionPoint } from '@/hooks/model/use-prediction-monitoring'
import { inverseScale } from '@/lib/inverse-scale'

export interface InputFeatureRow {
  column: string
  driftStatus: DriftStatus
  driftReason?: string
  z: number | null
  outOfRangePct: number | null
  /** Engineering units when the scaler could be inverted; null otherwise —
   *  never a scaled 0–1 number presented as a measurement. */
  lastValue: number | null
  /** The raw logged (model-ready, scaled) value — always present when a
   *  point carried this column, regardless of whether it could be
   *  inverted. Shown as a secondary figure. */
  lastValueScaled: number | null
  /** ISO timestamp of the newest surviving point carrying this column;
   *  null when the column was never logged in range. */
  lastSeen: string | null
}

export interface BuildInputFeatureRowsInput {
  featureColumns: string[]
  /** The version this schema describes. Points logged by any OTHER
   *  version are excluded before joining — a range spanning a promote can
   *  return rows from a version whose own feature set legitimately
   *  differs, and joining those here would attribute another version's
   *  values to these rows. */
  versionId: string
  points: LivePredictionPoint[]
  drift: DriftReport | null
  scalingParams: Record<string, ArtifactScalingParams> | null
}

/** Builds one row per `featureColumns` entry, in that exact order — never
 *  re-sorted, since predict-time column order is meaningful. Every column
 *  in the list gets a row even when absent from both `drift` and every
 *  logged point (left join, never inner): `driftStatus` falls back to
 *  `UNKNOWN`, `lastValue`/`lastSeen` fall back to `null`. Nothing in
 *  `featureColumns` is ever dropped. */
export function buildInputFeatureRows({
  featureColumns,
  versionId,
  points,
  drift,
  scalingParams,
}: BuildInputFeatureRowsInput): InputFeatureRow[] {
  const driftByColumn = new Map(
    (drift?.columns ?? []).map(col => [col.column, col]),
  )

  const versionPoints = points.filter(p => p.modelVersionId === versionId)

  return featureColumns.map(column => {
    const driftCol = driftByColumn.get(column)

    let lastValueScaled: number | null = null
    let lastSeen: string | null = null
    // versionPoints is not assumed sorted; scan for the newest point that
    // actually carries this column, not simply the series' last point.
    for (const point of versionPoints) {
      if (!(column in point.features)) continue
      if (lastSeen === null || point.timestamp > lastSeen) {
        lastSeen = point.timestamp
        lastValueScaled = point.features[column]!
      }
    }

    const lastValue =
      lastValueScaled === null
        ? null
        : inverseScale(lastValueScaled, scalingParams?.[column])

    return {
      column,
      driftStatus: driftCol?.status ?? 'UNKNOWN',
      driftReason: driftCol?.reason,
      z: driftCol?.z ?? null,
      outOfRangePct: driftCol?.outOfRangePct ?? null,
      lastValue,
      lastValueScaled,
      lastSeen,
    }
  })
}
