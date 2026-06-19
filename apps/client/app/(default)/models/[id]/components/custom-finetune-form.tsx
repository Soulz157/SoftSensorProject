'use client'

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import {
  PARAM_META,
  REGRESSION_MODELS,
  paramsFor,
  type RegressionModel,
  type RetrainConfig,
} from '@/lib/retrain'

export function CustomFinetuneForm({
  config,
  onChange,
  disabled,
}: {
  config: RetrainConfig
  onChange: (config: RetrainConfig) => void
  disabled?: boolean
}) {
  const params = paramsFor(config.model)

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Regression Model</Label>
        <Select
          value={config.model}
          onValueChange={v =>
            onChange({ ...config, model: v as RegressionModel })
          }
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REGRESSION_MODELS.map(m => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {params.map(p => {
        const meta = PARAM_META[p]
        const value = config[p]
        return (
          <div key={p} className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{meta.label}</Label>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {value}
              </span>
            </div>
            <Slider
              min={meta.min}
              max={meta.max}
              step={meta.step}
              value={[value]}
              disabled={disabled}
              onValueChange={vals => {
                const next = vals[0]
                if (next !== undefined) onChange({ ...config, [p]: next })
              }}
            />
          </div>
        )
      })}
    </div>
  )
}
