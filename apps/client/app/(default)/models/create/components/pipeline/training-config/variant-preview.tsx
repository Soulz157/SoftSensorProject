'use client'

import { ChevronDown, Plus, X } from 'lucide-react'
import { useTuningGrid } from '@/hooks/model/use-tuning-grid'
import {
  MAX_EXTRA_VARIANTS,
  useExtraVariants,
} from '@/hooks/model/use-extra-variants'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { HyperparamField } from '@/lib/training-config'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  ALGORITHM_LABELS,
  type Algorithm,
  type HyperparamValue,
} from '@/store/model-pipeline'
import { HYPERPARAMS } from '@/lib/training-config'
import type { DatasetSize } from '@/lib/hyperparam-ranges'
import {
  formatVariantValue,
  previewVariants,
  variantColumns,
} from '@/lib/tuning-preview'

/**
 * `direct` — Find Best Parameters on ONE algorithm: the current setting runs,
 * then each variant. `sweep-then-tune` — Find Best Model with Find Best
 * Parameters: only the algorithm that WINS the sweep is tuned, so these run
 * only if this one wins.
 */
export type VariantPreviewMode = 'direct' | 'sweep-then-tune'

interface Props {
  algorithm: Algorithm
  /** The record a launch would send for this algorithm (`baseHyperparamsFor`),
   *  NOT the card's own hyperparameters: the search excludes variants against
   *  the former, and the two can differ where the card has no entry. */
  base: Record<string, HyperparamValue>
  size: DatasetSize | undefined
  mode: VariantPreviewMode
}

const NOTE = 'text-[10px] leading-snug text-muted-foreground'

/**
 * MODEL-FLOW-025. The variants Find Best Parameters will try for this
 * algorithm, as a table: the tuning-grid endpoint's list for this dataset size,
 * minus what the current values already cover, capped at the per-job maximum —
 * the same list the job builder assembles (`lib/tuning-preview.ts`, guarded by
 * an agreement test against the backend). Updates as the fields above change.
 */
