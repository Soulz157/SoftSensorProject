'use client'

import { useMemo, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ChartLegend, type LegendEntry } from '@/components/charts/chart-legend'
import { useRetrainPredictions } from '@/hooks/model/use-retrain-predictions'
import { pickTimeFormat } from '@/lib/monitoring'
import { describeEvalBasis } from '@/lib/retrain-basis'
import {
  CURRENT_VERSION_COLOR,
  type RetrainChartDataSet,
} from '@/lib/retrain-series'
import type { RetrainComparison } from '@/services/model-retrain'
import {
  ACTUAL_COLOR,
  ActualVsPredictedChart,
  PREDICT_COLOR,
  SD_BAND_COLOR,
  SD_BAND_OPACITY,
} from '@/app/(default)/models/create/components/pipeline/evaluation/actual-vs-predicted-chart'
import {
  RESIDUAL_COLOR,
  RESIDUAL_LEGEND,
  ResidualChart,
} from '@/app/(default)/models/create/components/pipeline/evaluation/residual-chart'
import { BasisLabEvents } from './basis-lab-events'

const TOGGLE_ITEM =
  'h-8 cursor-pointer rounded-md border border-border px-3 text-xs font-medium data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-primary'

/**
 * MODEL-SERVE-020-T05. Sections 3 and 4 of the Retrain tab: Actual vs
 * Predicted, then Residuals, for the new version — with the current version
 * overlaid on the rows both were scored on.
 *
 * One selector drives both charts, so they always show the same data:
 *  - the current version's test data (the new version is scored on the same
 *    rows, and the current version can be drawn beside it);
 *  - the new data the operator set aside (only the new version was ever
 *    scored on it, so it is drawn alone).
 * The second option is disabled — with its reason on screen — when this
 * retrain set nothing aside, rather than left as a dead choice.
 *
 * Both charts are the wizard's own evaluation charts, reused rather than
 * rebuilt. Their ±3 SD band uses the destructive colour token as a chart
 * series, exactly as it does in the wizard; that is the charts' existing
 * design, not a status colour, and is left as-is.
 *
 * The RMSE delta in section 1 is untouched by any of this: it is still
 * refused when the two versions' rows differ (MODEL-SERVE-019-D03). The
 * overlay is a picture on the rows they share, not a claim about that delta.
 */
