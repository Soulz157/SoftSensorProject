// components/tag-value-bar-chart.tsx
'use client'

import { BarChart3 } from 'lucide-react'
import { useTagStats } from '@/hooks/use-tag-stats'
import { TagSearchPager } from './tag-search-pager'
import { TagMiniChart } from './tag-mini-chart'
import { TagStatBox } from './tag-stat-box'
import type { Dataset } from '@/lib/preprocessing'

interface Props {
  dataset: Dataset
}

export function TagValueBarChart({ dataset }: Props) {
  const {
    allStats,
    flatRows,
    query,
    setQuery,
    page,
    setPage,
    pageStats,
    totalPages,
    selectedTag,
    setSelectedTag,
    selectedRow,
  } = useTagStats(dataset)

  if (allStats.length === 0) return null

  return (
    <div className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <BarChart3 className="h-4 w-4 shrink-0 text-muted-foreground" />
        <h2 className="text-sm font-medium text-foreground">
          All Data Distribution by Tag
        </h2>
        <span className="ml-auto text-xs text-muted-foreground">
          {allStats.length} tag{allStats.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Search + pagination */}
      <TagSearchPager
        query={query}
        onQueryChange={setQuery}
        page={page}
        totalPages={totalPages}
        totalCount={allStats.length}
        onPrev={() => setPage(page - 1)}
        onNext={() => setPage(page + 1)}
      />

      {pageStats.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 pt-4 lg:grid-cols-2">
          {pageStats.map(stat => (
            <TagMiniChart
              key={stat.tag}
              stat={stat}
              flatRows={flatRows}
              isSelected={stat.tag === selectedTag}
              onSelect={setSelectedTag}
            />
          ))}
        </div>
      ) : (
        <div
          className="flex h-[300px] items-center justify-center
                        text-sm text-muted-foreground"
        >
          No tags match &ldquo;{query}&rdquo;
        </div>
      )}

      {selectedRow && <TagStatBox row={selectedRow} />}
    </div>
  )
}
