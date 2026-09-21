'use client'

import { ChevronDown } from 'lucide-react'
import { useTuningGrid } from '@/hooks/model/use-tuning-grid'
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

  const preview = grid
    ? previewVariants(algorithm, grid.variants, base, grid.maxVariantsPerJob)
    : null
  const columns = grid ? variantColumns(algorithm, grid.variants) : []
  const fields = HYPERPARAMS[algorithm] ?? []

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
  } else if (preview.shown.length === 0) {
    body = (
      <p className={NOTE}>
        {tuneOnlyWinner
          ? 'Nothing left to try if this wins — every variant equals your current setting.'
          : 'Nothing left to try — every variant equals your current setting, so Find Best Parameters would have nothing to search. Change a value above.'}
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
            {preview.shown.length}
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
      </div>
    </details>
  )
}
