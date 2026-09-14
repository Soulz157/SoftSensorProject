'use client'

import { useAtom } from 'jotai'
import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { mpSelectedMetricsAtom } from '@/store/model-pipeline'
import {
  METRIC_KEYS,
  METRIC_META,
  toggleMetricSelection,
} from '@/lib/model-metrics'

/** One picker, one atom — a second copy with its own state is how two
 *  surfaces start disagreeing about what a metric is called. */
export function MetricsPicker() {
  const [selectedMetrics, setSelectedMetrics] = useAtom(mpSelectedMetricsAtom)
  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Metrics
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-full">
          <DropdownMenuLabel>Show metrics</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {METRIC_KEYS.map(key => (
            <DropdownMenuCheckboxItem
              key={key}
              checked={selectedMetrics.includes(key)}
              disabled={
                selectedMetrics.length === 1 && selectedMetrics.includes(key)
              }
              onCheckedChange={on =>
                setSelectedMetrics(prev => toggleMetricSelection(prev, key, on))
              }
            >
              {METRIC_META[key].label} — {METRIC_META[key].hint}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
