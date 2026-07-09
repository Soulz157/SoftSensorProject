'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { toChartRows, type Dataset } from '@/lib/preprocessing'
import { badDataByTag, badDataDetailByTag } from '@/lib/data-quality'
import type { TimeRange } from '@/lib/mock-readings'
import { RawTrendChart } from './chart/raw-data-chart'
import { TrendControlBar } from './trend-control-bar'
import { TrendTagSidebar } from './trend-tag-sidebar'

interface Props {
  /** Live pre-cleansed dataset — reflects current crop + outlier rules. */
  dataset: Dataset
  range: TimeRange
}

export function RawTrendSection({ dataset, range }: Props) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [hoveredTag, setHoveredTag] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  const toggleTag = (tag: string) => {
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  const visibleTags = dataset.tags.filter(t => !hidden.has(t))
  const badByTag = useMemo(() => badDataByTag(dataset), [dataset])
  const badDetailByTag = useMemo(() => badDataDetailByTag(dataset), [dataset])

  return (
    <div className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div
        className={cn(
          'grid gap-4',
          sidebarOpen ? 'grid-cols-1 lg:grid-cols-[1fr_280px]' : 'grid-cols-1',
        )}
      >
        <RawTrendChart
          rows={toChartRows(dataset)}
          tags={visibleTags}
          range={range}
          hideTagSelector
          hoveredTag={hoveredTag}
        />
        <TrendControlBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelectAll={() => setHidden(new Set())}
          onClearAll={() => setHidden(new Set(dataset.tags))}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(o => !o)}
        />
        {sidebarOpen && (
          <TrendTagSidebar
            tags={dataset.tags}
            visibleTags={visibleTags}
            hidden={hidden}
            searchQuery={searchQuery}
            badByTag={badByTag}
            badDetailByTag={badDetailByTag}
            onToggle={toggleTag}
            onHoverTag={setHoveredTag}
          />
        )}
      </div>
    </div>
  )
}
