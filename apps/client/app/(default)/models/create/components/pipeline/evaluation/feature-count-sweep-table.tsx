import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  DEFAULT_SWEEP_METRIC,
  buildSweepRows,
  selectByOverlap,
  sweepMetricLabel,
  sweepMetricScopeText,
  sweepProvenanceText,
  sweepRuleText,
  type SweepMetric,
  type SweepRow,
} from '@/lib/feature-count-sweep'
import type { ModelTrainingRunListItem } from '@/services/model-draft'
import { EmptyPanel } from './empty-panel'
import { methodMetaOf } from './feature-importance-table'

/**
 * MODEL-FLOW-019-T31. "How many features" as a CURVE WITH INTERVALS and a
 * STATED RULE — never a bolded argmin.
 *
 * The reference table that prompted the request is itself the argument: n=7
 * read 0.0522 and n=4 read 0.0526, a 0.8 percent difference, while n=6
 * (0.0554) was WORSE than n=5 (0.0550). The ordering contradicted itself
 * inside seven rows. So this table never marks a winner by size; it marks the
 * row a printed rule selects, and shows the lowest mean separately so a reader
 * can see where the two disagree.
 *
 * Every derivation is imported, none re-done here: `buildSweepRows`,
 * `selectByOverlap`, `sweepRuleText` and `sweepProvenanceText` all live in
 * lib/feature-count-sweep.ts with their own tests (CLAUDE.md — derivations in
 * lib, not in components).
 */

/** Four places, matching the reference table's own 0.0522 precision — three
 *  would collapse two rows that differ in the fourth decimal into one number
 *  and invite reading a tie the data does not report. */
function formatError(value: number): string {
  return value.toFixed(4)
}

function formatR2(value: number): string {
  return value.toFixed(3)
}

/**
 * AC67, and V42's whole point. A row without a spread renders its mean but NO
 * interval — and `selectByOverlap` never places it, because a row that cannot
 * be shown to overlap or miss anything would be ordered by its mean alone,
 * which is the argmin this table exists to refuse.
 */
function IntervalCell({
  stat,
  format,
}: {
  stat: { mean: number | null; std: number | null }
  format: (value: number) => string
}) {
  if (stat.mean === null) {
    return <span className="text-muted-foreground">—</span>
  }
  return (
    <span className="font-mono tabular-nums">
      {format(stat.mean)}
      {stat.std === null ? (
        <span className="ml-1 font-sans text-[11px] text-muted-foreground">
          no spread
        </span>
      ) : (
        <span className="text-muted-foreground"> ± {format(stat.std)}</span>
      )}
    </span>
  )
}

/** What a row that is not yet a measurement is doing instead. Kept rather
 *  than filtered: a sweep whose n=6 row has not landed is a different reading
 *  of the curve from one that never had an n=6 row, and only the first is
 *  recoverable by waiting. */
function statusNote(row: SweepRow): string | null {
  if (row.status === 'SUCCEEDED') return null
  if (row.status === 'FAILED' || row.status === 'CANCELED') {
    return 'did not finish'
  }
  return 'still running'
}

