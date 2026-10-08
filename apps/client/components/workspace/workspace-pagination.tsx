import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { WorkspacePage } from '@/lib/workspace-list'

/**
 * "16–30 of 50" with Previous / Next. Renders nothing for a single page.
 * The ends use `aria-disabled`, not `disabled`: pressing Next onto the last
 * page must not drop keyboard focus to <body>.
 */
export function WorkspacePagination({
  page,
  onPage,
  label = 'Workspaces pagination',
}: {
  page: WorkspacePage<unknown>
  onPage: (p: number) => void
  label?: string
}) {
  if (page.pageCount <= 1) return null
  const atStart = page.page <= 1
  const atEnd = page.page >= page.pageCount
  return (
    <nav
      aria-label={label}
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <p
        className="font-mono text-sm text-muted-foreground tabular-nums"
        aria-live="polite"
      >
        {page.from}–{page.to} of {page.total}
      </p>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          Page {page.page} of {page.pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          aria-disabled={atStart}
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          onClick={() => {
            if (!atStart) onPage(page.page - 1)
          }}
          aria-label="Previous page"
        >
          <ChevronLeft />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-disabled={atEnd}
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          onClick={() => {
            if (!atEnd) onPage(page.page + 1)
          }}
          aria-label="Next page"
        >
          Next
          <ChevronRight />
        </Button>
      </div>
    </nav>
  )
}
