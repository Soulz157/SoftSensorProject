'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { CalendarDateTimePicker } from '@/components/calendar-date-time-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useModelEvaluation } from '@/hooks/use-model-backfill'
import { utcToStamp } from '@/lib/backfill-compare'
import type { AIModel } from '@/types'
import { LabEditor } from './lab-editor'
import { WriteBackCard } from './write-back-card'
import { WriteHistoryCard } from './write-history-card'
import { EvaluationMetrics } from './backfill-metrics'
import { EvaluationChart } from './backfill-chart'
import { EvaluationXPanel } from './backfill-x-panel'

/** Minimum aligned pairs before error metrics are meaningful. */
const MIN_PAIRS = 2

/**
 * MODEL-SERVE-032. Production Evaluation: import a range from the model's
 * data source, score it with the PRODUCTION version, and compare against the
 * raw recorded lab values. Keyed by model id so a model switch starts clean.
 */
export function ModelEvaluation({ model }: { model: AIModel }) {
  return <EvaluationBody key={model.id} model={model} />
}

const fmtCount = (n: number) => n.toLocaleString()

function EvaluationBody({ model }: { model: AIModel }) {
  const ev = useModelEvaluation(model)
  const { data } = ev
  // The newest pickable minute, fixed at mount: a picker bound that moves
  // under the user while they pick would grey out the day they just chose.
  const [maxStamp] = useState(() => utcToStamp(Date.now()))
  const [historyKey, setHistoryKey] = useState(0)

  const hasPairs = ev.pairs.length >= MIN_PAIRS

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-foreground">
          Predictions vs Laboratory Data
        </h2>
        <p className="text-sm text-muted-foreground">
          Import a range from {model.name}&apos;s data source and compare what
          the model predicts now with what the lab measured.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="eval-from" className="text-xs">
            From
          </Label>
          <CalendarDateTimePicker
            id="eval-from"
            label="Import range start"
            value={ev.from}
            onChange={ev.setFrom}
            dataBounds={null}
            allowed={{ max: ev.to || maxStamp }}
            defaultTime="00:00"
            invalid={ev.rangeError !== null}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="eval-to" className="text-xs">
            To
          </Label>
          <CalendarDateTimePicker
            id="eval-to"
            label="Import range end"
            value={ev.to}
            onChange={ev.setTo}
            dataBounds={null}
            allowed={{ min: ev.from || undefined, max: maxStamp }}
            defaultTime="23:59"
            invalid={ev.rangeError !== null}
          />
        </div>
        <Button
          className="h-8 gap-2"
          onClick={() => void ev.importRange()}
          disabled={ev.loading || ev.rangeError !== null}
        >
          {ev.loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {ev.loading ? 'Importing…' : 'Import from data source'}
        </Button>
      </div>
      <p className="-mt-3 text-[11px] text-muted-foreground">
        Times are plant time (UTC+7).
      </p>
      {ev.rangeError && (
        <p className="-mt-3 text-[11px] text-destructive">{ev.rangeError}</p>
      )}
      {ev.error && (
        <p role="alert" className="text-sm text-destructive">
          {ev.error}
        </p>
      )}

      {ev.loading && !data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-96 rounded-lg" />
        </div>
      ) : !data ? (
        <Card className="border-dashed border-border bg-card">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Pick a range and choose “Import from data source” to chart the model
            against the lab.
          </CardContent>
        </Card>
      ) : (
        <div className={ev.loading ? 'space-y-5 opacity-60' : 'space-y-5'}>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="font-mono">
              {data.targetTag}
            </Badge>
            <Badge variant="outline">Version {data.version} · PRODUCTION</Badge>
            <span>
              {fmtCount(data.counts.rows)} rows at {data.interval} ·{' '}
              {fmtCount(data.counts.scored)} scored
              {data.counts.skipped > 0 &&
                ` · ${fmtCount(data.counts.skipped)} not scored (an input was not Good)`}
            </span>
          </div>

          {data.lab.error && (
            <p className="text-sm text-muted-foreground">{data.lab.error}</p>
          )}
          {data.lab.truncated && (
            <p className="text-sm text-muted-foreground">
              The lab tag holds more events than were read; narrow the range to
              see them all.
            </p>
          )}

          {hasPairs ? (
            <EvaluationMetrics metrics={ev.metrics} />
          ) : (
            <Card className="border-dashed border-border bg-card">
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                {ev.labPoints.length === 0
                  ? 'No lab values in this range. Add lab points below to compare.'
                  : `Need at least ${MIN_PAIRS} lab values close to a prediction (within ${data.toleranceMinutes} min) to score the model.`}
              </CardContent>
            </Card>
          )}

          <Card className="border-border bg-card">
            <CardContent className="pt-5">
              <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block h-0 w-5 border-t-2 border-dashed border-foreground"
                  />
                  Predicted
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 rounded-full bg-chart-1"
                  />
                  Lab (actual) · {ev.pairs.length} paired
                </span>
              </div>
              <EvaluationChart rows={ev.rows} />
            </CardContent>
          </Card>

          <LabEditor
            rows={ev.labRows}
            changes={ev.labChanges}
            pairedCount={ev.pairs.length}
            rangeFrom={ev.from}
            rangeTo={ev.to}
            onAdd={ev.addLab}
            onEdit={ev.editLab}
            onRemove={ev.removeLab}
            onRestore={ev.restoreLab}
            onCsv={ev.importLabCsv}
            onReset={ev.resetLab}
          />

          <EvaluationXPanel data={data} />
        </div>
      )}

      <WriteBackCard
        modelId={model.id}
        data={data}
        labRows={ev.labRows}
        onWritten={() => setHistoryKey(k => k + 1)}
      />

      <WriteHistoryCard modelId={model.id} refreshKey={historyKey} />
    </div>
  )
}
