'use client'

import { Loader2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  formatDriftActual,
  formatPlantTime,
  formatStored,
  KIND_LABEL,
} from '@/lib/backfill-history'
import type { UseRollback } from '@/hooks/model/use-rollback'

const plural = (n: number, word: string) =>
  `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

/**
 * MODEL-SERVE-032. Confirm a rollback from the server's DRY RUN.
 *
 * Two different refusals, shown differently on purpose:
 *  - a LATER overlapping write must be rolled back first. Nothing here can
 *    override it, so there is no tick box, only the batch to go and undo;
 *  - DRIFT (PI no longer holds what this write left) can be overridden, but
 *    only by an explicit tick, after listing the points that would be
 *    overwritten.
 */
export function RollbackDialog({ rollback }: { rollback: UseRollback }) {
  const { target, plan, checking, rolling, force, error } = rollback
  const busy = checking || rolling

  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={o => !o && !busy && rollback.cancel()}
    >
      <AlertDialogContent className="max-w-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Roll back this write?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              {checking && (
                <p className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking what PI holds now…
                </p>
              )}

              {plan && target && (
                <>
                  <p>
                    {KIND_LABEL[target.kind]} written to{' '}
                    <span className="font-mono text-foreground">
                      {plan.tag}
                    </span>{' '}
                    ({plural(plan.original.pointCount, 'point')}) will be put
                    back to what PI held before it:
                  </p>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>
                      <span className="font-medium text-foreground">
                        {plan.replaceCount.toLocaleString()}
                      </span>{' '}
                      restored to their earlier value
                    </li>
                    <li>
                      <span className="font-medium text-foreground">
                        {plan.removeCount.toLocaleString()}
                      </span>{' '}
                      removed (PI had no value there before)
                    </li>
                    {plan.skipCount > 0 && (
                      <li>
                        {plan.skipCount.toLocaleString()} already match, left as
                        they are
                      </li>
                    )}
                    {plan.blockedCount > 0 && (
                      <li>
                        {plan.blockedCount.toLocaleString()} hold a system state
                        in PI and will not be touched
                      </li>
                    )}
                  </ul>
                  <p>
                    PI will record this as{' '}
                    <span className="font-mono text-foreground">
                      {plan.piAccount}
                    </span>
                    . The rollback is added to the history.
                  </p>
                </>
              )}

              {plan?.blockedBy && (
                <p role="alert" className="text-destructive">
                  A later {plan.blockedBy.kind.toLowerCase()} write on this tag
                  ({plan.blockedBy.id.slice(0, 8)},{' '}
                  {formatPlantTime(plan.blockedBy.createdAt)}) overlaps this
                  range and has not been rolled back. Roll that one back first.
                </p>
              )}

              {plan && !plan.blockedBy && plan.driftCount > 0 && (
                <div className="space-y-2">
                  <p role="alert" className="text-destructive">
                    {plural(plan.driftCount, 'point')} in PI no longer hold what
                    this write left there. Rolling back would overwrite whatever
                    changed them.
                  </p>
                  <div className="max-h-40 overflow-auto rounded-md border border-border">
                    <table className="w-full text-xs">
                      <thead className="text-left text-muted-foreground">
                        <tr>
                          <th className="px-2 py-1 font-medium">Time</th>
                          <th className="px-2 py-1 font-medium">Written</th>
                          <th className="px-2 py-1 font-medium">PI now</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.drift.map(d => (
                          <tr key={d.timestamp} className="border-t">
                            <td className="px-2 py-1">
                              {formatPlantTime(d.timestamp)}
                            </td>
                            <td className="px-2 py-1 font-mono">
                              {formatStored(d.expected)}
                            </td>
                            <td className="px-2 py-1 font-mono">
                              {formatDriftActual(d.actual)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {plan.driftCount > plan.drift.length && (
                    <p className="text-xs">
                      Showing the first {plan.drift.length.toLocaleString()}.
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="rollback-force"
                      checked={force}
                      disabled={busy}
                      onCheckedChange={v => rollback.setForce(v === true)}
                    />
                    <Label
                      htmlFor="rollback-force"
                      className="text-sm font-normal text-foreground"
                    >
                      Overwrite those changes anyway
                    </Label>
                  </div>
                </div>
              )}

              {error && (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button
            onClick={() => void rollback.confirm()}
            disabled={busy || !rollback.canProceed}
          >
            {rolling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {rolling ? 'Rolling back…' : 'Roll back'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
