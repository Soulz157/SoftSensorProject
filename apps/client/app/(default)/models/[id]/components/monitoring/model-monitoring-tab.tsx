'use client'

import { useCallback, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Activity } from 'lucide-react'
import type { AIModel } from '@/types'
import { useLiveError } from '@/hooks/model/use-live-error'
import { usePredictionMonitoring } from '@/hooks/model/use-prediction-monitoring'
import { useScheduledSeries } from '@/hooks/model/use-scheduled-series'
import type { TimeRange } from '@/lib/mock-readings'
import type { LiveErrorCoverage } from '@/services/inference-window'
import {
  buildMonitoringRows,
  formatLagDuration,
  applyHeldDeviationBand,
  applyHeldValue,
  heldDeviationStats,
  heldEvalPoints,
  mergeLivePredictions,
  mergeScheduledPredictions,
  residualDensityNote,
  windowStats,
  type BrushWindow,
} from '@/lib/monitoring'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ChartZoomControls } from '@/components/charts/chart-zoom-controls'
import { computeMetrics } from '@/lib/model-evaluation'
import { MonitoringRangeBar } from './monitoring-range-bar'
import { ActualVsPredictChart } from './actual-vs-predict-chart'
import {
  ResidualChart,
  SD1_COLOR,
  SD2_COLOR,
  SD3_COLOR,
  type ResidualMode,
} from './residual-chart'
import { LivePredictionChart } from './live-prediction-chart'
import { DriftPanel } from './drift-panel'
import { PsiPanel } from './psi/psi-panel'

