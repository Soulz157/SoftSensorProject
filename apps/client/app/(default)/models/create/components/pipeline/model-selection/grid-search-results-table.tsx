'use client'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { HYPERPARAMS } from '@/lib/training-config'
import { formatVariantValue } from '@/lib/tuning-preview'
import type { RunGridSearch } from '@/services/model-draft'
import type { Algorithm, HyperparamValue } from '@/store/model-pipeline'

interface Props {
  gridSearch: RunGridSearch
}

const HEAD = 'h-6 px-1.5 text-[10px] font-medium text-muted-foreground'
const CELL = 'px-1.5 py-1 font-mono text-[11px] tabular-nums'

/** Four significant digits, so 0.04213 and 421.3 both read at the same width. */
const score = (value: number): string =>
  Number.isFinite(value) ? Number(value.toPrecision(4)).toString() : '—'

/**
 * MODEL-FLOW-038. Every combination a grid-search run tried, best first, so
 * Step 4 shows the ONE winner run beside the whole search that picked it. The
 * score column is the ranking metric itself (RMSE or MAE, lower is better),
 * averaged over the folds it was scored on. That column is the one the winner
 * was chosen by (the job's Loss function), so it is highlighted — by weight and
 * a tinted background, not colour alone. The fold spread is not shown (user
 * decision 2026-11-05); it stays in `grid_search_results.json`.
 *
 * The winner is marked in WORDS in its own column, never by row colour alone.
 */
export function GridSearchResultsTable({ gridSearch }: Props) {
  const fields = HYPERPARAMS[gridSearch.algorithm as Algorithm] ?? []
  const metric = gridSearch.ranking_metric.toUpperCase()
  // Only the keys the grid searched: a column that never varies says nothing.
  const keys = Object.keys(gridSearch.grid)
  const basis = gridSearch.cv
    ? `${gridSearch.n_folds}-fold CV mean`
    : 'test split'

  return (
    <div className="space-y-1.5 px-2 pt-2" data-testid="grid-search-results">
      <p className="text-[11px] font-medium">
        Grid search — {gridSearch.n_combinations} combination
        {gridSearch.n_combinations === 1 ? '' : 's'}
        <span className="font-normal text-muted-foreground">
          {' '}
          · ranked by {metric} on the {basis}, lower is better
        </span>
      </p>
      <div className="max-h-64 overflow-auto rounded-md border border-border/60">
        <Table
          aria-label={`${gridSearch.algorithm} grid search results`}
          className="text-[11px]"
        >
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col" className={`${HEAD} w-8`}>
                Rank
              </TableHead>
              {keys.map(key => (
                <TableHead key={key} scope="col" className={HEAD}>
                  {fields.find(f => f.key === key)?.label ?? key}
                </TableHead>
              ))}
              <TableHead
                scope="col"
                className={`${HEAD} bg-primary/10 text-right font-semibold text-foreground`}
              >
                {metric}
              </TableHead>
              <TableHead scope="col" className={`${HEAD} text-right`}>
                Fit time (s)
              </TableHead>
              <TableHead scope="col" className={HEAD}>
                <span className="sr-only">Result</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {gridSearch.combinations.map(row => {
              const best = row.rank === gridSearch.best.rank
              return (
                <TableRow
                  key={`${row.rank}-${JSON.stringify(row.params)}`}
                  className={best ? 'bg-primary/5' : undefined}
                >
                  <TableCell className={CELL}>{row.rank}</TableCell>
                  {keys.map(key => (
                    <TableCell key={key} className={CELL}>
                      {formatVariantValue(
                        fields.find(f => f.key === key),
                        (row.params[key] ?? null) as HyperparamValue,
                      )}
                    </TableCell>
                  ))}
                  <TableCell
                    className={`${CELL} bg-primary/10 text-right font-semibold text-foreground`}
                  >
                    {score(row.mean_score)}
                  </TableCell>
                  <TableCell className={`${CELL} text-right`}>
                    {score(row.mean_fit_time)}
                  </TableCell>
                  <TableCell className="px-1.5 py-1 text-[10px] font-medium text-primary">
                    {best ? 'Best' : null}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
