'use client'

import { Cpu, TrendingUp } from 'lucide-react'
import type { ModelWithWorkspace } from '@/hooks/use-all-models'
import type { TimeRange } from '@/lib/mock-readings'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const RANGES: { value: TimeRange; label: string }[] = [
  { value: '24h', label: '24H' },
  { value: '7d', label: '7D' },
  { value: '1m', label: '1M' },
  { value: '1y', label: '1Y' },
]

interface Props {
  models: ModelWithWorkspace[]
  selectedId: string
  onSelectModel: (id: string) => void
  range: TimeRange
  onRange: (r: TimeRange) => void
  rmse: number
  tag: string
}

/** Model picker + time-range selector + dynamic RMSE KPI for the monitoring page. */
export function MonitoringToolbar({
  models,
  selectedId,
  onSelectModel,
  range,
  onRange,
  rmse,
  tag,
}: Props) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={selectedId} onValueChange={onSelectModel}>
          <SelectTrigger className="w-full max-w-75 md:w-auto">
            <Cpu className="h-4 w-4 text-muted-foreground" />
            <SelectValue placeholder="Select a model" />
          </SelectTrigger>
          <SelectContent>
            {models.map(m => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
                <span className="ml-1 text-muted-foreground">
                  · {m.workspaceName}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {tag && (
          <span className="rounded-full bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground">
            target: {tag}
          </span>
        )}

        <ToggleGroup
          type="single"
          value={range}
          onValueChange={v => v && onRange(v as TimeRange)}
          variant="outline"
          size="sm"
        >
          {RANGES.map(r => (
            <ToggleGroupItem key={r.value} value={r.value} className="px-3">
              {r.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {/* Dynamic KPI: RMSE over the visible window. */}
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-3 p-4">
        <div className="rounded-lg bg-chart-1/10 p-2">
          <TrendingUp className="h-5 w-5 text-chart-1" />
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Current RMSE
          </p>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-bold tabular-nums text-foreground">
              {rmse.toFixed(2)}
            </span>
            <span className="text-xs text-muted-foreground">units</span>
          </div>
        </div>
      </div>
    </div>
  )
}