/* MODEL-SERVE-009-T05. A local `RANGE_MS` used to live here so the held
 * series could be drawn over "exactly the window the data was fetched for".
 * It only ever APPROXIMATED that: it was multiplied by a `Date.now()` read
 * in the render body, a different instant from the one the request used.
 * `usePredictionMonitoring` now reports its real fetched window as
 * `seriesBounds`, which is the same intent actually delivered — so this
 * second copy of the spans is gone rather than left to drift from the one
 * the hooks request with. */

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
          : // MODEL-SERVE-008-T01. CHECKED BEFORE the truth-lag branch
            // below, because both show zero pairs and only one of them is
            // still a wait. These windows had their FULL lab window and the
            // lab reported nothing in them — the check already happened, so
            // naming a next one is a wrong answer about someone else's
            // system. Measured live: a once-a-day lab against an hourly
            // schedule leaves most windows here permanently, which is a
            // fact about the measurement rate, not a fault and not a delay.
            coverage.truthRows === 0 && (coverage.windowsLapsedTruth ?? 0) > 0
            ? `${coverage.windowsLapsedTruth} scored ${
                coverage.windowsLapsedTruth === 1 ? 'window' : 'windows'
              } passed ${
                coverage.truthLagMinutes
                  ? `their full ${formatLagDuration(coverage.truthLagMinutes)} lab window`
                  : 'their full lab window'
              } with no measurement reported. The lab reports far less often than this model scores, so most windows never get a pair — this is the measurement rate, not a failure.`
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
  /** MODEL-SERVE-011-T08. Bumped by the page when Run Predict lands, so a
   *  freshly scored live point is read without the user touching the range
   *  toggle. Defaults to 0 for every other caller. */
  refreshKey?: number
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
export function ModelMonitoringTab({ model, refreshKey = 0 }: Props) {
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
    targetHeld,
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
    seriesBounds,
    pointsLoading: livePointsLoading,
    livePredictEnabled,
    drift,
    driftLoading,
    driftUnavailableReason,
    psi,
    psiLoading,
    psiUnavailableReason,
  } = usePredictionMonitoring(model, range, refreshKey)

  /**
   * MODEL-SERVE-011-T12. The SCHEDULED plane, which `useLiveError` above
   * cannot show: it serves JOINED pairs, so every window whose lab target
   * has not reported is absent from it — nearly all of them on a
   * daily-sampled target. One point per window, from that window's own
   * metrics.json.
   */
  const { points: scheduledPoints, missing: scheduledMissing } =
    useScheduledSeries(model, range, refreshKey)

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

  // MODEL-SERVE-008-T04. The dense serving-plane series joins the SAME time
  // axis as the joined pairs but keeps its own key — two provenances on one
  // chart, never one series with holes. `rows` itself stays exactly the
  // MonitoringRow[] the Residual chart and windowStats read, so the SD-band
  // and residual math still see only ground-truth-paired points.
  const rowsWithLive = useMemo(() => {
    // The window the series was ACTUALLY fetched over, reported by the hook
    // that fetched it. This used to be `Date.now()` read right here, which
    // `react-hooks/purity` refuses — an impure read in the render body gives
    // a different answer on every incidental re-render, so the fallback axis
    // could drift away from the points drawn beside it. Null until the first
    // request settles, and `applyHeldValue` already treats a missing bounds
    // as "nothing to draw the constant against" rather than inventing one.
    const bounds = seriesBounds
    // MODEL-SERVE-011-T14. ORDER MATTERS, and getting it wrong was visible
    // on screen: the held "Actual" step must be drawn over the FINAL axis,
    // after every prediction series has contributed its timestamps.
    // Applying it inside `mergeLivePredictions` (as before) meant the
    // hourly rows added below carried no `held`, so Actual spanned only the
    // few minutes the live points occupied and never reached the hourly
    // predictions it exists to be compared against.
    const withLive = mergeLivePredictions(rows, livePoints)
    // Folded in at each window's own `windowStart`, on its own key — an
    // hour of predictions summarised by one number is not the same thing as
    // a joined pair's `predict` or a single instant's `live`.
    const withScheduled = mergeScheduledPredictions(withLive, scheduledPoints)
    const withHeld = applyHeldValue(
      withScheduled,
      targetHeld?.value ?? null,
      bounds,
    )
    return withHeld
  }, [rows, livePoints, targetHeld, seriesBounds, scheduledPoints])

  /**
   * MODEL-SERVE-011-T15/T16. ONE spread, shared by both charts: the band on
   * Actual-vs-Predict and the ±SD guardlines on Residual Analysis must be the
   * same number, or two views of one range disagree about how far the model
   * is sitting from the last reported value.
   *
   * It is NOT the residual SD — `stats.sd` stays that, computed from measured
   * pairs only — and it feeds no metric.
   */
  const heldSd = useMemo(
    () => heldDeviationStats(rowsWithLive).sd,
    [rowsWithLive],
  )

  const rowsWithBand = useMemo(
    // Rows carrying a REAL joined pair keep the residual band
    // `buildMonitoringRows` already gave them; this only fills rows that have
    // none, so the two never overwrite each other.
    () => applyHeldDeviationBand(rowsWithLive, heldSd),
    [rowsWithLive, heldSd],
  )

  /**
   * MODEL-SERVE-011-T22. The header's Live RMSE, computed from the held
   * actual when no lab pair exists — the same basis the band, the guardrails
   * and the Residual line already use.
   *
   * Through `computeMetrics`, the canonical client error math, NOT a fourth
   * RMSE formula. Only `rmse` is read from it: R² against a near-constant
   * held actual is degenerate (ssTot tends to 0) and would render a
   * confident number that means nothing.
   */
  const heldMetrics = useMemo(
    () => computeMetrics(heldEvalPoints(rowsWithBand)),
    [rowsWithBand],
  )
  const latest = useMemo(() => {
    let actual: { value: number; at: string } | null = null
    let predict: { value: number; at: string } | null = null

    for (let i = rowsWithBand.length - 1; i >= 0; i--) {
      const r = rowsWithBand[i]
      // `noUncheckedIndexedAccess` types an indexed read as possibly
      // undefined, and it is right to: nothing in the type system ties `i` to
      // this array's length. The index is in range by construction here, so
      // this guard never fires — but it is the narrowing the compiler needs,
      // and it costs one comparison per row. Deliberately not a `!` assertion:
      // that would silence the question rather than answer it, and this
      // codebase's own rule is to narrow rather than bypass.
      if (!r) continue
      if (
        !actual &&
        typeof r.actual === 'number' &&
        Number.isFinite(r.actual)
      ) {
        actual = { value: r.actual, at: r.timestamp }
      }
      if (!predict) {
        const p = [r.predict, r.scheduled, r.live].find(
          (v): v is number => typeof v === 'number' && Number.isFinite(v),
        )
        if (p !== undefined) predict = { value: p, at: r.timestamp }
      }
      if (actual && predict) break
    }

    const actualHeld = actual === null && targetHeld?.value != null
    if (actualHeld && targetHeld?.value != null) {
      actual = { value: targetHeld.value, at: targetHeld.lastMeasuredAt ?? '' }
    }
    return { actual, predict, actualHeld }
  }, [rowsWithBand, targetHeld])

  const tickFormatter = useMemo(() => {
    const first = visible[0]
    const last = visible[visible.length - 1]
    const spanMs =
      first && last
        ? Date.parse(last.timestamp) - Date.parse(first.timestamp)
        : 0
    // Axis ticks always carry day + month; under two days the ticks would
    // repeat one date, so the clock time is added.
    const pattern = spanMs > 2 * 24 * 60 * 60 * 1000 ? 'd MMM' : 'd MMM HH:mm'
    return (t: number) => format(t, pattern)
  }, [visible])

  // Tooltip keeps the full date-time whatever the zoom level.
  const tooltipFormatter = useCallback(
    (t: number) => format(t, 'd MMM yyyy HH:mm:ss'),
    [],
  )

  const yDomain = useMemo<[number, number]>(() => {
    // MODEL-SERVE-011-T19. EVERY SERIES THE CHART ACTUALLY DRAWS, read off
    // the rows it is actually handed.
    //
    // This used to read `actual`/`predict` out of `rows` — the JOINED pairs
    // alone — which had two consequences once the chart grew other series:
    // with no lab pair in range `values` was empty and the domain fell back
    // to [0, 1], putting lines that live around 110 completely off screen;
    // and even with pairs, the hourly `scheduled` series and the `held` step
    // could not influence the domain, so they could sit outside it.
    const values = rowsWithBand.flatMap(r =>
      [r.actual, r.predict, r.scheduled, r.held].filter(
        (v): v is number => typeof v === 'number' && Number.isFinite(v),
      ),
    )
    if (values.length === 0) return [0, 1]

    const lo = Math.min(...values)
    const hi = Math.max(...values)

    const effectiveSd = stats.sd > 0 ? stats.sd : heldSd
    const bandSpan = effectiveSd * 2
    const dataSpan = hi - lo
    const span = Math.max(dataSpan, bandSpan * 3)
    const pad = span * 0.12
    const mid = (lo + hi) / 2

    return [mid - span / 2 - pad, mid + span / 2 + pad]
  }, [rowsWithBand, stats.sd, heldSd])

  const changeRange = (r: TimeRange) => {
    setRange(r)
    setBrush({})
  }

  return (
    <div className="flex flex-col gap-5">
      <MonitoringRangeBar
        range={range}
        onRange={changeRange}
        rmse={
          liveMetrics?.rmse ?? (heldMetrics.n > 1 ? heldMetrics.rmse : null)
        }
        rmseBasis={liveMetrics?.rmse != null ? 'pairs' : 'held'}
        pairCount={liveMetrics?.n ?? heldMetrics.n}
        tag={tag}
      />

      {coverage && coverage.windowsInRange > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">
              {coverage.windowsJoined}
            </span>{' '}
            of {coverage.windowsInRange} windows joined
          </span>
          {targetHeld?.value != null && (
            <span>
              actual {targetHeld.value.toFixed(2)}
              {targetHeld.lastMeasuredAt
                ? ` · measured ${format(new Date(targetHeld.lastMeasuredAt), 'MMM d, HH:mm')}`
                : ''}
              {targetHeld.heldForMinutes != null &&
              targetHeld.heldForMinutes > 0
                ? ` · unchanged ${formatLagDuration(Math.round(targetHeld.heldForMinutes))}`
                : ''}
            </span>
          )}
          <span>
            <span className="font-medium text-foreground">
              {coverage.predictionRows ?? 0}
            </span>{' '}
            predictions / {coverage.truthRows} lab samples /{' '}
            {coverage.pairedRows} paired
          </span>
          {coverage.cadenceMinutes && coverage.truthLagMinutes && (
            <span>
              scores every {formatLagDuration(coverage.cadenceMinutes)} · lab
              reports on its own schedule
            </span>
          )}
          {coverage.windowsAwaitingTruth - (coverage.windowsLapsedTruth ?? 0) >
            0 && (
            <span>
              {coverage.windowsAwaitingTruth -
                (coverage.windowsLapsedTruth ?? 0)}{' '}
              awaiting lab results
            </span>
          )}
          {(coverage.windowsLapsedTruth ?? 0) > 0 && (
            <span>{coverage.windowsLapsedTruth} with no lab report</span>
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
            <LegendItem color="var(--chart-1)" label="Actual" />
            <LegendItem color="var(--foreground)" label="Predict" />
            <LegendItem color={SD1_COLOR} label="±1 SD" />
          </div>
          <ChartZoomControls
            brush={brush}
            total={rowsWithBand.length}
            onChange={setBrush}
          />
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          Actual comes from the data source; Predict comes from the model. The
          shaded ±1 SD band around them is the monitoring threshold — a point
          drifting outside it is the signal to look at.
          {/* MODEL-SERVE-011-T18. The sentence above describes the band a
      JOINED range has. With no pairs the band is drawn from a
      different spread entirely, and leaving the original wording
      would have the caption describe a band that is not on screen. */}
          {points.length === 0 && heldSd > 0 && (
            <>
              {' '}
              No pair in this range, so the band is ±1 SD of the
              prediction&apos;s distance from the last measured value —
              consistency, not error.
            </>
          )}
        </p>

        {(latest.actual || latest.predict) && (
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {latest.actual && (
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-sm"
                  style={{ backgroundColor: 'var(--chart-1)' }}
                />
                Latest Actual{' '}
                <span className="font-medium tabular-nums text-foreground">
                  {latest.actual.value.toFixed(2)}
                </span>
                {latest.actual.at
                  ? ` · ${format(new Date(latest.actual.at), 'MMM d, HH:mm')}`
                  : ''}
                {/* Not a point in this window — labelled so the two readouts
            are not read as a live pair. */}
                {latest.actualHeld ? ' · last measured, no pair in range' : ''}
              </span>
            )}
            {latest.predict && (
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-sm"
                  style={{ backgroundColor: 'var(--foreground)' }}
                />
                Latest Predict{' '}
                <span className="font-medium tabular-nums text-foreground">
                  {latest.predict.value.toFixed(2)}
                </span>
                {` · ${format(new Date(latest.predict.at), 'MMM d, HH:mm')}`}
              </span>
            )}
          </div>
        )}
        {/* MODEL-SERVE-011-T12. A window whose metrics object no longer
            resolves is a GAP in the hourly series, and saying so is the
            difference between "the model did not run then" and "that
            window's summary could not be read" — two causes with opposite
            remedies. Silent below zero missing. */}
        {scheduledMissing > 0 && (
          <p className="mb-3 text-xs text-muted-foreground/70">
            {scheduledMissing} scheduled window
            {scheduledMissing === 1 ? '' : 's'} in this range could not be read,
            so the hourly Predict series has{' '}
            {scheduledMissing === 1 ? 'a gap' : 'gaps'}.
          </p>
        )}

        <div className="max-h-full flex-1">
          {truthLoading ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : rowsWithLive.length === 0 ? (
            // MODEL-SERVE-009-T05. GATED ON WHAT THIS CHART CAN ACTUALLY
            // DRAW, not on joined pairs alone. This chart carries three
            // series now — the sparse joined actual, the dense serving-plane
            // prediction, and the target's last reported value — and only
            // the FIRST needs a pair. Gating on `points` meant a model with
            // live predictions and a known lab value still rendered
            // "no lab measurement has arrived", which is true about pairs
            // and false about the screen: there was plenty to show.
            //
            // The Residual chart below keeps the `points` gate, because a
            // residual genuinely cannot exist without a measured actual —
            // that is the limit MODEL-SERVE-008-T05's own sentence states.
            <EmptyTruth error={truthError} coverage={coverage} />
          ) : (
            <ActualVsPredictChart
              rows={rowsWithBand}
              brush={brush}
              tickFormatter={tickFormatter}
              tooltipFormatter={tooltipFormatter}
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
            {/* MODEL-SERVE-011-T11. The SAME identity mapping the chart
                above now uses (Actual = chart-1, Predict = foreground).
                These two entries had kept the pre-swap colours, so the two
                sections of one tab named the same two series in opposite
                colours. */}
            <LegendItem color="var(--chart-1)" label="Actual" />
            <LegendItem color="var(--foreground)" label="Predict" />
            {/* MODEL-SERVE-011-T16. Bound to the chart's OWN exported
                colours, so the legend cannot name a colour the chart does
                not draw. */}
            <LegendItem color={SD1_COLOR} label="±1 SD" />
            <LegendItem color={SD2_COLOR} label="±2 SD" />
            <LegendItem color={SD3_COLOR} label="±3 SD" />
          </div>
          {/* MODEL-SERVE-011-T20. This section lost its only zoom affordance
              when the Brush was removed. The control writes the SAME `brush`
              state the chart above uses — the two charts already share a
              recharts `syncId`, so one window over both is the existing
              behaviour, now with a second place to drive it from. */}
          <ChartZoomControls
            brush={brush}
            total={rowsWithBand.length}
            onChange={setBrush}
          />
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
        {/* MODEL-SERVE-008-T05, the unconditional half. A residual is
            predicted − actual (lib/live-error.ts, matching
            lib/model-evaluation.ts's sign convention), so it cannot exist
            without a MEASURED actual and this chart can never be denser
            than the lab — no cadence, driver or refresh rate changes that.
            Stated ALWAYS, not only when empty: when the chart does hold
            points the same limit explains why there are so few of them,
            and the waiting message the empty branch shows otherwise reads
            as a gap someone forgot to close.

            An uncertainty view (the predicted series against the model's
            own recorded error band) is deliberately NOT here — it answers
            "how wrong is this model usually", not "how wrong is it now",
            and putting that band on a chart titled Residual Analysis is
            the one-name-two-metrics defect MODEL-SERVE-001-T16 refused for
            PSI-in-the-z-score-table. It stays blocked on openDecisions[1]
            and, if adopted, gets its own title. */}
        <p className="mb-3 text-xs text-muted-foreground">
          {residualDensityNote(coverage?.cadenceMinutes ?? null)}
          {/* MODEL-SERVE-009-T05 follow-up. Shortened, but the two facts that
      stop a dashed line being read as the solid one stay: WHICH
      quantity is drawn, and WHEN its reference value was measured. */}
          {points.length === 0 && targetHeld?.value != null && (
            <>
              {' '}
              No pair in range — the line is Predict minus the last measured
              value
              {targetHeld.lastMeasuredAt
                ? ` (${targetHeld.value.toFixed(2)}, ${format(new Date(targetHeld.lastMeasuredAt), 'MMM d, HH:mm')})`
                : ` (${targetHeld.value.toFixed(2)})`}
              : a deviation, not a residual. Excluded from RMSE and R², and the
              ±SD guardrails here are the spread of these deviations.
            </>
          )}
        </p>
        <div className="min-h-0 flex-1">
          {truthLoading ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : rowsWithLive.length === 0 ? (
            // MODEL-SERVE-009-T05 follow-up. Was gated on joined `points`,
            // so with no lab pair the card showed the waiting message even
            // when a prediction and a last-known lab value both existed.
            // A MEASURED residual still requires a pair — that limit is
            // real and the sentence below still states it — but "deviation
            // from the last lab measurement" is computable without one, so
            // the card now renders whenever there is something to draw.
            <EmptyTruth error={truthError} coverage={coverage} />
          ) : (
            <ResidualChart
              rows={rowsWithBand}
              brush={brush}
              tickFormatter={tickFormatter}
              tooltipFormatter={tooltipFormatter}
              // MODEL-SERVE-011-T16. The guardlines had nothing to draw with
              // before the lab joins: `stats.sd` is the residual SD, which is
              // 0 until there are at least two measured pairs. Fall back to
              // the SAME held-deviation spread the Actual-vs-Predict band
              // uses, and say which basis is on screen rather than leaving
              // two different meanings behind one identical picture.
              sd={stats.sd > 0 ? stats.sd : heldSd}
              sdBasis={stats.sd > 0 ? 'residual' : 'held'}
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
          {/* MODEL-SERVE-008-T06. The caption states WHO writes this
              stream, because that changed: until T02's driver, only an
              external caller did, and MODEL-SERVE-001-T10 Part A's copy was
              written on that basis. The planes still do not merge — a
              window's predictions.parquet and a /predict row remain
              different artifacts, and nothing pools them into one feed. */}
          <p className="text-xs text-muted-foreground">
            The synchronous /predict stream, sampled
            {livePredictEnabled
              ? ' — fed by this model’s live prediction driver'
              : ''}
            . No lab counterpart is joined to these — ground truth is joined to
            scheduled windows, which is what the two charts above show.
          </p>
        </div>
        {livePointsLoading ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : (
          <LivePredictionChart
            points={livePoints}
            livePredictEnabled={livePredictEnabled}
          />
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
            Population Stability Index (PSI)
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
