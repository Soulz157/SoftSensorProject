'use client'

import { useEffect, useState } from 'react'
import {
  buildRetrainSeries,
  type RetrainChartDataSet,
  type RetrainChartSeries,
} from '@/lib/retrain-series'
import { modelRunPredictionsService } from '@/services/model-retrain'

/**
 * MODEL-SERVE-020-T05. The per-row series behind the Retrain tab's Actual vs
 * Predicted and Residual charts, for the chosen data set.
 *
 *  - CURRENT_TEST: the new version's series on the current version's test data
 *    (`holdout`) plus the current version's own test series (`test`), overlaid
 *    on the rows both were scored on. The overlay is best-effort: if the
 *    current version's series cannot be read (a legacy run, a reclaimed
 *    artifact), the new version is still drawn and `overlayError` says why.
 *  - NEW_DATA: the new version's series on the data the operator set aside
 *    (`new_data_holdout`). For an AUGMENT_DATA retrain the current version was
 *    never scored on those rows, so there is no overlay to attempt. For a
 *    NEW_DATA_ONLY (replace) retrain (MODEL-SERVE-021) it WAS — scored inside
 *    this same candidate run, off its own `current_new_data_holdout` key —
 *    and `attemptNewDataOverlay` turns that fetch on. Best-effort, same shape
 *    as the CURRENT_TEST overlay below: a failure never costs the candidate's
 *    own series.
 *
 * A failed read is reported with the SERVER'S OWN message — the routes name
 * which population is missing and why — never a generic one, and never an
 * empty series the charts would draw as if it were data.
 *
 * State is keyed by the request, so `status` is DERIVED rather than reset in
 * an effect: switching data sets shows 'loading' immediately, and a slow
 * response for a superseded request can never be shown for the current one.
 */

export type RetrainPredictionsStatus = 'idle' | 'loading' | 'ready' | 'error'

interface Settled {
  key: string
  series: RetrainChartSeries | null
  error: string | null
  overlayError: string | null
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

export function useRetrainPredictions({
  modelId,
  candidateRunId,
  candidatePopulation,
  currentRunId,
  currentLabel,
  dataSet,
  enabled,
  attemptNewDataOverlay = false,
}: {
  modelId: string
  candidateRunId: string | null
  /** Which of the new version's series is scored on the current version's test
   *  data. A new-data retrain (`holdout`) is scored on the current version's
   *  own frozen test slice; a legacy Keep Existing retrain shares the current
   *  version's split outright, so its own `test` series is that data. */
  candidatePopulation: 'holdout' | 'test'
  currentRunId: string | null
  /** e.g. "Current v3" — named in the overlay note. */
  currentLabel: string
  dataSet: RetrainChartDataSet
  enabled: boolean
  /** MODEL-SERVE-021. True only for a NEW_DATA_ONLY retrain — the strategy
   *  whose candidate run can carry a `current_new_data_holdout` key at all.
   *  False (the default) keeps AUGMENT_DATA's NEW_DATA view exactly as it
   *  was: no overlay attempt, no `overlayError` ever surfaced there. */
  attemptNewDataOverlay?: boolean
}): {
  status: RetrainPredictionsStatus
  series: RetrainChartSeries | null
  error: string | null
  /** Why the current version could not be overlaid, when that read failed. */
  overlayError: string | null
} {
  const key =
    enabled && candidateRunId
      ? [
          modelId,
          dataSet,
          candidateRunId,
          candidatePopulation,
          currentRunId ?? '-',
          attemptNewDataOverlay ? '1' : '0',
        ].join('|')
      : null
  const [settled, setSettled] = useState<Settled | null>(null)

  useEffect(() => {
    if (!key || !candidateRunId) return
    let ignore = false

    void (async () => {
      const finish = (next: Omit<Settled, 'key'>) => {
        if (!ignore) setSettled({ key, ...next })
      }

      if (dataSet === 'NEW_DATA' && !attemptNewDataOverlay) {
        try {
          const res = await modelRunPredictionsService.get(
            modelId,
            candidateRunId,
            'new_data_holdout',
          )
          finish({
            series: buildRetrainSeries(res.data, null, currentLabel),
            error: null,
            overlayError: null,
          })
        } catch (err) {
          finish({
            series: null,
            error: messageOf(err, 'Could not load the new-data predictions.'),
            overlayError: null,
          })
        }
        return
      }

      // MODEL-SERVE-021. NEW_DATA_ONLY only: the current version's OWN series
      // on this SAME window, read off the CANDIDATE run's own
      // `current_new_data_holdout` key — never `currentRunId`, which this
      // scoring never touches (see `prepareNewDataOnlyComparison`'s own
      // comment). Best-effort, same shape as the CURRENT_TEST overlay below:
      // absent for lstm/gru or a soft-failed score, and that absence must
      // never cost the candidate's own new-data series.
      if (dataSet === 'NEW_DATA') {
        const [candidate, overlay] = await Promise.allSettled([
          modelRunPredictionsService.get(
            modelId,
            candidateRunId,
            'new_data_holdout',
          ),
          modelRunPredictionsService.get(
            modelId,
            candidateRunId,
            'current_new_data_holdout',
          ),
        ])

        if (candidate.status === 'rejected') {
          finish({
            series: null,
            error: messageOf(
              candidate.reason,
              'Could not load the new-data predictions.',
            ),
            overlayError: null,
          })
          return
        }
        finish({
          series: buildRetrainSeries(
            candidate.value.data,
            overlay.status === 'fulfilled' ? overlay.value.data : null,
            currentLabel,
          ),
          error: null,
          overlayError:
            overlay.status === 'rejected'
              ? messageOf(
                  overlay.reason,
                  `${currentLabel} predictions could not be loaded.`,
                )
              : null,
        })
        return
      }

      const [candidate, current] = await Promise.allSettled([
        modelRunPredictionsService.get(
          modelId,
          candidateRunId,
          candidatePopulation,
        ),
        currentRunId
          ? modelRunPredictionsService.get(modelId, currentRunId, 'test')
          : Promise.reject(
              new Error('The current version’s run is not recorded.'),
            ),
      ])

      if (candidate.status === 'rejected') {
        finish({
          series: null,
          error: messageOf(
            candidate.reason,
            'Could not load the new version’s predictions.',
          ),
          overlayError: null,
        })
        return
      }
      finish({
        series: buildRetrainSeries(
          candidate.value.data,
          current.status === 'fulfilled' ? current.value.data : null,
          currentLabel,
        ),
        error: null,
        overlayError:
          current.status === 'rejected'
            ? messageOf(
                current.reason,
                `${currentLabel} predictions could not be loaded.`,
              )
            : null,
      })
    })()

    return () => {
      ignore = true
    }
  }, [
    key,
    modelId,
    candidateRunId,
    candidatePopulation,
    currentRunId,
    currentLabel,
    dataSet,
  ])

  if (!key) {
    return { status: 'idle', series: null, error: null, overlayError: null }
  }
  if (!settled || settled.key !== key) {
    return { status: 'loading', series: null, error: null, overlayError: null }
  }
  return {
    status: settled.error ? 'error' : 'ready',
    series: settled.series,
    error: settled.error,
    overlayError: settled.overlayError,
  }
}
