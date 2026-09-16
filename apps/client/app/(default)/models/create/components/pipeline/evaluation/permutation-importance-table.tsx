import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  rankPermutationFeatures,
  populationLabel,
  populationCountLabel,
} from '@/lib/feature-importance'
import type { RunPermutationImportance } from '@/services/model-draft'
import { EmptyPanel } from './empty-panel'
import { methodMetaOf } from './feature-importance-table'

/**
 * MODEL-FLOW-023-T10/T05. A SECOND, independent table from
 * `FeatureImportanceTable` — never a fifth method folded into that one,
 * per `importance.py`'s own finding: a signed, population-scored drop and
 * an always-non-negative fit-internal value answer different questions.
 * Rendered as its own STACKED section (user, 2026-09-15 — MODEL-FLOW-023
 * openDecision 1), beneath `FeatureImportanceTable` when both exist, so the
 * disagreement between methods is visible on one scroll.
 *
 * Columns stay exactly rank / Feature (X) / Importance — the same three
 * `FeatureImportanceTable` renders — with the interval inside the
 * Importance cell (`0.0184 ± 0.0021`), never a fourth column: a permutation
 * figure never renders without its spread (finding 4).
 */
export function PermutationImportanceTable({
  importance,
  derivedFromTarget,
}: {
  importance: RunPermutationImportance
  derivedFromTarget: string[] | null
}) {
  const ranked = rankPermutationFeatures(importance, 10)
  const totalCount = importance.features.length
  const shownCount = ranked.length
  const derivedSet = new Set(derivedFromTarget ?? [])
  const { caveat, shareCaveat } = methodMetaOf(importance.method)

  return (
    <section className="space-y-3 rounded-xl border border-border/60 p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-foreground">
          Permutation importance
        </h3>
        <p className="text-xs text-muted-foreground">
          Scored on {populationLabel(importance.scored_on)} —{' '}
          {populationCountLabel(importance.scored_on, importance.n)},{' '}
          {importance.n_repeats} reshuffles per feature, measured as the drop in{' '}
          {importance.metric.toUpperCase()} from a baseline of{' '}
          {importance.baseline_score.toFixed(4)}. This figure is not comparable
          across methods, and ranks features within this run only.
          {caveat && ` ${caveat}`}
        </p>
        {shareCaveat && (
          <p className="text-xs text-muted-foreground">{shareCaveat}</p>
        )}
      </div>

      <div className="rounded-lg border border-border">
        <Table className="text-xs">
          {totalCount > shownCount && (
            <TableCaption className="mb-3 px-3 text-xs">
              Top {shownCount} of {totalCount} features.
            </TableCaption>
          )}
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="h-9 px-3">#</TableHead>
              <TableHead className="h-9 px-3">Feature (X)</TableHead>
              <TableHead className="h-9 px-3 text-right">Importance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ranked.map(row => (
              <TableRow key={row.name}>
                <TableCell className="px-3 py-2 text-muted-foreground">
                  {row.rank ?? '—'}
                </TableCell>
                <TableCell className="px-3 py-2 font-medium text-foreground">
                  {row.name}
                  {derivedSet.has(row.name) && (
                    <Badge
                      variant="secondary"
                      className="ml-2 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                    >
                      target-derived
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="px-3 py-2 text-right font-mono tabular-nums">
                  {row.importanceRaw.toFixed(4)} ± {row.std.toFixed(4)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {ranked.some(row => row.rank === null) && (
        <p className="text-xs text-muted-foreground">
          A row with no rank permuted no better than chance — its interval does
          not clear zero, so it is kept in place rather than ranked or hidden.
        </p>
      )}
    </section>
  )
}

/** The "neither artifact exists" empty state, shared by both tables' caller
 *  (`phase-5-evaluation.tsx`) — retires the old "no such quantity to read"
 *  copy, which permutation makes false the moment an algorithm has EITHER
 *  a fit-internal figure or a permutation one. */
export function FeatureImportanceEmptyPanel({
  algorithmLabel,
}: {
  algorithmLabel: string
}) {
  return (
    <EmptyPanel>
      Feature importance: not recorded for this run — either it predates
      feature-importance recording, or no method (fit-internal or permutation)
      could be computed for {algorithmLabel} on this run.
    </EmptyPanel>
  )
}
