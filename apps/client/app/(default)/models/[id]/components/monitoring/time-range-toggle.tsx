'use client'

import type { TimeRange } from '@/lib/mock-readings'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const RANGES: { value: TimeRange; label: string }[] = [
  { value: '24h', label: '24H' },
  { value: '7d', label: '7D' },
  { value: '1m', label: '1M' },
  { value: '1y', label: '1Y' },
]

interface Props {
  range: TimeRange
  onRange: (r: TimeRange) => void
}

/** Shared 24H/7D/1M/1Y range toggle — the Monitoring and Input Data tabs
 *  each hold their own `range` state and pass it through here. */
export function TimeRangeToggle({ range, onRange }: Props) {
  return (
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
  )
}
