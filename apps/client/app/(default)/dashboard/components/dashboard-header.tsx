'use client'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DashboardHeaderProps {
  alarmCount: number
  searchQuery: string
  onSearch: (q: string) => void
}

export function DashboardHeader({
  alarmCount,
  searchQuery,
  onSearch,
}: DashboardHeaderProps) {
  const isHealthy = alarmCount === 0

  return (
    <header className="flex items-center gap-3 border-b border-border bg-[#0a0d14] px-4 py-2">
      <span className="text-[11px] font-extrabold uppercase tracking-widest text-primary">
        SoftSensor
      </span>

      <div className="flex max-w-55 flex-1 items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-1.5 text-[9px] text-muted-foreground">
        <Search className="h-3 w-3 shrink-0" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => onSearch(e.target.value)}
          placeholder="Search devices, zones..."
          className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground/50"
        />
      </div>

      <div
        className={cn(
          'flex items-center gap-1.5 rounded-full border px-3 py-1 text-[9px] font-semibold',
          isHealthy
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
            : 'border-red-500/30 bg-red-500/10 text-red-400',
        )}
      >
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            isHealthy ? 'bg-emerald-500' : cn('bg-red-500', 'animate-pulse'),
          )}
        />
        {isHealthy
          ? 'All Systems Healthy'
          : `${alarmCount} Active Alarm${alarmCount > 1 ? 's' : ''}`}
      </div>

      <div className="ml-auto flex h-7 w-7 items-center justify-center rounded-full bg-linear-to-br from-primary to-violet-600 text-[9px] font-bold text-white">
        DT
      </div>
    </header>
  )
}
