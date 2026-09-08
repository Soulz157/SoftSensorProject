'use client'

import { useMemo, useState } from 'react'
import { Database } from 'lucide-react'
import type { AIModel } from '@/types'
import { usePredictionMonitoring } from '@/hooks/model/use-prediction-monitoring'
import { useModelInputSchema } from '@/hooks/model/use-model-input-schema'
import { readModelConfig, configTargets } from '@/lib/model-config'
import { buildInputFeatureRows } from '@/lib/model-input-features'
import type { TimeRange } from '@/lib/mock-readings'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { TimeRangeToggle } from './monitoring/time-range-toggle'
import { TargetSummary } from './input-data/target-summary'
import { InputFeatureTable } from './input-data/input-feature-table'

interface Props {
  model: AIModel
}

/**
 * The trained X feature list (`featureColumns`, from `GET
 * .../input-schema`) plus the Y target, each X row carrying a live drift
 * status, its last logged value, and when it was last seen.
 *
 * This used to read ONLY `points[].features` off the single most recent
 * `/predict` request (see git history) — a model with no served traffic
 * showed nothing at all, and the list was whatever one request happened to
 * carry rather than the model's real input schema. `featureColumns` (the
 * ordered, authoritative X list) was believed unreachable from the browser
 * JWT because it lived behind `ServingTokenGuard` — that is no longer true:
 * `useModelInputSchema` reads it through a new `JwtAccessGuard` endpoint
 * (`ModelInputSchemaAuthorizedService`) that resolves the same
 * `run_manifest.json` the serving descriptor does, without that
 * descriptor's PRODUCTION-only requirement or its 422-on-legacy-manifest
 * failure — both wrong for a display read on a model that may not be
 * deployed yet.
 *
 * `usePredictionMonitoring`'s `drift`/`points` are still the traffic side:
 * they answer "is this feature's live input healthy" and "what was its
 * last value", overlaid onto the schema's authoritative column list by
 * `buildInputFeatureRows` — a left join, so a column with no traffic still
 * renders (status UNKNOWN, value/seen em-dash) instead of disappearing.
 */
export function InputDataTab({ model }: Props) {
  const [range, setRange] = useState<TimeRange>('24h')
  const { points, pointsLoading, pointsTruncated, drift } =
    usePredictionMonitoring(model, range)
  const {
    schema,
    loading: schemaLoading,
    error: schemaError,
  } = useModelInputSchema(model.id)

  const configuredTargets = useMemo(
    () => configTargets(readModelConfig(model)),
    [model],
  )

  const rows = useMemo(() => {
    if (!schema?.featureColumns) return []
    return buildInputFeatureRows({
      featureColumns: schema.featureColumns,
      versionId: schema.versionId,
      points,
      drift,
      scalingParams: schema.scalingParams,
    })
  }, [schema, points, drift])

  const latest = points[points.length - 1] ?? null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {pointsLoading ? (
            'Loading sampled requests…'
          ) : latest ? (
            <>
              Logged {new Date(latest.timestamp).toLocaleString()} ·{' '}
              {points.length} sampled request{points.length === 1 ? '' : 's'} in
              range
              {pointsTruncated && ' · truncated'}
            </>
          ) : (
            'No sampled requests in range — status columns below show UNKNOWN'
          )}
        </div>
        <TimeRangeToggle range={range} onRange={setRange} />
      </div>

      {schema && (
        <TargetSummary
          targetY={schema.targetY}
          version={schema.version}
          stage={schema.stage}
          configuredTargets={configuredTargets}
        />
      )}

      <Card className="overflow-hidden border-border bg-card">
        {schemaLoading || (!schema && !schemaError) ? (
          // The second half of that condition covers the brief window
          // before `useDebouncedAbortableRequest`'s own timer fires (its
          // `loading` starts false) — without it, a model whose fetch has
          // not started yet reads as `!schema?.featureColumns` and flashes
          // "No recorded feature columns" before the real answer arrives.
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : schemaError ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <Database className="h-10 w-10 opacity-30" />
            <p className="text-base font-medium">Could not load input schema</p>
            <p className="text-sm">{schemaError}</p>
          </div>
        ) : !schema?.featureColumns ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <Database className="h-10 w-10 opacity-30" />
            <p className="text-base font-medium">No recorded feature columns</p>
            <p className="text-sm">
              {schema?.unavailableReason ??
                "This model's training run did not record its feature columns."}
            </p>
          </div>
        ) : (
          // `rows` is already the full `featureColumns` list at this point
          // — a left join, never conditioned on `points`/`drift` having
          // resolved — so the table renders immediately and its status
          // column fills in as drift/traffic loads, rather than blocking
          // the whole X list behind a second spinner.
          <InputFeatureTable rows={rows} />
        )}
      </Card>
    </div>
  )
}
