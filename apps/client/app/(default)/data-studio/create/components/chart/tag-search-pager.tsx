// components/tag-search-pager.tsx
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { TAG_STATS_PAGE_SIZE } from '@/hooks/use-tag-stats'

interface Props {
  query: string
  onQueryChange: (q: string) => void
  page: number
  totalPages: number
  totalCount: number
  onPrev: () => void
  onNext: () => void
}

export function TagSearchPager({
  query,
  onQueryChange,
  page,
  totalPages,
  totalCount,
  onPrev,
  onNext,
}: Props) {
  return (
    <div className="flex items-center gap-2">
      {/* Search — only show when there are enough tags */}
      {totalCount > TAG_STATS_PAGE_SIZE && (
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3
                             -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            placeholder="Filter tags…"
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            className="h-7 w-full rounded-md border bg-background pl-7 pr-2.5 text-xs
                       placeholder:text-muted-foreground focus:outline-none
                       focus:ring-1 focus:ring-ring"
          />
        </div>
      )}

      {/* Pager */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <button
          onClick={onPrev}
          disabled={page === 0}
          className="rounded p-1 hover:bg-muted disabled:opacity-30"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="tabular-nums">
          {page + 1} / {totalPages}
        </span>
        <button
          onClick={onNext}
          disabled={page >= totalPages - 1}
          className="rounded p-1 hover:bg-muted disabled:opacity-30"
          aria-label="Next page"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
