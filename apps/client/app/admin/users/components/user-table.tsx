'use client'

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAdminUsers } from '@/hooks/admin/use-admin-users'
import { UserActionsDialog } from './user-actions-dialog'
import { cn } from '@/lib/utils'
import type { AdminUser } from '@/types'

const LIMIT = 10

function getInitials(firstName: string | null, lastName: string | null) {
  const f = firstName?.[0] ?? ''
  const l = lastName?.[0] ?? ''
  return (f + l).toUpperCase() || '?'
}

function roleBadge(role: string) {
  const map: Record<string, string> = {
    ADMIN:
      'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
    USER: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  }
  return map[role] ?? map['USER']
}

function statusLabel(user: AdminUser) {
  if (user.deletedAt)
    return {
      label: 'Deleted',
      cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    }
  if (user.blockedAt)
    return {
      label: 'Blocked',
      cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    }
  return {
    label: 'Active',
    cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  }
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function UserRowsSkeleton() {
  return (
    <>
      {Array.from({ length: LIMIT }).map((_, i) => (
        <TableRow key={i}>
          <TableCell>
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div>
                <Skeleton className="h-4 w-28" />
                <Skeleton className="mt-1 h-3 w-36" />
              </div>
            </div>
          </TableCell>
          <TableCell>
            <Skeleton className="h-5 w-14 rounded-full" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-5 w-16 rounded-full" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-5 w-14 rounded-full" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-6" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-20" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-7 w-7 rounded-md" />
          </TableCell>
        </TableRow>
      ))}
    </>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface UserTableProps {
  search: string
  role?: string
  status?: string
}

// ─── Component ───────────────────────────────────────────────────────────────

export function UserTable({ search, role, status }: UserTableProps) {
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<AdminUser | null>(null)

  const { data, loading, isFetching, refetch } = useAdminUsers({
    page,
    limit: LIMIT,
    search: search || undefined,
    role: role || undefined,
    status: status || undefined,
  })

  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / LIMIT) || 1
  const items = data?.items ?? []

  return (
    <>
      <div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-center">Workspaces</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody
            className={cn(
              'transition-opacity duration-200',
              isFetching && data !== null && 'opacity-60',
            )}
          >
            {loading ? (
              <UserRowsSkeleton />
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  No users found.
                </TableCell>
              </TableRow>
            ) : (
              items.map(user => {
                const { label, cls } = statusLabel(user)
                const fullName =
                  [user.firstName, user.lastName].filter(Boolean).join(' ') ||
                  '—'
                return (
                  <TableRow key={user.id}>
                    {/* User */}
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                          {getInitials(user.firstName, user.lastName)}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {fullName}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {user.email}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    {/* Role */}
                    <TableCell>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                          roleBadge(user.role),
                        )}
                      >
                        {user.role}
                      </span>
                    </TableCell>
                    {/* Status */}
                    <TableCell>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                          cls,
                        )}
                      >
                        {label}
                      </span>
                    </TableCell>
                    {/* Plan */}
                    <TableCell>
                      {user.subscriptions?.[0]?.plan?.name ? (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary">
                          {user.subscriptions[0].plan.name}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {/* Workspaces */}
                    <TableCell className="text-center tabular-nums text-sm text-muted-foreground">
                      {user._count.workspaces}
                    </TableCell>
                    {/* Joined */}
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDistanceToNow(new Date(user.createdAt), {
                        addSuffix: true,
                      })}
                    </TableCell>
                    {/* Actions */}
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title="User settings"
                        onClick={() => setSelected(user)}
                      >
                        <Settings className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
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

      {selected && (
        <UserActionsDialog
          user={selected}
          open={selected !== null}
          onOpenChange={open => {
            if (!open) setSelected(null)
          }}
          onSuccess={() => {
            refetch()
            setSelected(null)
          }}
        />
      )}
    </>
  )
}
