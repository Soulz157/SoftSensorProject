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
import { AlertDateRangeFilter } from './alert-date-range-filter'

const STATUS_FILTER_ORDER: AlertStatus[] = [
  'failed',
  'alarm',
  'offline',
  'warning',
]

export function AlertsToolbar({
  filters,
  onChange,
}: {
  filters: AlertFilters
  onChange: (next: AlertFilters) => void
}) {
  const set = (patch: Partial<AlertFilters>) =>
    onChange({ ...filters, ...patch })

  const isFiltered =
    filters.status !== 'all' ||
    filters.search.trim() !== '' ||
    filters.dateFrom !== null ||
    filters.dateTo !== null

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
        <SelectTrigger className="h-9 w-45" aria-label="Filter by severity">
          <SelectValue placeholder="Filter by Severity" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All severities</SelectItem>
          {STATUS_FILTER_ORDER.map(s => (
            <SelectItem key={s} value={s}>
              {ALERT_STATUS_LABEL[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <AlertDateRangeFilter
        dateFrom={filters.dateFrom}
        dateTo={filters.dateTo}
        onChange={(dateFrom, dateTo) => set({ dateFrom, dateTo })}
      />

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