export function RetrainCharts({
  modelId,
  comparison,
  currentVersion,
}: {
  modelId: string
  comparison: RetrainComparison
  currentVersion: number | null
}) {
  const { candidate, incumbent, basis } = comparison
  // MODEL-SERVE-021. NEW_DATA_ONLY carves no frozen slice of the current
  // version's own test rows any more — "Current v{n}'s test data" has
  // nothing behind it for this strategy (see the toggle's own `disabled`
  // below), so the chart opens on the one view that does: the shared
  // validation window.
  const [dataSet, setDataSet] = useState<RetrainChartDataSet>(
    basis.strategy === 'NEW_DATA_ONLY' ? 'NEW_DATA' : 'CURRENT_TEST',
  )

  const newLabel =
    candidate.version !== null ? `New v${candidate.version}` : 'New version'
  const currentLabel =
    currentVersion !== null ? `Current v${currentVersion}` : 'Current version'
  const versionLabel = currentVersion !== null ? `v${currentVersion}` : null

  // A retrain that ingested new data was scored on the current version's own
  // test slice (`holdout`); a legacy Keep Existing retrain shares that
  // version's split outright, so its own `test` series is the same rows.
  // MODEL-SERVE-021: NOT true for NEW_DATA_ONLY any more — it never carves
  // that slice — so this stays AUGMENT_DATA/KEEP_EXISTING's own rule.
  const ingestsNewData = basis.strategy === 'AUGMENT_DATA'
  const hasNewDataWindow = candidate.newDataHoldoutRowCount !== null

  const { status, series, error, overlayError } = useRetrainPredictions({
    modelId,
    candidateRunId: candidate.runId,
    candidatePopulation: ingestsNewData ? 'holdout' : 'test',
    currentRunId: incumbent.sourceRunId,
    currentLabel,
    dataSet,
    enabled: candidate.runId !== null,
    attemptNewDataOverlay: basis.strategy === 'NEW_DATA_ONLY',
  })

  const tickFormatter = useMemo(() => {
    const first = series?.rows[0]
    const last = series?.rows[series.rows.length - 1]
    return pickTimeFormat(first && last ? last.t - first.t : 0)
  }, [series])

  const overlayDrawn = (series?.sharedRowCount ?? 0) > 0
  // MODEL-SERVE-021. For NEW_DATA_ONLY the real basis for the new-data view
  // lives on `candidate.metricsBasis` now (the headline figure for this
  // strategy) — `newDataHoldoutBasis` is deliberately null for it (see that
  // field's own comment in buildComparison), so falling back to it here
  // would show "Not recorded for this retrain" for a figure that IS
  // recorded.
  const dataSetBasis =
    dataSet === 'NEW_DATA'
      ? basis.strategy === 'NEW_DATA_ONLY'
        ? candidate.metricsBasis
        : candidate.newDataHoldoutBasis
      : candidate.metricsBasis

  const avpLegend: LegendEntry[] = [
    { shape: 'square', color: ACTUAL_COLOR, label: 'Actual' },
    { shape: 'dashed', color: PREDICT_COLOR, label: newLabel },
    ...(overlayDrawn
      ? [
          {
            shape: 'dashed' as const,
            color: CURRENT_VERSION_COLOR,
            label: currentLabel,
          },
        ]
      : []),
    {
      shape: 'square',
      color: SD_BAND_COLOR,
      opacity: SD_BAND_OPACITY,
      label: '±1 SD band',
    },
  ]
  const residualLegend: LegendEntry[] = [
    { shape: 'square', color: RESIDUAL_COLOR, label: `${newLabel} residual` },
    ...(overlayDrawn
      ? [
          {
            shape: 'dashed' as const,
            color: CURRENT_VERSION_COLOR,
            label: `${currentLabel} residual`,
          },
        ]
      : []),
    ...RESIDUAL_LEGEND.slice(1),
  ]

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          Data shown in the charts
        </p>
        <ToggleGroup
          type="single"
          value={dataSet}
          onValueChange={v => {
            if (v === 'CURRENT_TEST' || v === 'NEW_DATA') setDataSet(v)
          }}
          className="flex flex-wrap justify-start gap-1.5"
        >
          <ToggleGroupItem
            value="CURRENT_TEST"
            disabled={basis.strategy === 'NEW_DATA_ONLY'}
            className={TOGGLE_ITEM}
          >
            {currentVersion !== null
              ? `Current v${currentVersion}’s test data`
              : 'Current version’s test data'}
          </ToggleGroupItem>
          <ToggleGroupItem
            value="NEW_DATA"
            disabled={!hasNewDataWindow}
            className={TOGGLE_ITEM}
          >
            New data set aside
          </ToggleGroupItem>
        </ToggleGroup>
        {/* MODEL-SERVE-021. This strategy replaces the training data outright
            and carves no frozen slice of the current version's own test rows
            — there is nothing behind that view for it, so it stays disabled
            with a stated reason rather than a dead choice. */}
        {basis.strategy === 'NEW_DATA_ONLY' && (
          <p className="text-[10px] text-muted-foreground">
            This retrain replaced the training data, so there is no test data
            from the current version to show — the new data set aside is the
            comparison.
          </p>
        )}
        {!hasNewDataWindow && (
          <p className="text-[10px] text-muted-foreground">
            {candidate.newDataHoldoutBasis?.unavailableReason ??
              'No new data was set aside for this retrain.'}
          </p>
        )}
        {dataSetBasis && (
          <p className="text-[10px] text-muted-foreground">
            {describeEvalBasis(dataSetBasis, versionLabel)}
            <BasisLabEvents
              basis={dataSetBasis}
              role="candidate"
              ids={{
                modelId,
                candidateRunId: candidate.runId,
                incumbentSourceRunId: incumbent.sourceRunId,
              }}
            />
          </p>
        )}
      </div>

      {status === 'loading' && <Skeleton className="h-[320px] w-full" />}

      {status === 'error' && (
        <p className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
          {error}
        </p>
      )}

      {status === 'ready' && series && series.rows.length === 0 && (
        <p className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
          There are no rows to plot for this data.
        </p>
      )}

      {status === 'ready' && series && series.rows.length > 0 && (
        <>
          <section className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground">
              Actual vs Predicted
            </p>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
              <ChartLegend items={avpLegend} />
            </div>
            <ActualVsPredictedChart
              rows={series.rows}
              tickFormatter={tickFormatter}
              compareName={overlayDrawn ? currentLabel : undefined}
            />
          </section>

          <section className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground">
              Residuals
            </p>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
              <ChartLegend items={residualLegend} />
            </div>
            <ResidualChart
              rows={series.rows}
              sd={series.sd}
              tickFormatter={tickFormatter}
              compareName={overlayDrawn ? currentLabel : undefined}
            />
          </section>

          {series.overlayNote && (
            <p className="text-[10px] text-muted-foreground">
              {series.overlayNote}
            </p>
          )}
          {overlayError && (
            <p className="text-[10px] text-muted-foreground">
              {currentLabel} is not drawn: {overlayError}
            </p>
          )}
        </>
      )}
    </div>
  )
}
