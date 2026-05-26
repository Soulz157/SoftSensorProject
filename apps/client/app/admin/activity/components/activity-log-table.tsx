'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useActivityLog } from '@/hooks/admin/use-activity'
import { cn } from '@/lib/utils'

const LIMIT = 10

function ActivityRowsSkeleton() {
  return (
    <>
      {Array.from({ length: LIMIT }).map((_, i) => (
        <TableRow key={i}>
          <TableCell>
            <Skeleton className="h-4 w-32" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-48" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-5 w-16 rounded-full" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-36" />
          </TableCell>
        </TableRow>
      ))}
    </>
  )
}

export function ActivityLogTable() {
  const [page, setPage] = useState(1)
  const { data, loading, isFetching } = useActivityLog({ page, limit: LIMIT })

  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / LIMIT) || 1
  const items = data?.items ?? []

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Timestamp</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody
          className={cn(
            'transition-opacity duration-200',
            isFetching && data !== null && 'opacity-60',
          )}
        >
          {loading ? (
            <ActivityRowsSkeleton />
          ) : items.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={4}
                className="py-8 text-center text-sm text-muted-foreground"
              >
                No activity recorded yet.
              </TableCell>
            </TableRow>
          ) : (
            items.map(row => (
              <TableRow key={row.id}>
                <TableCell>
                  <span className="text-sm font-medium text-foreground">
                    {row.user.firstName} {row.user.lastName}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">
                    {row.user.email}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={row.action === 'LOGIN' ? 'default' : 'secondary'}
                  >
                    {row.action}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">
                    {format(new Date(row.createdAt), 'PP p')}
                  </span>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between border-t border-border px-4 py-3">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          Page {page} of {totalPages}
          {isFetching && data !== null && (
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          )}
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1 || isFetching}
          >
            Prev
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPage(p => p + 1)}
            disabled={page >= totalPages || isFetching}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
