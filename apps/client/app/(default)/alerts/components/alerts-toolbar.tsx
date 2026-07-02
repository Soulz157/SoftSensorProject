'use client'

import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ALERT_STATUS_LABEL,
  EMPTY_FILTERS,
  type AlertFilters,
  type AlertStatus,
} from '@/lib/alerts'

const STATUS_FILTER_ORDER: AlertStatus[] = [
  'failed',
  'alarm',
  'offline',
  'warning',
]

export function AlertsToolbar({
  filters,
  onChange,
  locations,
  types,
}: {
  filters: AlertFilters
  onChange: (next: AlertFilters) => void
  locations: string[]
  types: string[]
}) {
  const set = (patch: Partial<AlertFilters>) =>
    onChange({ ...filters, ...patch })

  const isFiltered =
    filters.status !== 'all' ||
    filters.location !== 'all' ||
    filters.type !== 'all' ||
    filters.search.trim() !== ''

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-50 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filters.search}
          onChange={e => set({ search: e.target.value })}
          placeholder="Search equipment or model…"
          className="h-9 pl-8"
        />
      </div>

      <Select
        value={filters.status}
        onValueChange={v => set({ status: v as AlertFilters['status'] })}
      >
        <SelectTrigger className="h-9 w-37.5">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          {STATUS_FILTER_ORDER.map(s => (
            <SelectItem key={s} value={s}>
              {ALERT_STATUS_LABEL[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.location}
        onValueChange={v => set({ location: v })}
      >
        <SelectTrigger className="h-9 w-47.5">
          <SelectValue placeholder="Location" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All locations</SelectItem>
          {locations.map(l => (
            <SelectItem key={l} value={l}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.type} onValueChange={v => set({ type: v })}>
        <SelectTrigger className="h-9 w-42.5">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All types</SelectItem>
          {types.map(t => (
            <SelectItem key={t} value={t}>
              {t}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {isFiltered && (
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-1.5 text-muted-foreground"
          onClick={() => onChange(EMPTY_FILTERS)}
        >
          <X className="h-3.5 w-3.5" />
          Clear
        </Button>
      )}
    </div>
  )
}