export function VariantPreview({ algorithm, base, size, mode }: Props) {
  const { grid, loading, error } = useTuningGrid(algorithm, size)
  const label = ALGORITHM_LABELS[algorithm]
  const tuneOnlyWinner = mode === 'sweep-then-tune'
  const extras = useExtraVariants(algorithm)

  const preview = grid
    ? previewVariants(algorithm, grid.variants, base, grid.maxVariantsPerJob)
    : null
  const gridColumns = grid ? variantColumns(algorithm, grid.variants) : []
  const fields = HYPERPARAMS[algorithm] ?? []

  /**
   * MODEL-FLOW-026. A hand-added row is edited across the SAME columns the
   * grid varies, so the table stays one table rather than two stacked ones.
   * Where the grid varies nothing (an algorithm whose whole shortlist the
   * base already covers) the form's own fields stand in — otherwise "+ Add"
   * would hand the user a row with no cell to change.
   */
  const columns = gridColumns.length
    ? gridColumns
    : fields.map(f => ({ key: f.key, label: f.label }))

  /** Seeded from the values the card is showing, so the new row starts at
   *  something meaningful and the user edits one cell rather than filling a
   *  blank one. The server drops it if they change nothing — it would equal
   *  the base, which already runs as candidate 1. */
  const addSeed = () =>
    extras.add(
      Object.fromEntries(columns.map(c => [c.key, base[c.key] ?? null])),
    )

  /** Find Best Parameters on a SWEEP tunes the winner server-side, after
   *  this request is long gone — the job row carries no hand-added list, so
   *  the DTO refuses one there rather than promise a search that never runs. */
  const canAdd = !tuneOnlyWinner
  const atCap = extras.variants.length >= MAX_EXTRA_VARIANTS

  let body: React.ReactNode
  if (error) {
    body = (
      <p role="status" className={NOTE}>
        Could not load the variants for this algorithm.
      </p>
    )
  } else if (!preview) {
    body = (
      <p aria-busy={loading} className={NOTE}>
        Loading Hyperparameters…
      </p>
    )
  } else if (preview.shown.length === 0 && extras.variants.length === 0) {
    body = (
      <p className={NOTE}>
        {tuneOnlyWinner
          ? 'Nothing left to try if this wins — every variant equals your current setting.'
          : 'Nothing left to try — every variant equals your current setting, so Find Best Parameters would have nothing to search. Change a value above, or add a variant of your own.'}
      </p>
    )
  } else {
    const skipped = preview.skipped
    body = (
      <>
        <Table
          aria-label={`${label} Hyperparameter Tuning`}
          className="text-[11px]"
        >
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead
                scope="col"
                className="h-6 w-6 px-1.5 text-[10px] font-medium text-muted-foreground"
              >
                #
              </TableHead>
              {columns.map(column => (
                <TableHead
                  key={column.key}
                  scope="col"
                  className="h-6 px-1.5 text-[10px] font-medium text-muted-foreground"
                >
                  {column.label}
                </TableHead>
              ))}
              {/* Only the hand-added rows carry an action, so the column has
                  no heading text — its header cell exists to keep the grid
                  rows' own cells aligned under it. */}
              {extras.variants.length > 0 && (
                <TableHead scope="col" className="h-6 w-6 px-1.5">
                  <span className="sr-only">Remove</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.shown.map((variant, index) => (
              <TableRow key={index}>
                <TableCell className="px-1.5 py-1 font-mono text-muted-foreground tabular-nums">
                  {index + 1}
                </TableCell>
                {columns.map(column => (
                  <TableCell
                    key={column.key}
                    className="px-1.5 py-1 font-mono tabular-nums"
                  >
                    {formatVariantValue(
                      fields.find(f => f.key === column.key),
                      variant[column.key] ?? null,
                    )}
                  </TableCell>
                ))}
                {extras.variants.length > 0 && <TableCell className="px-1.5" />}
              </TableRow>
            ))}
            {/* MODEL-FLOW-026. The user's own rows, numbered on from the
                curated ones because that is the order the job runs them in:
                the grid's shortlist first, then these. They are EXTRA fits —
                the grid keeps its own cap, so adding here grows the search
                rather than displacing what it already tries. */}
            {extras.variants.map((variant, index) => (
              <TableRow key={`extra-${index}`} className="bg-primary/5">
                <TableCell className="px-1.5 py-1 font-mono text-muted-foreground tabular-nums">
                  {preview.shown.length + index + 1}
                </TableCell>
                {columns.map(column => (
                  <TableCell key={column.key} className="px-1.5 py-1">
                    <VariantValueInput
                      field={fields.find(f => f.key === column.key)}
                      label={`${column.label}, added variant ${index + 1}`}
                      value={variant[column.key] ?? null}
                      onChange={value =>
                        extras.update(index, column.key, value)
                      }
                    />
                  </TableCell>
                ))}
                <TableCell className="px-1.5 py-1">
                  <button
                    type="button"
                    onClick={() => extras.remove(index)}
                    aria-label={`Remove added variant ${index + 1}`}
                    className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {skipped > 0 && (
          <p className={NOTE}>
            {skipped} variant{skipped === 1 ? '' : 's'} skipped —{' '}
            {skipped === 1 ? 'it equals' : 'they equal'} your current values.
          </p>
        )}
      </>
    )
  }

  return (
    <details open className="group mt-3 rounded-md bg-muted/30">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2.5 py-2 text-[11px] font-medium select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        <span>Hyperparameter Tuning</span>
        {preview && (
          <span className="ml-auto font-mono text-[10px] text-muted-foreground tabular-nums">
            {preview.shown.length + extras.variants.length}
          </span>
        )}
      </summary>
      <div className="space-y-2 px-2.5 pb-2.5">
        <p className={NOTE}>
          {tuneOnlyWinner
            ? `Find Best Parameters tunes only the algorithm that wins the sweep, so these run only if ${label} wins.`
            : 'Find Best Parameters trains your current setting first, then each of these.'}
        </p>
        {body}
        {/* MODEL-FLOW-026. Placed under the table rather than in the summary:
            it acts on the list below it, and a control in the summary row
            would also have to stop the disclosure toggling. */}
        {!error &&
          preview &&
          (canAdd ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={atCap}
                onClick={addSeed}
                className="h-6 cursor-pointer gap-1 px-2 text-[10px]"
                title={
                  atCap
                    ? `At most ${MAX_EXTRA_VARIANTS} added variants per run.`
                    : 'Add a variant of your own, on top of the ones above'
                }
              >
                <Plus className="h-3 w-3" />
                Add
              </Button>
              <span className={NOTE}>
                {extras.variants.length === 0
                  ? 'Adds one extra fit, starting from the values above.'
                  : `${extras.variants.length} added — ${extras.variants.length} extra fit${
                      extras.variants.length === 1 ? '' : 's'
                    } on top of the curated ones. A row equal to your current setting, or to one above, is dropped at launch.`}
              </span>
            </div>
          ) : (
            <p className={NOTE}>
              Adding your own variant needs Find Best Model off — with a sweep,
              the tuning phase is built after the winner is known.
            </p>
          ))}
      </div>
    </details>
  )
}

/**
 * MODEL-FLOW-026. One editable cell of a hand-added variant row. The control
 * follows the FIELD's own kind, so a select stays a select and a checkbox
 * stays a boolean — a free-text box for every cell would let a user type
 * `gbdt2` into `boosting_type` and only find out when the container failed.
 *
 * A key the form does not know (a column the grid varies but `HYPERPARAMS`
 * never listed) falls back to a plain text box rather than being locked: the
 * search turns that knob, so the user must be able to as well.
 *
 * `null` is preserved only where it MEANS something — `nullable-number`'s
 * "unlimited". Elsewhere an emptied number box reads as null and the server's
 * own `HyperparametersSchema` accepts it; the trainer then falls back to its
 * default for that key, the same as any absent value.
 */
function VariantValueInput({
  field,
  label,
  value,
  onChange,
}: {
  field: HyperparamField | undefined
  label: string
  value: HyperparamValue
  onChange: (value: HyperparamValue) => void
}) {
  const shared =
    'h-6 w-full min-w-16 rounded border border-border bg-background px-1 font-mono text-[11px] tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

  if (field?.kind === 'select') {
    return (
      <select
        aria-label={label}
        className={`${shared} cursor-pointer`}
        value={typeof value === 'string' ? value : field.defaultValue}
        onChange={e => onChange(e.target.value)}
      >
        {field.options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    )
  }

  if (field?.kind === 'checkbox') {
    return (
      <select
        aria-label={label}
        className={`${shared} cursor-pointer`}
        value={value === true ? 'on' : 'off'}
        onChange={e => onChange(e.target.value === 'on')}
      >
        <option value="on">on</option>
        <option value="off">off</option>
      </select>
    )
  }

  if (field?.kind === 'number' || field?.kind === 'nullable-number') {
    return (
      <Input
        type="number"
        aria-label={label}
        step={field.kind === 'number' ? field.step : undefined}
        className={shared}
        // An empty box is `null`, which `nullable-number` renders as its own
        // "unlimited" and every other field leaves to the trainer's default.
        value={typeof value === 'number' ? value : ''}
        onChange={e =>
          onChange(e.target.value === '' ? null : Number(e.target.value))
        }
      />
    )
  }

  return (
    <Input
      type="text"
      aria-label={label}
      className={shared}
      value={value === null ? '' : String(value)}
      onChange={e => onChange(e.target.value === '' ? null : e.target.value)}
    />
  )
}
