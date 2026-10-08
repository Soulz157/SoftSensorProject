'use client'

import { useId } from 'react'
import Link from 'next/link'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ATTENTION_TEXT } from '@/components/workspace/workspace-parts'
import { equipmentParts, ownerName } from '@/lib/admin-dashboard'
import type { AdminWorkspaceSummary } from '@/types'
import { cn } from '@/lib/utils'

export type LoadState = 'loading' | 'error' | 'ready'

/**
 * Workspaces whose equipment is in alarm. Equipment only — the admin API does
 * not know model-level status, so the heading says so. An empty queue is
 * neutral text, not a green all-clear; a failed load is an error, never an
 * empty (and therefore "healthy") queue.
 */
export function AttentionQueue({
  state,
  items,
  total,
  onRetry,
}: {
  state: LoadState
  items: AdminWorkspaceSummary['attention']
  /** Every workspace in alarm — `items` lists only the worst few. */
  total: number
  onRetry: () => void
}) {
  const headingId = useId()
  const more = Math.max(0, total - items.length)
  return (
    <section
      aria-labelledby={headingId}
      aria-busy={state === 'loading'}
      className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id={headingId} className="text-base font-medium">
          Needs attention
        </h2>
        <span className="text-xs text-muted-foreground">Equipment status</span>
      </div>

      {state === 'loading' ? (
        <>
          <p role="status" className="sr-only">
            Loading workspaces that need attention
          </p>
          <ul aria-hidden className="space-y-3">
            {[0, 1].map(i => (
              <li key={i} className="space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </li>
            ))}
          </ul>
        </>
      ) : state === 'error' ? (
        <div role="alert" className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Couldn&apos;t load which workspaces need attention.
          </p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No workspace needs attention.
        </p>
      ) : (
        <ul role="list" className="divide-y divide-border">
          {items.map(w => (
            <li key={w.id} className="relative py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-start gap-2">
                <TriangleAlert
                  className={cn('mt-0.5 size-4 shrink-0', ATTENTION_TEXT)}
                  aria-hidden
                />
                <div className="min-w-0">
                  <Link
                    href={`/admin/workspaces/${w.id}/settings`}
                    title={w.name}
                    className="block truncate rounded-sm text-sm font-medium after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {w.name}
                  </Link>
                  {/* Only the alarm part is coloured; warnings and offline
                      equipment are listed but never read as alarms. */}
                  <p className="text-xs text-muted-foreground">
                    {(() => {
                      const { alarm, other } = equipmentParts(w)
                      return (
                        <>
                          {alarm && (
                            <span className={ATTENTION_TEXT}>{alarm}</span>
                          )}
                          {alarm && other && ' · '}
                          {other}
                        </>
                      )
                    })()}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    Owner: {ownerName(w.owner)}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {state === 'ready' && more > 0 && (
        <p className="text-xs text-muted-foreground">
          and {more} more {more === 1 ? 'workspace' : 'workspaces'} in alarm —
          find {more === 1 ? 'it' : 'them'} in the list.
        </p>
      )}
    </section>
  )
}
