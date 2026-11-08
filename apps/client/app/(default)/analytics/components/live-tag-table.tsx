'use client'

import { useState } from 'react'
import {
  TAG_FILTERS,
  filterTagRows,
  formatRelative,
  tagFilterLabel,
  type TagFilter,
} from '@/lib/data-intake'
import type { TagRow } from '@/types/data-intake'
import { paginate } from '@/lib/workspace-list'
import { WorkspacePagination } from '@/components/workspace/workspace-pagination'
import { cn } from '@/lib/utils'
import { TagQualityBadge } from './tag-quality-badge'

export const TAGS_PAGE_SIZE = 15

/** One row per (model, tag), worst first, 15 to a page. `now` is the
 *  server's reference time so relative ages are stable between renders. */
export function LiveTagTable({ rows, now }: { rows: TagRow[]; now: Date }) {
  const [filter, setFilter] = useState<TagFilter>('all')
  const [pageNo, setPageNo] = useState(1)
  const filtered = filterTagRows(rows, filter)
  // `paginate` clamps, so new data that shrinks the list never leaves an
  // empty page behind.
  const page = paginate(filtered, pageNo, TAGS_PAGE_SIZE)
  const shown = page.items

  return (
    <section className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-medium">Tags by model</h2>
        <div
          role="group"
          aria-label="Filter by quality"
          className="flex flex-wrap gap-1"
        >
          {TAG_FILTERS.map(f => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => {
                setFilter(f)
                setPageNo(1)
              }}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                filter === f
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {tagFilterLabel(f)}
              <span className="ml-1.5 font-mono tabular-nums opacity-70">
                {filterTagRows(rows, f).length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-sm text-muted-foreground">
          No deployed model is fetching live input in this workspace.
        </p>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-sm text-muted-foreground">
          No tags match this filter.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-xs">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Tag
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Model
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Quality
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Last value
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Last seen
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map(r => (
                  <tr
                    key={`${r.modelId}:${r.tag}`}
                    className="border-b border-border/50 hover:bg-muted/20"
                  >
                    <td className="px-4 py-2 font-mono">{r.tag}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {r.modelName}
                    </td>
                    <td className="px-4 py-2">
                      <TagQualityBadge quality={r.quality} />
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {r.lastValue === null ? '—' : r.lastValue.toPrecision(5)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-muted-foreground tabular-nums">
                      {formatRelative(r.lastSeenAt, now)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <WorkspacePagination
            page={page}
            onPage={setPageNo}
            label="Tags pagination"
          />
        </>
      )}
    </section>
  )
}
