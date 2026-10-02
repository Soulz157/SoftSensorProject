'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useLabEventCount } from '@/hooks/model/use-lab-event-count'
import {
  pairedEvents,
  SMALL_EVENT_COUNT,
  type LabEventSource,
} from '@/lib/retrain-lab-events'
import type { LabEventIds } from './basis-lab-events'

const fmt = (v: number) => v.toFixed(3)

/**
 * MODEL-SERVE-026-T04. The two versions compared EVENT BY EVENT on the shared
 * window. The summary is a win count, not an interval; at a small event count
 * the per-event table is shown open, because it IS the result — a mean can be
 * carried by one large win against several small losses, which the table
 * shows and the mean hides. Rendered only where both versions were scored on
 * the same window (`pairableOnSharedWindow`).
 */
export function RetrainPairedEvents({
  ids,
  currentVersion,
}: {
  ids: LabEventIds
  currentVersion: number | null
}) {
  const source = (
    population: 'new_data_holdout' | 'current_new_data_holdout',
  ): LabEventSource =>
    ids.candidateRunId
      ? { kind: 'series', runId: ids.candidateRunId, population }
      : { kind: 'unavailable', reason: 'no finished new version' }
  const candidate = useLabEventCount(ids.modelId, source('new_data_holdout'))
  const current = useLabEventCount(
    ids.modelId,
    source('current_new_data_holdout'),
  )
  const paired = useMemo(
    () =>
      candidate.status === 'ready' && current.status === 'ready'
        ? pairedEvents(candidate.points, current.points)
        : null,
    [candidate, current],
  )
  const [expanded, setExpanded] = useState<boolean | null>(null)

  const currentLabel =
    currentVersion !== null
      ? `current v${currentVersion}`
      : 'the current version'

  if (candidate.status === 'unavailable' || current.status === 'unavailable') {
    const reason =
      candidate.status === 'unavailable'
        ? candidate.reason
        : current.status === 'unavailable'
          ? current.reason
          : ''
    return (
      <p className="text-[10px] text-muted-foreground">
        Event-by-event comparison unavailable ({reason}).
      </p>
    )
  }
  if (!paired) {
    return (
      <p className="text-[10px] text-muted-foreground">
        Comparing event by event…
      </p>
    )
  }

  const n = paired.events.length
  const open = expanded ?? n <= SMALL_EVENT_COUNT

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/10 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Event by event, on the same window
      </p>
      <p className="text-xs text-foreground">
        The new version was closer on{' '}
        <span className="font-medium tabular-nums">{paired.candidateWins}</span>{' '}
        of {n} lab events; {currentLabel} was closer on{' '}
        <span className="font-medium tabular-nums">{paired.currentWins}</span>
        {paired.ties > 0 ? `; ${paired.ties} tied` : ''}.
      </p>
      <p className="text-[10px] text-muted-foreground">
        A mean error can be carried by one large win against several small
        losses — the table shows which. No confidence interval is given: {n}{' '}
        events on a slowly changing target are too few to support one.
        {paired.unmatched > 0
          ? ` ${paired.unmatched} event${paired.unmatched === 1 ? '' : 's'} had no matching row for ${currentLabel} and ${paired.unmatched === 1 ? 'is' : 'are'} left out.`
          : ''}
      </p>
      {n > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setExpanded(!open)}
        >
          {open ? 'Hide the events' : `Show all ${n} events`}
        </Button>
      )}
      {open && n > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Time</TableHead>
              <TableHead className="text-right text-xs">Lab value</TableHead>
              <TableHead className="text-right text-xs">New</TableHead>
              <TableHead className="text-right text-xs">Current</TableHead>
              <TableHead className="text-right text-xs">New error</TableHead>
              <TableHead className="text-right text-xs">
                Current error
              </TableHead>
              <TableHead className="text-xs">Closer</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paired.events.map(e => (
              <TableRow key={e.timestamp}>
                <TableCell className="text-xs">
                  {new Date(e.timestamp).toLocaleString()}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {fmt(e.yTrue)}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {fmt(e.candidatePred)}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {fmt(e.currentPred)}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {fmt(e.candidateAbsError)}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {fmt(e.currentAbsError)}
                </TableCell>
                <TableCell className="text-xs">
                  {e.winner === 'candidate'
                    ? 'New'
                    : e.winner === 'current'
                      ? 'Current'
                      : 'Tie'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
