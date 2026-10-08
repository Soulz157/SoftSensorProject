'use client'

import { useLabEventCount } from '@/hooks/model/use-lab-event-count'
import { attributeChange } from '@/lib/retrain-attribution'
import type { LabEventSource } from '@/lib/retrain-lab-events'

const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(3)}`
const word = (v: number) =>
  v < 0 ? 'lowered' : v > 0 ? 'raised' : 'did not change'

/**
 * MODEL-SERVE-026-T06. Splits the change on the shared window into what the
 * new DATA did (current version -> its own settings refitted on the new data,
 * "B") and what the new SETTINGS did (B -> the picked candidate). Both at lab
 * events, by the same rule as the grid above, so the two parts add back to
 * the whole change shown there.
 */
export function RetrainAttribution({
  modelId,
  chosenRunId,
  currentSettingsRunId,
  currentVersion,
}: {
  modelId: string
  chosenRunId: string | null
  /** B's run, or null when the current settings were not refitted. */
  currentSettingsRunId: string | null
  currentVersion: number | null
}) {
  const current =
    currentVersion !== null ? `v${currentVersion}` : 'the current version'
  const series = (
    runId: string | null,
    population: 'new_data_holdout' | 'current_new_data_holdout',
  ): LabEventSource =>
    runId
      ? { kind: 'series', runId, population }
      : { kind: 'unavailable', reason: 'not run' }
  const a = useLabEventCount(
    modelId,
    series(chosenRunId, 'current_new_data_holdout'),
  )
  const b = useLabEventCount(
    modelId,
    series(currentSettingsRunId, 'new_data_holdout'),
  )
  const c = useLabEventCount(modelId, series(chosenRunId, 'new_data_holdout'))

  if (!currentSettingsRunId) {
    return (
      <p className="text-[10px] text-muted-foreground">
        Not split into data and settings: {current}&apos;s own settings were not
        refitted on the new data in this retrain, so a change cannot be
        attributed to one or the other.
      </p>
    )
  }
  const rmse = (s: typeof a) => (s.status === 'ready' ? s.atEvents.rmse : null)
  const { dataEffect, settingsEffect } = attributeChange(
    rmse(a),
    rmse(b),
    rmse(c),
  )
  if (dataEffect === null || settingsEffect === null) {
    const reason = [a, b, c].find(s => s.status === 'unavailable')
    return (
      <p className="text-[10px] text-muted-foreground">
        {reason && reason.status === 'unavailable'
          ? `Data/settings split unavailable (${reason.reason}).`
          : 'Splitting the change into data and settings…'}
      </p>
    )
  }
  return (
    <div className="space-y-1 rounded-md border border-border bg-muted/10 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        What made the difference, at lab events
      </p>
      <p className="text-xs text-foreground">
        The new data {word(dataEffect)} RMSE by{' '}
        <span className="font-medium tabular-nums">{signed(dataEffect)}</span> (
        {current}&apos;s own settings, refitted on it). The new settings{' '}
        {word(settingsEffect)} it by{' '}
        <span className="font-medium tabular-nums">
          {signed(settingsEffect)}
        </span>
        {chosenRunId === currentSettingsRunId
          ? ' — the picked version IS the current settings refitted.'
          : '.'}
      </p>
      <p className="text-[10px] text-muted-foreground">
        The two add up to the whole change against {current}. Each retrain
        spends one extra fit on {current}&apos;s own settings to make this split
        possible.
      </p>
    </div>
  )
}
