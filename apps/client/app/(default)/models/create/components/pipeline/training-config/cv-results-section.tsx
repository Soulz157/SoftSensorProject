'use client'

import { useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { useCandidatePredictions } from '@/hooks/model/use-candidate-predictions'
import { useRunCvFolds } from '@/hooks/model/use-run-cv-folds'
import { sourcedMetricsOf, type CvFoldEstimate } from '@/lib/metric-source'
import { METRIC_META } from '@/lib/model-metrics'
import type { RankMetricKey } from '@/lib/metric-ranking'
import type {
  ModelTrainingRunListItem,
  RunCvFolds,
  RunPredictionsBatchItem,
} from '@/services/model-draft'
import { CvFoldTable } from '../evaluation/cv-fold-table'
import { CvOofChart } from './cv-oof-chart'

const SCORE_KEYS: RankMetricKey[] = ['r2', 'rmse', 'mae']

/** A CV run's fold aggregate, or undefined for any other run. */
export function cvEstimateOf(
  run: ModelTrainingRunListItem,
): CvFoldEstimate | undefined {
  return sourcedMetricsOf(run).find(
    (m): m is CvFoldEstimate => m.source === 'cv-fold-estimate',
  )
}

/** `mean ± std`, or an em dash when the mean was not recorded. */
export function formatCvScore(
  mean: number | null,
  std: number | null,
  format: (v: number) => string = v => v.toFixed(3),
): string {
  if (mean === null) return '—'
  return std !== null ? `${format(mean)} ± ${format(std)}` : format(mean)
}

interface Props {
  draftId: string
  /** A SUCCEEDED run with a `cvFoldsKey` — the caller decides that. */
  run: ModelTrainingRunListItem
}

/**
 * MODEL-FLOW-028-T05, moved INSIDE the run card by MODEL-FLOW-029-T03. One CV
 * run's own results: the mean ± std score across folds, the out-of-fold
 * Actual vs Predicted chart, and the per-fold table.
 *
 * Fetches for THIS run only, and only while mounted — the card mounts it
 * when expanded, so a list of collapsed cards fetches nothing. That also
 * keeps every request at one id, well under the predictions batch's
 * 24-id cap, which a single 20-variant CV search would otherwise exceed.
 *
 * EVERYTHING HERE DESCRIBES THE CONFIGURATION. Each fold's model predicted
 * rows it never trained on, but none of them is the refit that ships, and
 * none of these numbers is that model's own held-out score (MODEL-FLOW-016:
 * that comes only from the separate, user-triggered holdout scoring).
 */
export function CvRunSection({ draftId, run }: Props) {
  // Stable per run, so the prediction hook (which refetches on array
  // identity) fetches once.
  const runIds = useMemo(() => [run.id], [run.id])
  const predictions = useCandidatePredictions(draftId, runIds, 'cv-oof')
  const folds = useRunCvFolds(draftId, runIds)

  const estimate = cvEstimateOf(run)
  const cvFolds = folds.byRunId.get(run.id)
  const nSplits = cvFolds?.n_splits ?? estimate?.nSplits ?? null

  return (
    <section className="space-y-3 border-t border-border/60 pt-3">
      <div className="space-y-0.5">
        <h4 className="text-xs font-medium text-foreground">
          Cross-validation{nSplits !== null ? ` — ${nSplits} folds` : ''}
        </h4>
        <p className="text-[11px] text-muted-foreground">
          Each fold&apos;s model predicts rows it never trained on. These
          describe the configuration — not the refit that gets saved.
        </p>
      </div>

      {estimate ? (
        <div className="grid grid-cols-3 gap-2">
          {SCORE_KEYS.map(key => (
            <div
              key={key}
              className="rounded-lg border border-border/60 px-3 py-2"
            >
              <p className="text-[10px] text-muted-foreground">
                {METRIC_META[key].label}
              </p>
              <p className="font-mono text-sm tabular-nums text-foreground">
                {formatCvScore(estimate.mean[key], estimate.std[key])}
              </p>
              <p className="text-[9px] text-muted-foreground">
                mean ± std across folds
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          This run recorded no cross-validation scores.
        </p>
      )}

      <OofPanel
        item={predictions.byRunId.get(run.id)}
        loading={predictions.loading || folds.loading}
        failed={predictions.error !== null}
        cvFolds={cvFolds}
      />

      {cvFolds ? (
        <CvFoldTable cvFolds={cvFolds} />
      ) : (
        !folds.loading && (
          <p className="text-[11px] text-muted-foreground">
            Per-fold figures could not be read for this run.
          </p>
        )
      )}
    </section>
  )
}

function OofPanel({
  item,
  loading,
  failed,
  cvFolds,
}: {
  item: RunPredictionsBatchItem | undefined
  loading: boolean
  failed: boolean
  cvFolds: RunCvFolds | null | undefined
}) {
  if (loading) {
    return (
      <div className="flex h-24 items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    )
  }
  if (failed) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Could not load the out-of-fold predictions.
      </p>
    )
  }
  // A CV run's out-of-fold key always resolves; the object exists only if the
  // trainer that ran it wrote one (image 1.0.21+). Older runs have none.
  if (!item || item.error || item.points.length === 0) {
    return (
      <p
        className="text-[11px] text-muted-foreground"
        title={item?.error ?? undefined}
      >
        No out-of-fold predictions are stored for this run — runs trained before
        they were saved have none. Retrain to see this chart.
      </p>
    )
  }
  if (!cvFolds) {
    return (
      <p className="text-[11px] text-muted-foreground">
        The fold boundaries could not be read, so the chart cannot be drawn by
        fold.
      </p>
    )
  }
  return <CvOofChart item={item} folds={cvFolds.folds} />
}
