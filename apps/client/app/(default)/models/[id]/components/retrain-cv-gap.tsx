'use client'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useCvGap } from '@/hooks/model/use-cv-gap'
import { MIN_SPREAD_FOLDS } from '@/lib/retrain-lab-events'

const fmt = (v: number | null) => (v === null ? '—' : v.toFixed(3))
const signed = (v: number | null) =>
  v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(3)}`

/**
 * MODEL-SERVE-026-T05. Whether the new version's lead holds across time: the
 * candidate's configuration refitted on each expanding fold, scored beside
 * the current version at that fold's lab events. A measurement only — it
 * does not change which candidate was picked (openDecision 3).
 */
export function RetrainCvGap({
  modelId,
  runId,
  currentVersion,
}: {
  modelId: string
  runId: string | null
  currentVersion: number | null
}) {
  const state = useCvGap(modelId, runId)
  const current = currentVersion !== null ? `v${currentVersion}` : 'current'

  if (state.status === 'loading') {
    return (
      <p className="text-[10px] text-muted-foreground">
        Loading cross-validation…
      </p>
    )
  }
  if (state.status === 'unavailable') {
    return (
      <p className="text-[10px] text-muted-foreground">
        Cross-validation unavailable ({state.reason}).
      </p>
    )
  }

  const { folds, usableFolds, newBetterFolds, spread } = state.summary
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/10 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Cross-validation, fold by fold
      </p>
      <p className="text-xs text-foreground">
        The new configuration beat {current} on{' '}
        <span className="font-medium tabular-nums">{newBetterFolds}</span> of{' '}
        {usableFolds} usable folds
        {spread
          ? `; RMSE difference at lab events ranged ${signed(spread.min)} to ${signed(spread.max)}.`
          : '.'}
      </p>
      <p className="text-[10px] text-muted-foreground">
        {spread
          ? 'A range that stays below zero is a lead that holds across time; one that crosses zero is not separable from fold-to-fold noise.'
          : `No spread is stated: ${usableFolds} usable fold${usableFolds === 1 ? '' : 's'}, and at least ${MIN_SPREAD_FOLDS} are needed for a range to mean anything.`}{' '}
        Each fold refits the configuration on earlier data only; {current} is
        scored only on rows after its own test boundary. This does not change
        which candidate was picked.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Fold</TableHead>
            <TableHead className="text-right text-xs">Lab events</TableHead>
            <TableHead className="text-right text-xs">New RMSE</TableHead>
            <TableHead className="text-right text-xs">{current} RMSE</TableHead>
            <TableHead className="text-right text-xs">Difference</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {folds.map(f => (
            <TableRow key={f.fold}>
              <TableCell className="text-xs">
                {f.fold}
                {!f.usable && (
                  <span className="text-muted-foreground">
                    {' '}
                    (not used —{' '}
                    {f.scoredRows === 0
                      ? `all before ${current}'s boundary`
                      : 'fewer than 2 lab events'}
                    )
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums">
                {f.events}
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums">
                {fmt(f.newRmse)}
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums">
                {fmt(f.currentRmse)}
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums">
                {signed(f.delta)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
