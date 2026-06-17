'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { RotateCcw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  preprocess,
  type FillStrategy,
  type FillStrategyConfig,
} from '@/lib/preprocessing'
import { tagMeta } from '@/lib/mock-readings'
import {
  rawDatasetAtom,
  timeRangeAtom,
  fillStrategiesAtom,
} from '@/store/data-visualize'
import { StepView } from './step-view'

const STRATEGY_OPTIONS: { value: FillStrategy; label: string }[] = [
  { value: 'drop', label: 'Drop row' },
  { value: 'forward', label: 'Forward fill' },
  { value: 'backward', label: 'Backward fill' },
  { value: 'mean', label: 'Mean' },
  { value: 'median', label: 'Median' },
  { value: 'constant', label: 'Constant' },
]

const DEBOUNCE_MS = 300

export function Step6Processing() {
  const raw = useAtomValue(rawDatasetAtom)
  const range = useAtomValue(timeRangeAtom)
  const [strategies, setStrategies] = useAtom(fillStrategiesAtom)
  const [draft, setDraft] =
    useState<Record<string, FillStrategyConfig>>(strategies)

  useEffect(() => {
    const timer = setTimeout(() => setStrategies(draft), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft, setStrategies])

  const preprocessed = useMemo(
    () => preprocess(raw, strategies),
    [raw, strategies],
  )
  const allDropped = raw.rows.length > 0 && preprocessed.rows.length === 0

  const setTagStrategy = (tag: string, strategy: FillStrategy) => {
    setDraft(prev => ({
      ...prev,
      [tag]: { strategy, constantValue: prev[tag]?.constantValue },
    }))
  }
  const setTagConstant = (tag: string, value: number) => {
    setDraft(prev => ({
      ...prev,
      [tag]: { strategy: 'constant', constantValue: value },
    }))
  }
  const reset = () => setDraft({})

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Choose how to handle Bad/Questionable readings per tag.
        </p>
        <Button size="sm" variant="ghost" onClick={reset}>
          <RotateCcw className="h-3.5 w-3.5" />
          Reset to defaults
        </Button>
      </div>

      <div className="space-y-2">
        {raw.tags.map(tag => {
          const config = draft[tag]
          const label = tagMeta(tag)?.label ?? tag
          return (
            <div
              key={tag}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
            >
              <div className="min-w-32 flex-1">
                <p className="font-mono text-sm">{tag}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
              <Select
                value={config?.strategy ?? 'drop'}
                onValueChange={v => setTagStrategy(tag, v as FillStrategy)}
              >
                <SelectTrigger className="h-9 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STRATEGY_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {config?.strategy === 'constant' && (
                <Input
                  type="number"
                  className="h-9 w-28"
                  placeholder="Value"
                  value={config.constantValue ?? ''}
                  onChange={e => {
                    const n = Number(e.target.value)
                    if (!Number.isNaN(n)) setTagConstant(tag, n)
                  }}
                />
              )}
            </div>
          )
        })}
      </div>

      {allDropped && (
        <Alert variant="destructive">
          <AlertTitle>This rule removed every row</AlertTitle>
          <AlertDescription>
            Try a fill strategy instead of Drop.
          </AlertDescription>
        </Alert>
      )}

      <StepView
        dataset={preprocessed}
        range={range}
        summary={`${preprocessed.rows.length} rows kept of ${raw.rows.length}`}
      />
    </div>
  )
}
