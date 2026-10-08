'use client'

import { useId } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { activityVerb } from '@/lib/admin-dashboard'
import type { ActivityLog } from '@/types'
import type { LoadState } from './attention-queue'

/** The latest sign-ins and sign-outs (admin activity is authentication). */
export function RecentActivity({
  state,
  items,
  onRetry,
}: {
  state: LoadState
  items: ActivityLog[]
  onRetry: () => void
}) {
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      aria-busy={state === 'loading'}
      className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id={headingId} className="text-base font-medium">
          Recent activity
        </h2>
        <Link
          href="/admin/activity"
          className="rounded-sm text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          View all activity
        </Link>
      </div>

      {state === 'loading' ? (
        <>
          <p role="status" className="sr-only">
            Loading recent activity
          </p>
          <ul aria-hidden className="space-y-2.5">
            {[0, 1, 2, 3].map(i => (
              <li key={i}>
                <Skeleton className="h-4 w-full" />
              </li>
            ))}
          </ul>
        </>
      ) : state === 'error' ? (
        <div role="alert" className="space-y-2 text-sm">
          <p className="text-muted-foreground">Couldn&apos;t load activity.</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sign-ins yet.</p>
      ) : (
        <ul role="list" className="space-y-2">
          {items.map(a => (
            <li
              key={a.id}
              className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 text-sm"
            >
              <time
                dateTime={a.createdAt}
                className="font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums"
              >
                {format(new Date(a.createdAt), 'd MMM HH:mm')}
              </time>
              <span className="truncate">
                <span className="font-medium">
                  {`${a.user.firstName} ${a.user.lastName}`.trim() ||
                    a.user.email}
                </span>{' '}
                <span className="text-muted-foreground">
                  {activityVerb(a.action)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
