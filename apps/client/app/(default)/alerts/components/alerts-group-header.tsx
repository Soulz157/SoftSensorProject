'use client'

import { Building2, ChevronDown, ChevronRight } from 'lucide-react'
import { workspaceIcons } from '@/store/workspace'
import { TableCell, TableRow } from '@/components/ui/table'

const COLUMN_COUNT = 8 // must match <TableHead> count in AlertsListHeader

export function AlertsGroupHeader({
  workspaceName,
  workspaceIcon,
  count,
  collapsed,
  onToggle,
}: {
  workspaceName: string
  workspaceIcon?: string
  count: number
  collapsed: boolean
  onToggle: () => void
}) {
  const Icon =
    workspaceIcons.find(i => i.id === workspaceIcon)?.icon ?? Building2

  return (
    <TableRow className="sticky top-0 z-10 bg-muted hover:bg-muted">
      <TableCell colSpan={COLUMN_COUNT} className="p-0">
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center gap-2 border-b border-foreground/10 px-3 py-2.5 text-left"
        >
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">
            Workspace: {workspaceName}
            <span className="text-red-500 font-semibold">
              ({count} Alert{count === 1 ? '' : 's'})
            </span>
          </span>
          <span className="ml-auto shrink-0 text-muted-foreground">
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </span>
        </button>
      </TableCell>
    </TableRow>
  )
}
