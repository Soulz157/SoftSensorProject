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
 * `manual` — Find Best Parameters off: only the rows the user added, each its
 * own candidate. `direct` — Find Best Parameters on ONE algorithm: the current
 * setting runs, then the curated variants, then the user's rows.
 * `sweep-then-tune` — Find Best Parameters on two or more algorithms: the
 * user's rows train in the first round with every algorithm; the curated
 * variants run only if this algorithm's candidate wins it.
 */
export type VariantPreviewMode = 'manual' | 'direct' | 'sweep-then-tune'

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
  const manual = mode === 'manual'
  const tuneOnlyWinner = mode === 'sweep-then-tune'
  // No grid to show with Find Best Parameters off, so nothing is fetched.
  const { grid, loading, error } = useTuningGrid(
    manual ? null : algorithm,
    size,
  )
  const label = ALGORITHM_LABELS[algorithm]
  const extras = useExtraVariants(algorithm)

  const preview =
    !manual && grid
      ? previewVariants(algorithm, grid.variants, base, grid.maxVariantsPerJob)
      : null
  const gridColumns =
    !manual && grid ? variantColumns(algorithm, grid.variants) : []
  const fields = HYPERPARAMS[algorithm] ?? []
  const fieldColumns = fields.map(f => ({ key: f.key, label: f.label }))

  /**
   * MODEL-FLOW-026. In a direct search the user's rows share the grid's
   * columns, so the list stays one table in the order the job runs it. In the
   * other two modes the rows are whole candidates of their own, edited across
   * every field the card has. Where the grid varies nothing, the form's
   * fields stand in, or "+ Add" would hand the user a row with no cell.
   */
  const rowColumns =
    mode === 'direct' && gridColumns.length ? gridColumns : fieldColumns

  /** Seeded from the values the card is showing, so the new row starts at
   *  something meaningful and the user edits one cell rather than filling a
   *  blank one. A row left equal to the card is dropped at launch. */
  const addSeed = () =>
    extras.add(
      Object.fromEntries(rowColumns.map(c => [c.key, base[c.key] ?? null])),
    )
  const atCap = extras.variants.length >= MAX_EXTRA_VARIANTS

  const headCell = 'h-6 px-1.5 text-[10px] font-medium text-muted-foreground'
  const numCell = 'px-1.5 py-1 font-mono text-muted-foreground tabular-nums'

  const gridRows = (variants: Record<string, HyperparamValue>[]) =>
    variants.map((variant, index) => (
      <TableRow key={`grid-${index}`}>
        <TableCell className={numCell}>{index + 1}</TableCell>
        {gridColumns.map(column => (
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
        {mode === 'direct' && extras.variants.length > 0 && (
          <TableCell className="px-1.5" />
        )}
      </TableRow>
    ))

  const userRows = (offset: number) =>
    extras.variants.map((variant, index) => (
      <TableRow key={`extra-${index}`} className="bg-primary/5">
        <TableCell className={numCell}>{offset + index + 1}</TableCell>
        {rowColumns.map(column => (
          <TableCell key={column.key} className="px-1.5 py-1">
            <VariantValueInput
              field={fields.find(f => f.key === column.key)}
              label={`${column.label}, added variant ${index + 1}`}
              // A row added in a direct search lists only the grid's columns;
              // shown across every field, a MISSING key reads the card's value
              // — the value the launch fills it with. A present `null` stays
              // (a cleared field, or nullable-number's "unlimited").
              value={
                column.key in variant
                  ? (variant[column.key] ?? null)
                  : (base[column.key] ?? null)
              }
              onChange={value => extras.update(index, column.key, value)}
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
    ))

  const tableHead = (
    columns: { key: string; label: string }[],
    withAction: boolean,
  ) => (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        <TableHead scope="col" className={`${headCell} w-6`}>
          #
        </TableHead>
        {columns.map(column => (
          <TableHead key={column.key} scope="col" className={headCell}>
            {column.label}
          </TableHead>
        ))}
        {/* Only the user's rows carry an action, so the column has no
            heading text — it keeps the other rows' cells aligned. */}
        {withAction && (
          <TableHead scope="col" className={`${headCell} w-6`}>
            <span className="sr-only">Remove</span>
          </TableHead>
        )}
      </TableRow>
    </TableHeader>
  )

  const addControl = (
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
            ? `At most ${MAX_EXTRA_VARIANTS} added variants per algorithm.`
            : 'Add a hyperparameter set of your own'
        }
      >
        <Plus className="h-3 w-3" />
        Add
      </Button>
      <span className={NOTE}>
        {extras.variants.length === 0
          ? 'Adds one more candidate, starting from the values above.'
          : `${extras.variants.length} added — ${extras.variants.length} extra fit${
              extras.variants.length === 1 ? '' : 's'
            }. A row equal to your current setting, or to another row, is dropped at launch.`}
      </span>
    </div>
  )

  // The user's own rows on their own — Find Best Parameters off, or on with
  // several algorithms, where they train in the first round regardless of
  // which candidate wins.
  const ownRowsSection =
    extras.variants.length > 0 ? (
      <Table aria-label={`${label} added variants`} className="text-[11px]">
        {tableHead(rowColumns, true)}
        <TableBody>{userRows(0)}</TableBody>
      </Table>
    ) : null

  let gridSection: React.ReactNode = null
  if (!manual) {
    if (error) {
      gridSection = (
        <p role="status" className={NOTE}>
          Could not load the variants for this algorithm.
        </p>
      )
    } else if (!preview) {
      gridSection = (
        <p aria-busy={loading} className={NOTE}>
          Loading Hyperparameters…
        </p>
      )
    } else if (mode === 'direct') {
      gridSection =
        preview.shown.length === 0 && extras.variants.length === 0 ? (
          <p className={NOTE}>
            Nothing left to try — every variant equals your current setting, so
            Find Best Parameters would have nothing to search. Change a value
            above, or add a variant of your own.
          </p>
        ) : (
          <Table
            aria-label={`${label} Hyperparameter Tuning`}
            className="text-[11px]"
          >
            {tableHead(gridColumns, extras.variants.length > 0)}
            <TableBody>
              {gridRows(preview.shown)}
              {/* Numbered on from the curated rows: the job runs the grid's
                  shortlist first, then these. */}
              {userRows(preview.shown.length)}
            </TableBody>
          </Table>
        )
    } else {
      gridSection =
        preview.shown.length === 0 ? (
          <p className={NOTE}>
            Nothing left to try if this wins — every variant equals your current
            setting.
          </p>
        ) : (
          <Table
            aria-label={`${label} Hyperparameter Tuning`}
            className="text-[11px]"
          >
            {tableHead(gridColumns, false)}
            <TableBody>{gridRows(preview.shown)}</TableBody>
          </Table>
        )
    }
  }

  const skipped = preview?.skipped ?? 0
  const count = manual
    ? extras.variants.length
    : (preview?.shown.length ?? 0) + extras.variants.length

  return (
    <details open className="group mt-3 rounded-md bg-muted/30">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2.5 py-2 text-[11px] font-medium select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        <span>
          {manual ? 'Hyperparameter variants' : 'Hyperparameter Tuning'}
        </span>
        {(manual || preview) && (
          <span className="ml-auto font-mono text-[10px] text-muted-foreground tabular-nums">
            {count}
          </span>
        )}
      </summary>
      <div className="space-y-2 px-2.5 pb-2.5">
        {manual && (
          <p className={NOTE}>
            Each row trains as its own candidate, after your current setting.
            Step 4 compares them all.
          </p>
        )}
        {tuneOnlyWinner && (
          <>
            {extras.variants.length > 0 && (
              <p className={NOTE}>
                Your rows train in the first round, with every algorithm.
              </p>
            )}
          </>
        )}
        {mode !== 'direct' && ownRowsSection}
        {(manual || tuneOnlyWinner) && addControl}
        {tuneOnlyWinner && (
          <p className={NOTE}>
            Find Best Parameters tunes only the candidate with the lowest Test
            RMSE, so these run only if {label} wins.
          </p>
        )}
        {mode === 'direct' && (
          <p className={NOTE}>
            Find Best Parameters trains your current setting first, then each of
            these.
          </p>
        )}
        {gridSection}
        {skipped > 0 && (
          <p className={NOTE}>
            {skipped} variant{skipped === 1 ? '' : 's'} skipped —{' '}
            {skipped === 1 ? 'it equals' : 'they equal'} your current values.
          </p>
        )}
        {mode === 'direct' && !error && preview && addControl}
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
