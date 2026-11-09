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
import type { WriteBackDryRun } from '@/services/model-backfill'

const KIND_LABEL = { PREDICTION: 'predictions', LAB: 'lab values' } as const

/**
 * MODEL-SERVE-032. The last stop before a value lands in the plant historian,
 * filled from the server's DRY RUN (so the overwrite count is what PI holds
 * now, not a guess). It names the account the write is attributed to: PI
 * records the data source's stored login, not the person who pressed the
 * button, and a reader of PI's audit trail will see that account.
 */
export function WriteBackConfirmDialog({
  dryRun,
  writing,
  onConfirm,
  onCancel,
}: {
  dryRun: WriteBackDryRun | null
  writing: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <AlertDialog open={dryRun !== null} onOpenChange={o => !o && onCancel()}>
      <AlertDialogContent>
        {dryRun && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Write {KIND_LABEL[dryRun.kind]} to PI?
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3 text-sm">
                  <p>
                    {dryRun.pointCount.toLocaleString()} point
                    {dryRun.pointCount === 1 ? '' : 's'} will be written to{' '}
                    <span className="font-mono text-foreground">
                      {dryRun.tag}
                    </span>{' '}
                    on {dryRun.sourceName}.
                  </p>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>
                      <span className="font-medium text-foreground">
                        {dryRun.overwriteCount.toLocaleString()}
                      </span>{' '}
                      replace a value PI already holds
                    </li>
                    <li>
                      <span className="font-medium text-foreground">
                        {dryRun.newCount.toLocaleString()}
                      </span>{' '}
                      are new
                    </li>
                  </ul>
                  <p>
                    PI will record this as{' '}
                    <span className="font-mono text-foreground">
                      {dryRun.piAccount}
                    </span>
                    , the data source&apos;s stored account.
                  </p>
                  <p>
                    The values PI holds now are saved first, so this write can
                    be rolled back from the history.
                  </p>
                  {dryRun.busy && (
                    <p role="alert" className="text-destructive">
                      Another write to {dryRun.tag} is in progress. Wait for it
                      to finish.
                    </p>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={writing}>Cancel</AlertDialogCancel>
              <Button onClick={onConfirm} disabled={writing || dryRun.busy}>
                {writing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {writing ? 'Writing…' : 'Write to PI'}
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}
