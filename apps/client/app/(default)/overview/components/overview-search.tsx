'use client'
import { useTheme } from 'next-themes'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { STATUS_COLORS, type NodeStatus } from '@/store/status-colors'

const STATUS_PILLS: {
  key: NodeStatus
  label: string
  color: string
  bg: string
}[] = [
  {
    key: 'alarm',
    label: 'Alarm',
    color: STATUS_COLORS.alarm,
    bg: 'rgba(239,68,68,0.18)',
  },
  {
    key: 'warning',
    label: 'Warning',
    color: STATUS_COLORS.warning,
    bg: 'rgba(245,158,11,0.18)',
  },
  {
    key: 'offline',
    label: 'Offline',
    color: STATUS_COLORS.offline,
    bg: 'rgba(113,113,122,0.18)',
  },
  {
    key: 'normal',
    label: 'Normal',
    color: STATUS_COLORS.normal,
    bg: 'rgba(34,197,94,0.18)',
  },
]

interface OverviewSearchProps {
  query: string
  onQueryChange: (q: string) => void
  activeStatuses: NodeStatus[]
  onStatusToggle: (s: NodeStatus) => void
}

export function OverviewSearch({
  query,
  onQueryChange,
  activeStatuses,
  onStatusToggle,
}: OverviewSearchProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== 'light'

  const hasFilter = query.length > 0 || activeStatuses.length > 0

  const clearAll = () => {
    onQueryChange('')
    // snapshot so we don't toggle while iterating
    const toRemove = [...activeStatuses]
    toRemove.forEach(s => onStatusToggle(s))
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2 sm:flex-nowrap',
        isDark
          ? 'bg-zinc-900 border-white/12 text-white'
          : 'bg-white border-black/10 text-foreground',
      )}
    >
      {/* Search input */}
      <Search
        className={cn(
          'h-3.5 w-3.5 shrink-0',
          isDark ? 'text-white/40' : 'text-muted-foreground',
        )}
      />
      <input
        type="search"
        value={query}
        onChange={e => onQueryChange(e.target.value)}
        placeholder="Search workspaces…"
        aria-label="Search workspaces by name"
        className={cn(
          'min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:opacity-50',
          isDark ? 'text-white' : 'text-foreground',
        )}
      />

      {/* Status filter pills */}
      <div
        className="flex items-center gap-1"
        role="group"
        aria-label="Filter by status"
      >
        {STATUS_PILLS.map(({ key, label, color, bg }) => {
          const active = activeStatuses.includes(key)
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              aria-label={`Filter by ${label}`}
              onClick={() => onStatusToggle(key)}
              className={cn(
                'flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium transition-all duration-150',
                active
                  ? 'text-white'
                  : isDark
                    ? 'text-white/50 hover:text-white/80'
                    : 'text-muted-foreground hover:text-foreground',
              )}
              style={
                active
                  ? {
                      backgroundColor: bg,
                      color,
                      boxShadow: `0 0 0 1px ${color}40`,
                    }
                  : undefined
              }
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: active ? color : 'currentColor',
                  opacity: active ? 1 : 0.4,
                }}
                aria-hidden="true"
              />
              {label}
            </button>
          )
        })}
      </div>

      {/* Clear all */}
      {hasFilter && (
        <button
          type="button"
          aria-label="Clear all filters"
          onClick={clearAll}
          className={cn(
            'shrink-0 rounded-full p-0.5 transition-colors',
            isDark
              ? 'text-white/40 hover:text-white/70'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
