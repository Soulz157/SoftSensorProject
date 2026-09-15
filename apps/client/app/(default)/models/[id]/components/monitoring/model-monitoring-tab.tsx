'use client'

import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Activity } from 'lucide-react'
import type { AIModel } from '@/types'
import { useLiveError } from '@/hooks/model/use-live-error'
import { usePredictionMonitoring } from '@/hooks/model/use-prediction-monitoring'
import type { TimeRange } from '@/lib/mock-readings'
import type { LiveErrorCoverage } from '@/services/inference-window'
import {
  buildMonitoringRows,
  pickTimeFormat,
  windowStats,
  type BrushWindow,
} from '@/lib/monitoring'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ChartZoomControls } from '@/components/charts/chart-zoom-controls'
import { MonitoringRangeBar } from './monitoring-range-bar'
import { ActualVsPredictChart } from './actual-vs-predict-chart'
import { ResidualChart, type ResidualMode } from './residual-chart'
import { LivePredictionChart } from './live-prediction-chart'
import { DriftPanel } from './drift-panel'
import { PsiPanel } from './psi/psi-panel'

/** MODEL-SERVE-001-T18. `truthLagMinutes` is stored in minutes; every real
 *  schedule sets it to a round hour count (1440 = 24h, 60 = 1h, T03's own
 *  precedent), so a plain hour/minute split reads naturally without pulling
 *  in a duration-formatting library for one readout. */
function formatLagDuration(minutes: number): string {
  return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="h-2.5 w-2.5 rounded-sm"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  )
}

/**
 * MODEL-SERVE-005-T03. The honest no-data state, following the rule
 * `DriftPanel` already applies to its own no-PRODUCTION-version case: name
 * WHY there is nothing, rather than rendering an empty axis that reads as
 * a flat, healthy line.
 *
 * The three causes are genuinely different and a reader needs to know
 * which one they are looking at: the range has no scored windows at all,
 * the windows exist but the lab has not reported yet, or the read failed.
 */
// Exported for direct testing, same pattern as this folder's sibling
// components (LivePredictionChart, DriftPanel) — EmptyTruth itself has no
// consumer outside this file (models/[id]/page.tsx imports the default
// ModelMonitoringTab, never this helper directly), so the export exists
// purely so a test can render one of its four empty-cause branches without
// mounting the full tab's data hooks.
export function EmptyTruth({
  error,
  coverage,
}: {
  error: string | null
  coverage: LiveErrorCoverage | null
}) {
  const message = error
    ? `Could not load ground truth: ${error}`
    : // T11: CHECKED BEFORE the bare "no completed windows" branch below —
      // an all-SKIPPED range ran, fetched, and deliberately declined to
      // score (too few usable rows), which reads identically to "never ran
      // here" once windowsInRange (SUCCEEDED only) hits zero. A SKIPPED
      // window also writes no predictions.parquet, so this is the ONLY
      // place in range that can say which of the two zero states this is.
      coverage && coverage.windowsInRange === 0 && coverage.windowsSkipped > 0
      ? `${coverage.windowsSkipped} ${
          coverage.windowsSkipped === 1 ? 'window was' : 'windows were'
        } skipped in this range — too few usable rows to score, so no ` +
        'prediction was written. The system ran and declined, rather than failed.'
      : !coverage || coverage.windowsInRange === 0
        ? 'No completed inference windows in this range yet.'
        : // CHECKED BEFORE the "no lab measurement yet" branch, because both
          // states show zero pairs and only one of them is about the lab. A
          // window the sweeper could not ask about at all — an unresolvable
          // target, a deleted data source — must not be reported as a lab
          // that has not reported, which would be a confident wrong answer
          // about someone else's system.
          coverage.windowsFailed > 0 && coverage.truthRows === 0
          ? `The ground-truth join failed for ${coverage.windowsFailed} ${
              coverage.windowsFailed === 1 ? 'window' : 'windows'
            } in this range, so no measurement could be fetched. Check the model's data source and target.`
          : coverage.truthRows === 0
            ? // MODEL-SERVE-001-T18. "The join runs again once the truth lag
              // has passed" reads identically at minute 1 and hour 23 of
              // that wait. `earliestEligibleAt`/`truthLagMinutes` name the
              // concrete timing when they are present (a schedule exists
              // and at least one window is still awaiting); when either is
              // absent, the original sentence stands rather than printing a
              // wait that cannot be computed.
              coverage.earliestEligibleAt && coverage.truthLagMinutes
              ? `Windows have been scored, but no lab measurement has arrived for them yet. The lab has up to ${formatLagDuration(
                  coverage.truthLagMinutes,
                )} to report; the earliest scored window becomes eligible at ${format(
                  new Date(coverage.earliestEligibleAt),
                  'MMM d, HH:mm',
                )}.`
              : 'Windows have been scored, but no lab measurement has arrived for them yet. The join runs again once the configured truth lag has passed.'
            : 'Lab measurements arrived, but none fell within the configured tolerance of a scored prediction.'

  return (
    <div className="flex h-48 flex-col items-center justify-center gap-1 px-6 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      {!error && coverage && coverage.windowsInRange > 0 && (
        <p className="text-xs text-muted-foreground/70">
          Nothing is estimated here — this chart stays empty until a real
          measurement can be paired with a real prediction.
        </p>
      )}
    </div>
  )
}

