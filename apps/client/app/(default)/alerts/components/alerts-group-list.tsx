'use client'

import { Fragment, useState } from 'react'
import type { AlertGroup } from '@/lib/alerts'
import type { Workspace } from '@/types'
import { Table, TableBody } from '@/components/ui/table'
import { AlertsListHeader } from './alerts-list-header'
import { AlertsGroupHeader } from './alerts-group-header'
import { AlertRow } from './alert-row'

export function AlertsGroupList({
  groups,
  workspaces,
}: {
  groups: AlertGroup[]
  workspaces: Workspace[]
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  if (groups.length === 0) {
    return (
      <div className="rounded-xl bg-muted/30 p-10 text-center text-sm text-muted-foreground ring-1 ring-foreground/10">
        No alerts match the current filters.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
      <Table>
        <AlertsListHeader />
        <TableBody>
          {groups.map(group => {
            const isCollapsed = collapsed[group.workspaceId] ?? false
            const workspaceIcon = workspaces.find(
              w => w.id === group.workspaceId,
            )?.icon

            return (
              <Fragment key={group.workspaceId}>
                <AlertsGroupHeader
                  workspaceName={group.workspaceName}
                  workspaceIcon={workspaceIcon}
                  count={group.rows.length}
                  collapsed={isCollapsed}
                  onToggle={() =>
                    setCollapsed(prev => ({
                      ...prev,
                      [group.workspaceId]: !isCollapsed,
                    }))
                  }
                />
                {!isCollapsed &&
                  group.rows.map(row => (
                    <AlertRow key={`${row.kind}-${row.id}`} row={row} />
                  ))}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
