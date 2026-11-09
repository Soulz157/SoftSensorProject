/**
 * MODEL-FLOW-038. The grid-search editor's value lists, as pure functions (no
 * React / IO).
 *
 * The user types ONE plain text box per hyperparameter, a comma list such as
 * `0.1, 1, 10`. No `<input type="number">`: its spinner and silent coercion
 * make a list impossible to type, and a text box lets a mistake be named
 * ("abc is not a number") instead of vanishing. The text is what the store
 * keeps; this module turns it into values and checks it.
 *
 * THE SERVER IS THE AUTHORITY. `validateParamGrid` in
 * `apps/backend/src/lib/tuning-grid.ts` re-checks keys, list length, duplicates
 * and the combination cap; this file only gives the user the same answer before
 * a request is sent. The limits come from `GET /training/param-grid/:algorithm`
 * (`GridLimits`), never from a constant here.
 */
import type { HyperparamValue } from '@/store/model-pipeline'
import type { HyperparamField } from '@/lib/training-config'

export type GridValues = HyperparamValue[]
export type ParamGrid = Record<string, GridValues>

export interface GridLimits {
  maxCombinations: number
  maxValuesPerKey: number
}

export interface ParsedValues {
  values: GridValues
  errors: string[]
}

/** A plain decimal, optionally signed, optionally with an exponent. Rejects
 *  `0x10`, `Infinity`, `1,5` and the empty string that `Number()` would take. */
const NUMBER_TOKEN = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i

const NONE_TOKENS = new Set(['none', 'null', 'unlimited'])

/** `0.1, 1, 10` — what the box shows for a list. `null` reads `None`. */
export function formatGridValues(values: GridValues): string {
  return values
    .map(value => (value === null ? 'None' : String(value)))
    .join(', ')
}

/** Whole numbers only: a field whose step is a whole number (n_estimators,
 *  max_iter, num_leaves…). A fractional step (alpha 0.1) allows decimals. */
function isIntegerField(field: HyperparamField): boolean {
  return (
    field.kind === 'number' &&
    field.step !== undefined &&
    Number.isInteger(field.step) &&
    field.step >= 1
  )
}

function parseNumber(
  token: string,
  field: Extract<HyperparamField, { kind: 'number' | 'nullable-number' }>,
): number | string {
  if (!NUMBER_TOKEN.test(token)) return `"${token}" is not a number`
  const value = Number(token)
  if (!Number.isFinite(value)) return `"${token}" is not a finite number`
  if (isIntegerField(field) && !Number.isInteger(value)) {
    return `"${token}" must be a whole number`
  }
  if (field.kind === 'number') {
    if (field.min !== undefined && value < field.min) {
      return `"${token}" is below the minimum ${field.min}`
    }
    if (field.max !== undefined && value > field.max) {
      return `"${token}" is above the maximum ${field.max}`
    }
  }
  return value
}

/**
 * Splits on commas, trims, drops empty tokens, drops repeats, and reads each
 * token by the field's own kind. A key the form does not know (a column the
 * grid searches that `HYPERPARAMS` never listed) reads a number where the token
 * is one and keeps the text otherwise, so the user is never locked out of a
 * knob the search turns.
 */
export function parseGridValues(
  field: HyperparamField | undefined,
  text: string,
): ParsedValues {
  const tokens = text
    .split(',')
    .map(token => token.trim())
    .filter(token => token !== '')

  const values: GridValues = []
  const errors: string[] = []
  const push = (value: HyperparamValue) => {
    if (!values.includes(value)) values.push(value)
  }

  for (const token of tokens) {
    if (!field) {
      push(NUMBER_TOKEN.test(token) ? Number(token) : token)
      continue
    }
    switch (field.kind) {
      case 'number': {
        const parsed = parseNumber(token, field)
        if (typeof parsed === 'string') errors.push(parsed)
        else push(parsed)
        break
      }
      case 'nullable-number': {
        if (NONE_TOKENS.has(token.toLowerCase())) {
          push(null)
          break
        }
        const parsed = parseNumber(token, field)
        if (typeof parsed === 'string') errors.push(parsed)
        else push(parsed)
        break
      }
      case 'select': {
        const option = field.options.find(o => o.value === token)
        if (option) push(option.value)
        else {
          errors.push(
            `"${token}" is not one of ${field.options.map(o => o.value).join(', ')}`,
          )
        }
        break
      }
      case 'checkbox': {
        const lower = token.toLowerCase()
        if (lower === 'true' || lower === 'on') push(true)
        else if (lower === 'false' || lower === 'off') push(false)
        else errors.push(`"${token}" is not true or false`)
        break
      }
    }
  }
  return { values, errors }
}

export interface EffectiveGrid {
  grid: ParamGrid
  /** Per key: what is wrong with the typed text. Absent keys are fine. */
  errors: Record<string, string[]>
}

/**
 * The grid a launch would send: the server's default lists, each key replaced
 * by what the user typed where they typed something, and the base run's own
 * value merged into every key so the current setting is always one grid point
 * (the server's `paramGridFor` does the same for the defaults it serves).
 *
 * An emptied box is an error, not "use the default": clearing it and getting
 * values back would hide that the user removed everything.
 */
export function effectiveGrid(
  defaults: ParamGrid,
  edits: Record<string, string>,
  base: Record<string, HyperparamValue>,
  fieldOf: (key: string) => HyperparamField | undefined,
): EffectiveGrid {
  const grid: ParamGrid = {}
  const errors: Record<string, string[]> = {}

  for (const [key, defaultValues] of Object.entries(defaults)) {
    let values: GridValues = [...defaultValues]
    if (key in edits) {
      const parsed = parseGridValues(fieldOf(key), edits[key] ?? '')
      values = parsed.values
      if (parsed.errors.length > 0) errors[key] = parsed.errors
      else if (values.length === 0) errors[key] = ['Enter at least one value']
    }
    const baseValue = base[key]
    if (
      baseValue !== undefined &&
      values.length > 0 &&
      !values.includes(baseValue)
    ) {
      values = [...values, baseValue]
      if (values.every(v => typeof v === 'number')) {
        values.sort((a, b) => Number(a) - Number(b))
      }
    }
    grid[key] = values
  }
  return { grid, errors }
}

/** Product of the list lengths — the fits per fold. */
export function combinationCount(grid: ParamGrid): number {
  return Object.values(grid).reduce((n, values) => n * values.length, 1)
}

/** The number of model fits a search costs: every combination on every fold. */
export function fitCount(grid: ParamGrid, folds: number): number {
  return combinationCount(grid) * Math.max(1, folds)
}

/**
 * The sentence Step 3 shows when the grid cannot launch, or `null`. Typed-text
 * errors win over limits: a count over a half-parsed grid would be noise.
 */
export function gridRefusal(
  effective: EffectiveGrid,
  limits: GridLimits,
): string | null {
  const bad = Object.keys(effective.errors)
  if (bad.length > 0) {
    return `Fix the values for ${bad.join(', ')} before starting.`
  }
  for (const [key, values] of Object.entries(effective.grid)) {
    if (values.length > limits.maxValuesPerKey) {
      return `${key} has ${values.length} values — at most ${limits.maxValuesPerKey} per hyperparameter.`
    }
  }
  const count = combinationCount(effective.grid)
  if (count > limits.maxCombinations) {
    return `${count} combinations is more than the ${limits.maxCombinations} one search can run — remove some values.`
  }
  return null
}
