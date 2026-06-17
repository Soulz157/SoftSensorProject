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
import { EvaluationMetrics } from './evaluation-metrics'
import { EvaluationChart } from './evaluation-chart'
import { EvaluationAnalysis } from './evaluation-analysis'

const RANGE_LABEL: Record<TimeRange, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
}

export function ModelEvaluation({ model }: { model: AIModel }) {
  const [range, setRange] = useState<TimeRange>('7d')
  const { points, metrics, analysis, isGenerating, generate } =
    useModelEvaluation(model, range)

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

      <EvaluationMetrics metrics={metrics} />

      <Card className="border-border bg-card">
        <CardContent className="pt-5">
          <EvaluationChart points={points} />
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button className="gap-2" onClick={generate} disabled={isGenerating}>
          <Sparkles className="h-4 w-4" />
          {isGenerating
            ? 'Analyzing…'
            : analysis
              ? 'Regenerate Analysis'
              : 'Generate AI Analysis'}
        </Button>
        {!analysis && !isGenerating && (
          <p className="text-xs text-muted-foreground">
            Generate a technical analysis from the current statistics.
          </p>
        )}
      </div>

      <EvaluationAnalysis analysis={analysis} isGenerating={isGenerating} />
    </div>
  )
}
