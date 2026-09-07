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
import {
  HYPERPARAMS,
  type HyperparamField,
  type SuggestedRange,
} from '@/lib/training-config'
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
      {/* MODEL-FLOW-020-T05. Said ONCE per block rather than per field, and
          said at all because the bands would otherwise overclaim. Each range
          describes its estimator in general; none is sized to the selected
          dataset, because MODEL-FLOW-020-T03 measured capacity against real
          holdouts at 32, 59 and 97 distinct labelled values and found three
          different orderings of the same settings — no value inside these
          bands separated from another. Leaving that unsaid would put a
          confident-looking number in front of the user on exactly the data
          where it carries no information, which is the failure this
          feature's own finding 1 opens with. */}
      <p className="text-[10px] leading-tight text-muted-foreground">
        Suggested ranges describe each estimator, not your dataset — on data
        this size, no value within them measurably changed holdout error.
      </p>
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

/**
 * MODEL-FLOW-020-T05. The suggested band, rendered UNDER its field as
 * advisory text — it constrains nothing, and the input still accepts whatever
 * the field's own min/max allow.
 *
 * Neutral muted token, never a warning colour: red and amber are reserved for
 * workspace and plant status in this codebase, and a value outside this band
 * is not an error — it is a choice the user is allowed to make. Nothing here
 * reacts to the current value for the same reason; a band that turned red
 * would be a validation message wearing advisory clothing.
 */
function RangeHint({ range }: { range: SuggestedRange }) {
  return (
    <p className="text-[10px] leading-tight text-muted-foreground">
      <span className="font-mono tabular-nums">
        {range.min}–{range.max}
      </span>{' '}
      · {range.note}
    </p>
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
          {field.suggestedRange && <RangeHint range={field.suggestedRange} />}
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
          {field.suggestedRange && <RangeHint range={field.suggestedRange} />}
        </div>
      )
    }
  }
}
