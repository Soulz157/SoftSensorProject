'use client'

import { useEffect } from 'react'
import { AlertTriangle, Cpu, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { ALGORITHMS, ALGORITHM_LABELS } from '@/store/model-pipeline'
import { useModelTraining } from '@/hooks/model/use-model-training'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'

const HYPERPARAM_FIELDS: Record<
  string,
  { key: string; label: string; defaultValue: number; step?: number }[]
> = {
  ols: [],
  ridge: [{ key: 'alpha', label: 'Alpha (regularization)', defaultValue: 1 }],
  random_forest: [
    { key: 'n_estimators', label: 'Trees', defaultValue: 100, step: 10 },
    { key: 'max_depth', label: 'Max depth', defaultValue: 5 },
  ],
}

interface Props {
  nav: UsePipelineNavResult
}

export function Phase2TrainingConfig({ nav }: Props) {
  const { selectedDataset, algorithm, targetVariable, hyperparameters } = nav
  const training = useModelTraining()
  const tags = selectedDataset?.tags ?? []
  const fields = HYPERPARAM_FIELDS[algorithm] ?? []

  // Seed hyperparameter defaults when the algorithm changes.
  useEffect(() => {
    for (const field of fields) {
      if (hyperparameters[field.key] === undefined) {
        nav.setHyperparameter(field.key, field.defaultValue)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [algorithm])

  const canTrain =
    targetVariable !== '' && training.status !== 'training' && tags.length > 0

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-medium text-foreground">
          Training configuration
        </h2>
        <p className="text-xs text-muted-foreground">
          Choose an algorithm and target variable for{' '}
          <span className="font-medium text-foreground">
            {selectedDataset?.name}
          </span>
          .
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Algorithm</Label>
          <Select
            value={algorithm}
            onValueChange={v => nav.setAlgorithm(v as typeof algorithm)}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALGORITHMS.map(a => (
                <SelectItem key={a} value={a}>
                  {ALGORITHM_LABELS[a]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium">
            Target variable <span className="text-destructive">*</span>
          </Label>
          <Select value={targetVariable} onValueChange={nav.setTargetVariable}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Select a tag to predict" />
            </SelectTrigger>
            <SelectContent>
              {tags.map(tag => (
                <SelectItem key={tag} value={tag}>
                  {tag}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {fields.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs font-medium">Hyperparameters</Label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {fields.map(field => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={field.key} className="text-xs font-normal">
                  {field.label}
                </Label>
                <Input
                  id={field.key}
                  type="number"
                  step={field.step ?? 0.1}
                  value={hyperparameters[field.key] ?? field.defaultValue}
                  onChange={e =>
                    nav.setHyperparameter(field.key, Number(e.target.value))
                  }
                  className="h-9 text-sm"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {tags.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600 ring-1 ring-amber-500/20 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Selected dataset has no tags — go back and choose a different dataset.
        </div>
      )}

      <div className="space-y-2 border-t border-border/60 pt-4">
        <Button onClick={training.start} disabled={!canTrain} className="gap-2">
          {training.status === 'training' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Cpu className="h-4 w-4" />
          )}
          {training.status === 'training'
            ? 'Training…'
            : training.status === 'done'
              ? 'Retrain'
              : 'Start Training'}
        </Button>
        {training.status === 'training' && (
          <Progress value={training.progress} className="h-1.5" />
        )}
        {training.status === 'error' && (
          <p className="text-xs text-destructive">{training.error}</p>
        )}
        {training.status === 'done' && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400">
            Training complete — continue to Results.
          </p>
        )}
      </div>
    </div>
  )
}
