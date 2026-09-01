'use client'

import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { HYPERPARAMS, type HyperparamField } from '@/lib/training-config'
import type { Algorithm, HyperparamValue } from '@/store/model-pipeline'

interface Props {
  algorithm: Algorithm
  hyperparameters: Record<string, HyperparamValue>
  onChange: (key: string, value: HyperparamValue) => void
}

/**
 * Per-algorithm hyperparameter grid. Reads the field catalog from
 * `lib/training-config` and branches on each field's `kind` to render the
 * matching control — number input, checkbox, categorical select, or a
 * number-with-"unlimited" toggle. Pure presentation; writes back via `onChange`.
 */
export function DynamicHyperparameters({
  algorithm,
  hyperparameters,
  onChange,
}: Props) {
  // `?? []` guards a legacy/unknown algorithm value (e.g. a model saved with the
  // retired `ridge`) hydrated into the atom — it simply renders no knobs.
  const fields = HYPERPARAMS[algorithm] ?? []
  if (fields.length === 0) return null

  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium">Hyperparameters</Label>
      <div className="grid grid-cols-1 gap-4 rounded-lg p-4 sm:grid-cols-2">
        {fields.map(field => (
          <HyperparamControl
            key={field.key}
            field={field}
            value={hyperparameters[field.key]}
            onChange={onChange}
          />
        ))}
      </div>
    </div>
  )
}

function HyperparamControl({
  field,
  value,
  onChange,
}: {
  field: HyperparamField
  value: HyperparamValue | undefined
  onChange: (key: string, value: HyperparamValue) => void
}) {
  switch (field.kind) {
    case 'number': {
      const num = typeof value === 'number' ? value : field.defaultValue
      return (
        <div className="space-y-1.5">
          <Label htmlFor={field.key} className="text-xs font-normal">
            {field.label}
          </Label>
          <Input
            id={field.key}
            type="number"
            step={field.step ?? 1}
            min={field.min}
            max={field.max}
            value={num}
            onChange={e => onChange(field.key, Number(e.target.value))}
            className="h-9 font-mono text-sm tabular-nums"
          />
        </div>
      )
    }

    case 'checkbox': {
      const checked = typeof value === 'boolean' ? value : field.defaultValue
      return (
        <div className="flex items-center gap-2 pt-6">
          <Checkbox
            id={field.key}
            checked={checked}
            onCheckedChange={next => onChange(field.key, next === true)}
          />
          <Label htmlFor={field.key} className="text-xs font-normal">
            {field.label}
          </Label>
        </div>
      )
    }

    case 'select': {
      const current = typeof value === 'string' ? value : field.defaultValue
      return (
        <div className="space-y-1.5">
          <Label className="text-xs font-normal">{field.label}</Label>
          <Select
            value={current}
            onValueChange={next => onChange(field.key, next)}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {field.options.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )
    }

    case 'nullable-number': {
      const unlimited = value === null || value === undefined
      const num = typeof value === 'number' ? value : 10
      return (
        <div className="space-y-1.5">
          <Label htmlFor={field.key} className="text-xs font-normal">
            {field.label}
          </Label>
          <Input
            id={field.key}
            type="number"
            min={1}
            value={unlimited ? '' : num}
            placeholder="Unlimited"
            onChange={e =>
              onChange(
                field.key,
                e.target.value === '' ? null : Number(e.target.value),
              )
            }
            className="h-9 font-mono text-sm tabular-nums"
          />
          <label className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
            <Checkbox
              checked={unlimited}
              onCheckedChange={next =>
                onChange(field.key, next === true ? null : 10)
              }
            />
            Unlimited (None)
          </label>
        </div>
      )
    }
  }
}
