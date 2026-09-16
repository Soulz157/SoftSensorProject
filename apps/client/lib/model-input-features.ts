/**
 * Pure derivation for the Model detail Input Data tab — left-joins the
 * trained X feature list (`featureColumns`, predict-time order) against
 * live drift status and logged prediction values. No React, no IO,
 * matching the `lib/` convention of `model-config.ts`/`dataset-stats.ts`.
 *
 * T12: `points[].features` is the `/predict` request's own RAW values —
 * `apps/serving/services/prediction_log.py`'s `log_prediction` builds its
 * ingest body from `rows` (the caller-supplied request), never `scaled`;
 * `scaled` feeds only the row's `featureStats` aggregates. This file used
 * to `inverseScale()` these values as though they were a scaled artifact
 * column — corrupting every displayed reading by the scaler's own span
 * (e.g. FI001.PV min/max ~180/207: a real ~190 rendered as ~5,309). There
 * is nothing to invert here; the value already IS engineering units.
 */
import type {
  DriftReport,
  DriftStatus,
  ModelInputStatus,
  PiTagStatus,
} from '@/services/model-monitoring'
import type { LivePredictionPoint } from '@/hooks/model/use-prediction-monitoring'

export interface InputFeatureRow {
  column: string
  driftStatus: DriftStatus
  driftReason?: string
  z: number | null
  outOfRangePct: number | null
  /** MODEL-SERVE-001-T15. PI's OWN quality flag for this tag, read live —
   *  a different question from `driftStatus` ("has the distribution moved
   *  since training"), and the one this tab is actually for. `UNKNOWN`
   *  when PI said nothing about the tag or could not be reached; never
   *  assumed Good. */
  piStatus: PiTagStatus
  piReason?: string
  /** For a derived feature, which of its base tags are not Good. */
  failingSources?: string[]
  /** The logged request's own value for this column — already engineering
   *  units (see this file's own doc comment for why no inversion applies
   *  here). Null only when the column was never logged in range. */
  lastValueRaw: number | null
  /** ISO timestamp of the newest surviving point carrying this column;
   *  null when the column was never logged in range. */
  lastSeen: string | null
  /** T12. A derived (formula) feature's human-readable equation, e.g.
   *  "FIC204.PV/(FY107.CPV+...)" — null for a base tag, which has none.
   *  Names which SOURCE COLUMNS feed this feature; carries no verdict on
   *  any of them — no per-tag status exists on this stream at all. */
  equation: string | null
  /**
   * MODEL-SERVE-001-T29/T30. This tag has not moved across the schedule's
   * own `frozenWindows` consecutive windows — a THIRD question, distinct
   * from both neighbours: `driftStatus` asks "has the distribution moved
   * since training", `piStatus` asks "does PI call this value good", and a
   * frozen tag can read Good and un-drifted while the instrument is stuck.
   *
   * Computed server-side (apps/backend/src/lib/sensor-frozen.ts), already
   * excluding tags that were flat in TRAINING — a setpoint or a held-closed
   * valve is not a fault and must never be badged.
   *
   * False whenever the model has no schedule, no successful windows, or
   * monitoring has not been probed: absence of evidence is not flatness.
   */
  frozen: boolean
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
  /** MODEL-SERVE-001-T15. Same left-join role as `drift` above — a column
   *  absent from `piStatus.features` (PI unreachable, or a tag it said
   *  nothing about) still renders a row, `piStatus` falling back to
   *  `UNKNOWN`. */
  piStatus: ModelInputStatus | null
  /** T12. Keyed by feature name — only a `formula` feature has an entry
   *  (`ModelInputSchemaAuthorizedService.resolveFeatureSpec`'s own scope
   *  fence); a base tag or a non-formula derived kind is simply absent. */
  derivedFeatures: Array<{ name: string; display: string }> | null
  /**
   * MODEL-SERVE-001-T30. The frozen tag names from the model's own health
   * read, passed down as a PROP from the detail page rather than fetched
   * here — that page already holds the value (`useInferenceStatus`), so a
   * second read would be a duplicate request for data in scope.
   *
   * NOT available on the models LIST payload: `deriveDeployStatuses`
   * hardcodes `frozenColumns: []` because real detection needs a per-window
   * `featureStats` select plus a baseline read (see
   * apps/backend/src/lib/deploy-status.ts:318-346). Defaults to empty.
   */
  frozenColumns?: string[]
}

/** Builds one row per `featureColumns` entry, in that exact order — never
 *  re-sorted, since predict-time column order is meaningful. Every column
 *  in the list gets a row even when absent from `drift` and every logged
 *  point (left join, never inner): `driftStatus` falls back to `UNKNOWN`,
 *  `lastValueRaw`/`lastSeen` fall back to `null`. Nothing in
 *  `featureColumns` is ever dropped. */
export function buildInputFeatureRows({
  featureColumns,
  versionId,
  points,
  drift,
  piStatus,
  derivedFeatures,
  frozenColumns,
}: BuildInputFeatureRowsInput): InputFeatureRow[] {
  const driftByColumn = new Map(
    (drift?.columns ?? []).map(col => [col.column, col]),
  )
  const piByColumn = new Map((piStatus?.features ?? []).map(f => [f.column, f]))
  // A Set, not an includes() per row: the same left-join shape the two maps
  // above use, and O(1) per column rather than O(frozen) .
  const frozenSet = new Set(frozenColumns ?? [])
  const equationByColumn = new Map(
    (derivedFeatures ?? []).map(f => [f.name, f.display]),
  )

  const versionPoints = points.filter(p => p.modelVersionId === versionId)

  return featureColumns.map(column => {
    const driftCol = driftByColumn.get(column)
    const piCol = piByColumn.get(column)

    let lastValueRaw: number | null = null
    let lastSeen: string | null = null
    // versionPoints is not assumed sorted; scan for the newest point that
    // actually carries this column, not simply the series' last point.
    for (const point of versionPoints) {
      if (!(column in point.features)) continue
      if (lastSeen === null || point.timestamp > lastSeen) {
        lastSeen = point.timestamp
        lastValueRaw = point.features[column]!
      }
    }

    return {
      column,
      driftStatus: driftCol?.status ?? 'UNKNOWN',
      driftReason: driftCol?.reason,
      z: driftCol?.z ?? null,
      outOfRangePct: driftCol?.outOfRangePct ?? null,
      piStatus: piCol?.status ?? 'UNKNOWN',
      piReason: piCol?.reason,
      failingSources: piCol?.failingSources,
      lastValueRaw,
      lastSeen,
      equation: equationByColumn.get(column) ?? null,
      frozen: frozenSet.has(column),
    }
  })
}
