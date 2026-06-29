'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TIME_RANGES, type TimeRange } from '@/lib/mock-readings'
import { useModelEvaluation } from '@/hooks/use-model-evaluation'
import type { AIModel } from '@/types'
import { LabDataIngestion } from './lab-data-ingestion'
import { EvaluationMetrics } from './evaluation-metrics'
import { EvaluationChart } from './evaluation-chart'
import { EvaluationAnalysis } from './evaluation-analysis'

/** Minimum aligned pairs before error metrics are meaningful. */
const MIN_PAIRS = 2

const RANGE_LABEL: Record<TimeRange, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '1m': 'Last 30 days',
  '1y': 'Last 12 months',
}

export function ModelEvaluation({ model }: { model: AIModel }) {
  const [range, setRange] = useState<TimeRange>('7d')
  const {
    preds,
    points,
    metrics,
    analysis,
    isGenerating,
    generate,
    draftLab,
    appliedLab,
    isDirty,
    addLabPoint,
    removeDraftPoint,
    importCsv,
    apply,
    clearLab,
  } = useModelEvaluation(model, range)

  const hasPairs = points.length >= MIN_PAIRS

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Predictions vs Laboratory Data
          </h2>
          <p className="text-sm text-muted-foreground">
            Performance of {model.name} against lab ground-truth
          </p>
        </div>
        <Select value={range} onValueChange={v => setRange(v as TimeRange)}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIME_RANGES.map(r => (
              <SelectItem key={r} value={r}>
                {RANGE_LABEL[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <LabDataIngestion
        draftLab={draftLab}
        isDirty={isDirty}
        appliedCount={appliedLab.length}
        alignedCount={points.length}
        addLabPoint={addLabPoint}
        removeDraftPoint={removeDraftPoint}
        importCsv={importCsv}
        apply={apply}
        clearLab={clearLab}
      />

      {hasPairs ? (
        <EvaluationMetrics metrics={metrics} />
      ) : (
        <Card className="border-dashed border-border bg-card">
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Add at least {MIN_PAIRS} lab points and choose “Apply and Compare”
            to see error metrics (RMSE, MAE, R², bias).
          </CardContent>
        </Card>
      )}

      <Card className="border-border bg-card">
        <CardContent className="pt-5">
          <EvaluationChart preds={preds} points={points} />
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button
          className="gap-2"
          onClick={generate}
          disabled={isGenerating || !hasPairs}
        >
          <Sparkles className="h-4 w-4" />
          {isGenerating
            ? 'Analyzing…'
            : analysis
              ? 'Regenerate Analysis'
              : 'Generate AI Analysis'}
        </Button>
        {!analysis && !isGenerating && (
          <p className="text-xs text-muted-foreground">
            {hasPairs
              ? 'Generate a technical analysis from the current statistics.'
              : 'Apply lab data to enable AI analysis.'}
          </p>
        )}
      </div>

      <EvaluationAnalysis analysis={analysis} isGenerating={isGenerating} />
    </div>
  )
}