interface Props {
  model: AIModel
}

/**
 * Monitoring tab on the Model detail page — moved from the standalone
 * `/models/monitoring` route (which carried its own model picker; `[id]`
 * already resolved the model, so that picker and its empty state are gone).
 *
 * ALL FOUR SECTIONS ARE REAL DATA as of MODEL-SERVE-005-T03. Actual vs.
 * Predict and Residual Analysis were simulated (`useMonitoringData`'s mock
 * lab layer) for as long as T03 was blocked and no ground truth existed
 * anywhere in this system; they now read the joined (lab sample -> nearest
 * prediction) pairs the truth sweep writes. Nothing here fabricates an
 * `actual`: a range with no joined lab result renders an empty state
 * saying so, never a plausible-looking line.
 *
 * The two charts therefore render SPARSELY — one point per lab measurement,
 * not one per scored interval — which is what a lab-sampled target honestly
 * looks like. Live Predictions beside them still shows the dense
 * prediction stream with no counterpart.
 */
export function ModelMonitoringTab({ model }: Props) {
  const [range, setRange] = useState<TimeRange>('24h')
  const [brush, setBrush] = useState<BrushWindow>({})
  const [residualMode, setResidualMode] = useState<ResidualMode>('abs')

  const {
    points,
    metrics: liveMetrics,
    mixedVersions,
    versions,
    targetColumn,
    coverage,
    loading: truthLoading,
    error: truthError,
  } = useLiveError(model, range)
  // The REAL target this model was scored against, resolved server-side
  // from the window's own pinned version — not a label chosen client-side.
  // Taken from the range rather than from `versions`, which holds only
  // groups that carry pairs: a model still waiting on its first lab sample
  // knows its target perfectly well and should keep showing it.
  const tag = targetColumn
  const {
    points: livePoints,
    pointsLoading: livePointsLoading,
    drift,
    driftLoading,
    driftUnavailableReason,
    psi,
    psiLoading,
    psiUnavailableReason,
  } = usePredictionMonitoring(model, range)

  const start = brush.startIndex ?? 0
  const end = brush.endIndex ?? Math.max(0, points.length - 1)
  const visible = useMemo(
    () => points.slice(start, end + 1),
    [points, start, end],
  )
  const stats = useMemo(() => windowStats(visible), [visible])

  const rows = useMemo(
    () => buildMonitoringRows(points, stats.sd),
    [points, stats.sd],
  )
  const tickFormatter = useMemo(() => {
    const first = visible[0]
    const last = visible[visible.length - 1]
    const spanMs =
      first && last
        ? Date.parse(last.timestamp) - Date.parse(first.timestamp)
        : 0
    return pickTimeFormat(spanMs)
  }, [visible])

  const yDomain = useMemo<[number, number]>(() => {
    const values = rows.flatMap(r =>
      [r.actual, r.predict].filter(
        (v): v is number => typeof v === 'number' && Number.isFinite(v),
      ),
    )
    if (values.length === 0) return [0, 1]

    const lo = Math.min(...values)
    const hi = Math.max(...values)

    // Guarantee the band is on screen even when actual and predict track each
    // other almost exactly — otherwise a very good model produces a
    // zero-height domain and nothing renders at all.
    const bandSpan = stats.sd * 2
    const dataSpan = hi - lo
    const span = Math.max(dataSpan, bandSpan * 3)
    const pad = span * 0.12
    const mid = (lo + hi) / 2

    return [mid - span / 2 - pad, mid + span / 2 + pad]
  }, [rows, stats.sd])

  const changeRange = (r: TimeRange) => {
    setRange(r)
    setBrush({})
  }

  return (
    <div className="flex flex-col gap-5">
      <MonitoringRangeBar
        range={range}
        onRange={changeRange}
        // The POOLED figure over every joined pair in the range, not the
        // visible-brush recompute — a KPI that changed when someone zoomed
        // would not be the model's error, it would be the zoom's.
        rmse={liveMetrics?.rmse ?? null}
        pairCount={liveMetrics?.n ?? null}
        tag={tag}
      />

      {/* MODEL-SERVE-005-T03. Coverage, beside the number rather than
          behind it: how much of the range actually has ground truth, and
          the WORST window's missing rate (never a mean — a mean hides the
          one window whose sensor stopped, which is the case
          MODEL-SERVE-006-T05 exists to make visible). */}
      {coverage && coverage.windowsInRange > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">
              {coverage.windowsJoined}
            </span>{' '}
            of {coverage.windowsInRange} windows joined
          </span>
          <span>
            {coverage.pairedRows} paired / {coverage.truthRows} lab samples
          </span>
          {coverage.windowsAwaitingTruth > 0 && (
            <span>{coverage.windowsAwaitingTruth} awaiting lab results</span>
          )}
          {/* A window the sweeper could not ask about is NOT a window
              waiting on the lab, and the two must not read as one number.
              Purple, the data-quality colour — red and amber stay reserved
              for deployment status (DESIGN_SYSTEM §5). */}
          {coverage.windowsFailed > 0 && (
            <span className="rounded bg-purple-500/15 px-1.5 py-0.5 font-medium text-purple-500">
              {coverage.windowsFailed} join
              {coverage.windowsFailed === 1 ? '' : 's'} failed
            </span>
          )}
          {coverage.maxMissingPct !== null && (
            <span>
              worst window missing {coverage.maxMissingPct.toFixed(2)}%
            </span>
          )}
          {mixedVersions && (
            <span className="rounded bg-purple-500/15 px-1.5 py-0.5 font-medium text-purple-500">
              {versions.length} versions in range — per-version error below
            </span>
          )}
        </div>
      )}
      {/* Top chart — Actual vs Predict */}
      <div className="flex min-h-0 flex-col rounded-xl border border-border bg-card p-4">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">
            Actual vs. Predict (3-Layer SD Guardrails)
          </h2>

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
            <LegendItem color="var(--foreground)" label="Actual" />
            <LegendItem color="var(--chart-1)" label="Predict" />
            <LegendItem color="var(--chart-2)" label="±1 SD" />
            {/* <LegendItem color="var(--chart-3)" label="±2 SD" />
            <LegendItem color="var(--destructive)" label="±3 SD" /> */}
          </div>
          <ChartZoomControls
            brush={brush}
            total={points.length}
            onChange={setBrush}
          />
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Each lab measurement against the prediction it landed nearest, joined
          on this model&apos;s configured tolerance — the shaded band is ±1 SD
          of the residual. Sparse by nature: one point per lab result, not one
          per scored interval.
        </p>

        <div className="max-h-full flex-1">
          {truthLoading ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : points.length === 0 ? (
            <EmptyTruth error={truthError} coverage={coverage} />
          ) : (
            <ActualVsPredictChart
              rows={rows}
              brush={brush}
              onBrush={setBrush}
              tickFormatter={tickFormatter}
              yDomain={yDomain}
            />
          )}
        </div>
      </div>
      <div className="flex min-h-70 flex-col rounded-xl border border-border bg-card p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Activity className="h-4 w-4 text-chart-5" />
            Residual Analysis (Actual − Predict)
          </h2>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
            <LegendItem color="var(--foreground)" label="Actual" />
            <LegendItem color="var(--chart-1)" label="Predict" />
            <LegendItem color="var(--chart-2)" label="±1 SD" />
            <LegendItem color="var(--chart-3)" label="±2 SD" />
            <LegendItem color="var(--destructive)" label="±3 SD" />
          </div>
          <ToggleGroup
            type="single"
            value={residualMode}
            onValueChange={v => v && setResidualMode(v as ResidualMode)}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="abs" className="px-3">
              Absolute
            </ToggleGroupItem>
            <ToggleGroupItem value="pct" className="px-3">
              Percent
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="min-h-0 flex-1">
          {truthLoading ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : points.length === 0 ? (
            <EmptyTruth error={truthError} coverage={coverage} />
          ) : (
            <ResidualChart
              rows={rows}
              brush={brush}
              onBrush={setBrush}
              tickFormatter={tickFormatter}
              sd={stats.sd}
              mode={residualMode}
            />
          )}
        </div>
      </div>

      {/* MODEL-SERVE-005-T01/T02. The sampled synchronous-/predict stream
          and the drift signal built on it. A DIFFERENT stream from the
          charts above, not a lesser one: these are per-request samples with
          no lab counterpart, where those are scheduled windows paired with
          a lab measurement. Neither fabricates an "actual". */}
      <div className="flex min-h-0 flex-col rounded-xl border border-border bg-card p-4">
        <div className="mb-4 space-y-1">
          <h2 className="text-sm font-semibold text-foreground">
            Live Predictions (sampled)
          </h2>
          <p className="text-xs text-muted-foreground">
            The synchronous /predict stream, sampled. No lab counterpart is
            joined to these — ground truth is joined to scheduled windows, which
            is what the two charts above show.
          </p>
        </div>
        {livePointsLoading ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : (
          <LivePredictionChart points={livePoints} />
        )}
      </div>

      <div className="flex min-h-0 flex-col rounded-xl border border-border bg-card p-4">
        <div className="mb-4 space-y-1">
          <h2 className="text-sm font-semibold text-foreground">
            Distribution Drift
          </h2>
          <p className="text-xs text-muted-foreground">
            Live inputs vs. the production version&apos;s own training
            distribution (column_stats.json).
          </p>
        </div>
        <DriftPanel
          report={drift}
          loading={driftLoading}
          unavailableReason={driftUnavailableReason}
        />
      </div>

      {/* MODEL-SERVE-001-T13/T16. A SEPARATE card from Distribution Drift
          above, per T13's own DISPLAY SPEC — never a column bolted onto
          that table (REJECTED there for mixing two different threshold
          vocabularies under one Status colour). Independent loading/empty
          state: this metric has its own sample floor the z-score above has
          no equivalent of, so the two can genuinely disagree on
          availability for the identical range. Pooled over the selected
          range and recomputed on load — not a scheduled rolling 24h job —
          so "Computed over" inside the card states the real window rather
          than a cadence word here that could go stale. */}
      <div className="flex min-h-0 flex-col rounded-xl border border-border bg-card p-4">
        <div className="mb-4 space-y-1">
          <h2 className="text-sm font-semibold text-foreground">
            Population Stability (PSI)
          </h2>
          <p className="text-xs text-muted-foreground">
            Live inputs vs. the production version&apos;s frozen training bins
            (feature_spec.json) — pooled over the selected range, recomputed on
            load.
          </p>
        </div>
        <PsiPanel
          report={psi}
          loading={psiLoading}
          unavailableReason={psiUnavailableReason}
        />
      </div>
    </div>
  )
}
