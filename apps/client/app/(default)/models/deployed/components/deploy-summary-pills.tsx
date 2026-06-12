import { Activity, AlertCircle, PauseCircle, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DeployCounts, DeployStatus } from '@/lib/model-status'

interface Props {
  counts: DeployCounts
  active: DeployStatus | null
  onToggle: (key: DeployStatus) => void
}

const PILLS = [
  {
    key: 'running' as DeployStatus,
    label: 'Running',
    icon: Activity,
    cls: 'bg-emerald-500/10 text-emerald-500',
  },
  {
    key: 'initializing' as DeployStatus,
    label: 'Initializing',
    icon: RefreshCw,
    cls: 'bg-blue-500/10 text-blue-400',
  },
  {
    key: 'stopped' as DeployStatus,
    label: 'Stopped',
    icon: PauseCircle,
    cls: 'bg-zinc-500/10 text-zinc-400',
  },
  {
    key: 'error' as DeployStatus,
    label: 'Failed',
    icon: AlertCircle,
    cls: 'bg-red-500/10 text-red-500',
  },
]

export function DeploySummaryPills({ counts, active, onToggle }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {PILLS.map(({ key, label, icon: Icon, cls }) => {
        const count = counts[key]
        const isActive = active === key
        return (
          <button
            key={key}
            onClick={() => onToggle(key)}
            disabled={count === 0 && !isActive}
            className={cn(
              'inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all',
              cls,
              isActive
                ? 'opacity-100 ring-2 ring-current ring-offset-1'
                : count === 0
                  ? 'cursor-default opacity-35'
                  : 'hover:opacity-80',
            )}
          >
            <Icon
              className={cn(
                'h-3 w-3',
                key === 'initializing' && count > 0 && 'animate-spin',
              )}
            />
            {label}
            <span className="ml-0.5 font-bold tabular-nums">{count}</span>
          </button>
        )
      })}
    </div>
  )
}
