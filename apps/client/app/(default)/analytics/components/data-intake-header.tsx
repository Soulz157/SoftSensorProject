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
import { TimeRangeToggle } from '@/components/charts/time-range-toggle'
import type { Scope } from '@/lib/data-intake'
import type { IntakeRange } from '@/types/data-intake'
import type { Workspace } from '@/types'
import { cn } from '@/lib/utils'

interface Props {
  workspaces: Workspace[]
  /** Admins only: the workspace picker. A user stays on the workspace they
   *  opened. */
  showScopeSelect: boolean
  scope: Scope
  onScopeChange: (scope: Scope) => void
  range: IntakeRange
  onRangeChange: (range: IntakeRange) => void
  onRefresh: () => void
  isFetching: boolean
}

const ALL_WORKSPACES = 'all'

export function DataIntakeHeader({
  workspaces,
  showScopeSelect,
  scope,
  onScopeChange,
  range,
  onRangeChange,
  onRefresh,
  isFetching,
}: Props) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-[clamp(1.5rem,2.5vw,2rem)] leading-tight font-semibold tracking-[-0.02em] text-foreground">
          Data Intake
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Live tag quality, ingested volume and dataset storage
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {showScopeSelect && (
          <Select value={scope} onValueChange={onScopeChange}>
            <SelectTrigger className="h-9 w-52" aria-label="Workspace">
              <SelectValue placeholder="All workspaces" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_WORKSPACES}>All workspaces</SelectItem>
              {workspaces.map(ws => (
                <SelectItem key={ws.id} value={ws.id}>
                  {ws.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <TimeRangeToggle value={range} onChange={onRangeChange} />

        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={onRefresh}
          disabled={isFetching}
        >
          <RefreshCw
            aria-hidden
            className={cn('size-3.5', isFetching && 'animate-spin')}
          />
          Refresh
        </Button>
      </div>
    </div>
  )
}