export function FeatureCountSweepTable({
  runs,
  seedRunId,
  seedMethod,
  metric = DEFAULT_SWEEP_METRIC,
  distinctLabelledValues,
  loading = false,
  error = null,
}: {
  runs: ModelTrainingRunListItem[]
  /** AC66/V43. The ONE seed every row shares, read off the sweep rather than
   *  off each row's own importance — a row whose algorithm records none (mlp,
   *  grp, hgb, a non-linear svm) still names this seed, which is exactly what
   *  V43 asserts and what a per-row lookup could never satisfy. */
  seedRunId: string
  seedMethod: string
  /**
   * MODEL-FLOW-019-T35. The metric THIS SWEEP was launched under, passed as a
   * PROP rather than derived per row — V43's own resolution, for its own
   * reason: a per-row derivation is unsatisfiable for a row whose metric was
   * never recorded, and every row of a sweep shares one decision by
   * construction.
   *
   * Optional, and the default is load-bearing rather than convenience: a
   * sweep launched before this prop existed carries no recorded metric and
   * must read as decided on RMSE — NAMED, via `sweepRuleText`, never silently
   * re-decided under whatever a reader has selected since.
   */
  metric?: SweepMetric
  distinctLabelledValues: number | null
  loading?: boolean
  error?: string | null
}) {
  const rows = buildSweepRows(runs, distinctLabelledValues)
  const selection = selectByOverlap(rows, metric)
  const { label: methodLabel } = methodMetaOf(seedMethod)
  const metricLabel = sweepMetricLabel(metric)

  // The rule picked a row the lowest mean did not. Worth saying out loud —
  // it is the one case where the table's answer visibly differs from the
  // number a reader's eye lands on first.
  const ruleDisagrees =
    selection.chosenRunId !== null &&
    selection.bestRunId !== null &&
    selection.chosenRunId !== selection.bestRunId

  return (
    <section className="space-y-3 rounded-xl border border-border/60 p-4">
      <div className="space-y-1">
               <h3 className="text-sm font-medium text-foreground">
          How many features are essential
        </h3>
        {/* AC66 + AC69 in one sentence, built from data rather than written
            into JSX — the seed run, its method, that method's own bias, and
            what the population was already used to choose. */}
        <p className="text-xs text-muted-foreground">
          {sweepProvenanceText(seedRunId, seedMethod, methodLabel)}
        </p>
      </div>

           {error ? (
        <EmptyPanel>Could not load these results — {error}</EmptyPanel>
      ) : rows.length === 0 ? (
        <EmptyPanel>
          {loading
            ? 'Loading the results…'
            : 'No rows recorded yet.'}
        </EmptyPanel>
      ) : (
        <div className="rounded-lg border border-border">
          <Table className="text-xs">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="h-9 px-3">Features (X)</TableHead>
                {/* MODEL-FLOW-019-T35. BOTH metric columns always render and
                    the decider is NAMED, rather than the chosen metric being
                    the only figure shown — a reader can then see where the two
                    ladders disagree without switching to find out.

                    Unconditional rather than data-gated, deliberately: T01
                    read the real key set and found cv_{r2,mae,rmse}_{mean,std}
                    on every CV run this system has trained, so a MAE column
                    hidden for want of data would describe a state that does
                    not occur. A row that somehow lacks the pair still renders
                    honestly — `IntervalCell` shows an em dash for a null mean
                    and "no spread" for a null SD. */}
                <TableHead className="h-9 px-3 text-right">
                  RMSE (fold mean ± SD)
                  {metric === 'rmse' && (
                    <span className="ml-1 font-normal text-muted-foreground">
                      · decides
                    </span>
                  )}
                </TableHead>
                <TableHead className="h-9 px-3 text-right">
                  MAE (fold mean ± SD)
                  {metric === 'mae' && (
                    <span className="ml-1 font-normal text-muted-foreground">
                      · decides
                    </span>
                  )}
                </TableHead>
                <TableHead
                  className="h-9 px-3 text-right"
                  title="R² is shown for reference and cannot decide the ladder — a fold average of ratios whose denominator changes per fold"
                >
                  R² (fold mean ± SD)
                </TableHead>
               <TableHead
  className="h-9 px-3 text-right"
  title="Distinct labelled observations per feature — the denominator is distinct labelled values, never row count, because the target is a lab sample carried across the frame"
>
  Labelled obs / feature
</TableHead>
                <TableHead className="h-9 px-3" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(row => {
                const note = statusNote(row)
                const chosen = row.runId === selection.chosenRunId
                const lowest = row.runId === selection.bestRunId
                return (
                  <TableRow
                    key={row.runId}
                    // Tonal only. The selected row is a conclusion, not a
                    // status — red/amber/emerald stay reserved for workspace
                    // and plant state in this project.
                    className={cn(chosen && 'bg-muted/40')}
                  >
                    <TableCell className="px-3 py-2 font-medium text-foreground">
                      {row.n ?? '—'}
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right">
                      <IntervalCell stat={row.rmse} format={formatError} />
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right">
                      <IntervalCell stat={row.mae} format={formatError} />
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right">
                      <IntervalCell stat={row.r2} format={formatR2} />
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right font-mono tabular-nums">
                      {row.obsPerFeature === null
                        ? '—'
                        : row.obsPerFeature.toFixed(1)}
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {chosen && (
                          <Badge
                            variant="secondary"
                            className="px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                          >
                            selected by the rule
                          </Badge>
                        )}
                        {lowest && !chosen && (
                          <Badge
                            variant="secondary"
                            className="px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                          >
                            lowest mean
                          </Badge>
                        )}
                        {note && (
                          <span className="text-[11px] text-muted-foreground">
                            {note}
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* AC67: the rule is PRINTED, never implied by which row is bold —
          extended by T35 to name the metric and its direction, since a rule
          stated without one is only half printed. */}
      <p className="text-xs text-muted-foreground">{sweepRuleText(metric)}</p>

      {ruleDisagrees && (
        <p className="text-xs text-muted-foreground">
          The best fold mean is {selection.bestN} features, but{' '}
          {selection.chosenN} is selected: their {metricLabel} spreads overlap,
          so the extra features bought nothing this data can measure.
        </p>
      )}

      {/* MODEL-FLOW-019-T35. What the control does and does not govern, said
          where a reader who just changed it is looking. Two misreadings are
          available here — that it re-ranks Step 4, and that the rows were fit
          for it — and both are stated away rather than left to inference. */}
      <p className="text-xs text-muted-foreground">
        {sweepMetricScopeText(metric)}
      </p>

      {/* The expanding-window caveat applies whichever metric decides, so it
          is stated separately from the rule rather than folded into it. */}
      <p className="text-xs text-muted-foreground">
        An expanding window trains the first fold on the least data, so part of
        every row&apos;s spread is a sample-size artefact rather than
        instability.
      </p>
    </section>
  )
}
