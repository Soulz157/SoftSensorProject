'use client'

import { useRef, type KeyboardEvent } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { StatusFilter } from '@/lib/workspace-list'

export interface FilterCounts {
  all: number
  /** `null` while the abnormal counts are still unknown. */
  attention: number | null
  normal: number | null
}

const OPTIONS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'attention', label: 'Needs attention' },
  { id: 'normal', label: 'Normal' },
]

export function WorkspacesToolbar({
  query,
  onQuery,
  status,
  onStatus,
  counts,
}: {
  query: string
  onQuery: (v: string) => void
  status: StatusFilter
  onStatus: (v: StatusFilter) => void
  counts: FilterCounts
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  // Radio pattern: one Tab stop (the checked option), arrows move + select.
  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0
    if (step === 0) return
    e.preventDefault()
    const next = (index + step + OPTIONS.length) % OPTIONS.length
    onStatus(OPTIONS[next]!.id)
    refs.current[next]?.focus()
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative w-full sm:max-w-xs">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={e => onQuery(e.target.value)}
          placeholder="Search workspaces"
          aria-label="Search workspaces"
          className="h-9 pl-8"
        />
      </div>
      <div
        role="radiogroup"
        aria-label="Filter by status"
        className="flex w-fit rounded-md bg-muted p-0.5"
      >
        {OPTIONS.map((o, i) => {
          const count = counts[o.id]
          const checked = status === o.id
          return (
            <button
              key={o.id}
              ref={el => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={`${o.label}, ${count === null ? 'unknown' : count}`}
              tabIndex={checked ? 0 : -1}
              onClick={() => onStatus(o.id)}
              onKeyDown={e => onKeyDown(e, i)}
              className={cn(
                'rounded px-3 py-1 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
                checked && 'bg-background font-medium text-foreground',
              )}
            >
              {o.label}
              <span
                className="ml-1.5 font-mono text-xs tabular-nums"
                aria-hidden
              >
                {count === null ? '—' : count}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
