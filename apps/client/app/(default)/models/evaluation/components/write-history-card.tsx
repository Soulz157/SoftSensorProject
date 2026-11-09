'use client'

import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useRollback } from '@/hooks/model/use-rollback'
import { useWriteBackBatch } from '@/hooks/model/use-write-back-batch'
import { useWriteBackConfig } from '@/hooks/model/use-write-back-config'
import { useWriteBackHistory } from '@/hooks/model/use-write-back-history'
import {
  formatPlantTime,
  formatRange,
  formatStored,
  KIND_LABEL,
  rollbackBlocker,
} from '@/lib/backfill-history'
import type { WriteBackHistoryItem } from '@/services/model-backfill'
import { RollbackDialog } from './rollback-dialog'
import { WriteStatusBadge } from './write-status-badge'

function BatchValues({
  modelId,
  batchId,
}: {
  modelId: string
  batchId: string
}) {
  const { detail, loading, error } = useWriteBackBatch(modelId, batchId, true)
  if (loading && !detail) return <Skeleton className="h-24 w-full" />
  if (error && !detail) {
    return <p className="text-sm text-destructive">{error}</p>
  }
  if (!detail) return null
  if (detail.values.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No values were recorded: this write was refused before it changed PI.
        {detail.batch.error ? ` ${detail.batch.error}` : ''}
      </p>
    )
  }
  return (
    <div className="space-y-2">
      {detail.batch.error && (
        <p className="text-sm text-foreground">{detail.batch.error}</p>
      )}
      {detail.batch.rollbacks.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Rolled back by {detail.batch.rollbacks.length} rollback
          {detail.batch.rollbacks.length === 1 ? '' : 's'} (latest{' '}
          {formatPlantTime(detail.batch.rollbacks[0]?.createdAt ?? '')}).
        </p>
      )}
      <div className="max-h-72 overflow-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead className="text-right">Before</TableHead>
              <TableHead className="text-right">Sent</TableHead>
              <TableHead className="text-right">After (read back)</TableHead>
              <TableHead>Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.values.map(v => (
              <TableRow key={v.timestamp}>
                <TableCell>{formatPlantTime(v.timestamp)}</TableCell>
                <TableCell className="text-right font-mono">
                  {formatStored(v.beforeValue, v.beforeExisted)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {v.sentValue === null ? 'removed' : String(v.sentValue)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatStored(v.afterValue)}
                </TableCell>
                <TableCell>
                  {v.itemOk ? 'Verified' : (v.itemError ?? 'Not verified')}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

/**
 * MODEL-SERVE-032. Every write and rollback against this model's PI output
 * tags, newest first. Anyone who can see the model reads it; the Rollback
 * button is enabled for a workspace owner or admin only, and a disabled one
 * says why. A row expands to the per-point before / sent / after values that
 * rollback restores from.
 */
export function WriteHistoryCard({
  modelId,
  refreshKey,
}: {
  modelId: string
  /** Bump to re-read the first page after a write. */
  refreshKey: number
}) {
  const [bump, setBump] = useState(0)
  const history = useWriteBackHistory(modelId, refreshKey + bump)
  const cfg = useWriteBackConfig(modelId)
  const rollback = useRollback({
    modelId,
    onDone: () => setBump(n => n + 1),
  })
  const [openId, setOpenId] = useState<string | null>(null)
  const canWrite = cfg.view?.canWrite ?? false

  return (
    <Card className="border-border bg-card">
      <CardContent className="space-y-3 pt-5">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Write history
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            What PI held before and after each write. Times are plant time.
          </p>
        </div>

        {history.loading && history.batches.length === 0 ? (
          <Skeleton className="h-24 w-full" />
        ) : history.error && history.batches.length === 0 ? (
          <p className="text-sm text-destructive">{history.error}</p>
        ) : history.batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing has been written to PI for this model yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>When</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Tag</TableHead>
                  <TableHead>Range</TableHead>
                  <TableHead className="text-right">Points</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Rollback</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.batches.map(b => (
                  <HistoryRow
                    key={b.id}
                    modelId={modelId}
                    batch={b}
                    open={openId === b.id}
                    onToggle={() => setOpenId(openId === b.id ? null : b.id)}
                    blocker={rollbackBlocker(b, canWrite)}
                    onRollback={() => void rollback.prepare(b)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {history.error && history.batches.length > 0 && (
          <p className="text-sm text-destructive">{history.error}</p>
        )}
        {history.hasMore && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void history.loadMore()}
            disabled={history.loadingMore}
          >
            {history.loadingMore && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Load older
          </Button>
        )}
      </CardContent>
      <RollbackDialog rollback={rollback} />
    </Card>
  )
}

function HistoryRow({
  modelId,
  batch: b,
  open,
  onToggle,
  blocker,
  onRollback,
}: {
  modelId: string
  batch: WriteBackHistoryItem
  open: boolean
  onToggle: () => void
  blocker: string | null
  onRollback: () => void
}) {
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <Fragment>
      <TableRow>
        <TableCell>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} values for the ${formatPlantTime(b.createdAt)} write`}
            onClick={onToggle}
          >
            <Chevron className="h-4 w-4" />
          </Button>
        </TableCell>
        <TableCell className="whitespace-nowrap">
          {formatPlantTime(b.createdAt)}
        </TableCell>
        <TableCell>{b.createdBy ?? 'Removed user'}</TableCell>
        <TableCell>
          {KIND_LABEL[b.kind]}
          {b.rollbackOfId && (
            <span className="block text-xs text-muted-foreground">
              of {b.rollbackOfId.slice(0, 8)}
            </span>
          )}
        </TableCell>
        <TableCell className="font-mono">{b.tag}</TableCell>
        <TableCell className="whitespace-nowrap text-xs">
          {formatRange(b.rangeFrom, b.rangeTo)}
        </TableCell>
        <TableCell className="text-right">
          {b.okCount.toLocaleString()} / {b.pointCount.toLocaleString()}
        </TableCell>
        <TableCell>
          <WriteStatusBadge status={b.status} />
        </TableCell>
        <TableCell className="text-right">
          <div className="flex flex-col items-end gap-0.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1"
              disabled={blocker !== null}
              onClick={onRollback}
            >
              <Undo2 className="h-3.5 w-3.5" />
              Roll back
            </Button>
            {blocker && (
              <span className="max-w-48 text-[11px] text-muted-foreground">
                {blocker}
              </span>
            )}
          </div>
        </TableCell>
      </TableRow>
      {open && (
        <TableRow>
          <TableCell />
          <TableCell colSpan={8}>
            <BatchValues modelId={modelId} batchId={b.id} />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  )
}
