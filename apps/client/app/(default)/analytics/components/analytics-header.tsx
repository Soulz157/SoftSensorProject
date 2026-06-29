'use client'

import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TimeRangeToggle } from '@/app/(default)/data-visualize/components/time-range-toggle'
import type { TimeRange } from '@/lib/mock-readings'
import type { Scope } from '@/lib/pipeline-metrics'
import type { Workspace } from '@/types'

interface Props {
  workspaces: Workspace[]
  scope: Scope
  onScopeChange: (scope: Scope) => void
  range: TimeRange
  onRangeChange: (range: TimeRange) => void
  onRefresh: () => void
}

const ALL_WORKSPACES = 'all'

export function AnalyticsHeader({
  workspaces,
  scope,
  onScopeChange,
  range,
  onRangeChange,
  onRefresh,
}: Props) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Data Integration
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pipeline health, tag management & live data flows across your
          workspaces
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={scope} onValueChange={onScopeChange}>
          <SelectTrigger className="h-9 w-52">
            <SelectValue placeholder="All Workspaces" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_WORKSPACES}>All Workspaces</SelectItem>
            {workspaces.map(ws => (
              <SelectItem key={ws.id} value={ws.id}>
                {ws.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <TimeRangeToggle value={range} onChange={onRangeChange} />

        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={onRefresh}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>
    </div>
  )
}
