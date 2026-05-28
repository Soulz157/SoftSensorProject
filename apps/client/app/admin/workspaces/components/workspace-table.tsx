'use client'

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { WorkspaceSettingsDialog } from './workspace-settings-dialog'
import { useAdminWorkspaces } from '@/hooks/admin/use-admin-workspaces'
import { cn } from '@/lib/utils'
import type { AdminWorkspace } from '@/types'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Settings } from 'lucide-react'
import { workspaceIcons, workspaceColors } from '@/store/workspace'
import { WorkspaceIconProps } from '@/types'

const LIMIT = 10

export function WorkspaceIcon({ iconId, colorId }: WorkspaceIconProps) {
  const selectedIcon = workspaceIcons.find(item => item.id === iconId)
  const Icon = selectedIcon?.icon

  const selectedColor = workspaceColors.find(item => item.id === colorId)
  const bgClass = selectedColor?.bg || 'bg-slate-500'

  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white text-xs font-semibold ${bgClass}`}
    >
      {Icon ? (
        <Icon className="h-4 w-4" />
      ) : (
        <span>{iconId?.charAt(0)?.toUpperCase() || '?'}</span>
      )}
    </span>
  )
}

function WorkspaceRowsSkeleton() {
  return (
    <>
      {Array.from({ length: LIMIT }).map((_, i) => (
        <TableRow key={i}>
          <TableCell>
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-6 rounded-full" />
              <Skeleton className="h-4 w-32" />
            </div>
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-1 h-3 w-40" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-8" />
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

interface WorkspaceTableProps {
  search: string
}

export function WorkspaceTable({ search }: WorkspaceTableProps) {
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<AdminWorkspace | null>(null)

  const { data, loading, isFetching, refetch } = useAdminWorkspaces({
    page,
    limit: LIMIT,
    search: search || undefined,
  })

  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / LIMIT) || 1
  const items = data?.items ?? []

  const ownerName = (w: AdminWorkspace) =>
    [w.owner.firstName, w.owner.lastName].filter(Boolean).join(' ') || '—'

  return (
    <>
      <div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Workspace</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead className="text-center">Models</TableHead>
              <TableHead>Created</TableHead>
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
              <WorkspaceRowsSkeleton />
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  No workspaces found.
                </TableCell>
              </TableRow>
            ) : (
              items.map(ws => (
                <TableRow key={ws.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <WorkspaceIcon colorId={ws.color} iconId={ws.icon} />
                      <span className="text-sm font-medium text-foreground">
                        {ws.name}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm font-medium text-foreground">
                      {ownerName(ws)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {ws.owner.email}
                    </p>
                  </TableCell>
                  <TableCell className="text-center tabular-nums text-sm text-muted-foreground">
                    {ws._count.models}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(ws.createdAt), {
                      addSuffix: true,
                    })}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title="Workspace settings"
                      onClick={() => setSelected(ws)}
                    >
                      <Settings className="h-3.5 w-3.5" />
                    </Button>
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

      {selected && (
        <WorkspaceSettingsDialog
          workspace={selected}
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
