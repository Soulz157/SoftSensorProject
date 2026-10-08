'use client'

import { useMemo, useRef, useState } from 'react'
import { Layers, Search, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useDatasets } from '@/hooks/dataset/use-datasets'
import type { SavedDataset } from '@/store/datasets'
import { DatasetCard } from '../dataset-card'

type SortKey = 'name' | 'rows' | 'missing'

const SORT_LABELS: Record<SortKey, string> = {
  name: 'Name (A–Z)',
  rows: 'Most rows',
  missing: 'Least missing',
}

interface Props {
  workspaceId: string
  selectedDataset: SavedDataset | null
  onSelectDataset: (dataset: SavedDataset) => void
}

/**
 * Search/sort/tag-filter layer over the datasets already fetched by
 * `useDatasets` (extracted out of `Phase1Details` — MODEL-FLOW step-1
 * redesign). Everything below the fetch is in-memory: no debounce needed for
 * filtering a list this size, and the hook itself is untouched.
 *
 * Three states never collapse into one (Visibility of System Status /
 * Postel's Law): no workspace yet, workspace with zero datasets, and filters
 * matching nothing all say *why*, distinctly.
 */
export function DatasetPicker({
  workspaceId,
  selectedDataset,
  onSelectDataset,
}: Props) {
  const { datasets, loading } = useDatasets(workspaceId || undefined)
  const [query, setQuery] = useState('')
  const [activeTags, setActiveTags] = useState<string[]>([])
  const [sort, setSort] = useState<SortKey>('name')
  const gridRef = useRef<HTMLDivElement>(null)

  const distinctTags = useMemo(() => {
    const set = new Set<string>()
    for (const d of datasets) for (const t of d.tags) set.add(t)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [datasets])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let result = datasets

    if (q) {
      result = result.filter(
        d =>
          d.name.toLowerCase().includes(q) ||
          (d.description ?? '').toLowerCase().includes(q) ||
          d.tags.some(t => t.toLowerCase().includes(q)),
      )
    }

    if (activeTags.length > 0) {
      result = result.filter(d => activeTags.every(t => d.tags.includes(t)))
    }

    const sorted = [...result]
    switch (sort) {
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'rows':
        sorted.sort((a, b) => b.rowCount - a.rowCount)
        break
      case 'missing':
        sorted.sort((a, b) => a.missingPct - b.missingPct)
        break
    }
    return sorted
  }, [datasets, query, activeTags, sort])

  const filterActive = query.trim() !== '' || activeTags.length > 0
  // The selection can fall out of the filtered set without disappearing —
  // search/filter must never silently hide what is already chosen.
  const selectionHidden =
    selectedDataset !== null && !filtered.some(d => d.id === selectedDataset.id)

  function toggleTag(tag: string) {
    setActiveTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag],
    )
  }

  function clearFilters() {
    setQuery('')
    setActiveTags([])
  }

  function handleGridKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const radios =
      gridRef.current?.querySelectorAll<HTMLElement>('[role="radio"]')
    if (!radios || radios.length === 0) return
    // Arrow navigation moves focus only — never selection. Selecting on
    // every keypress would re-fire onSelectDataset (which feeds
    // canAdvance(1)) on each arrow tap.
    const activeIndex = Array.from(radios).indexOf(
      document.activeElement as HTMLElement,
    )

    let next = activeIndex
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = activeIndex < 0 ? 0 : (activeIndex + 1) % radios.length
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        next =
          activeIndex < 0
            ? 0
            : (activeIndex - 1 + radios.length) % radios.length
        break
      default:
        return
    }
    e.preventDefault()
    radios[next]?.focus()
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-medium text-foreground">
          Select a dataset
        </h2>
        <p className="text-xs text-muted-foreground">
          Train on a curated dataset built in Data Studio — no need to reconnect
          or re-clean data.
        </p>
      </div>

      {/* State (a): no workspace — the search row stays mounted (disabled)
          so this block never changes height once a workspace is picked. */}
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search datasets…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            disabled={!workspaceId || loading || datasets.length === 0}
            className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="-m-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground sm:h-8 sm:w-8"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {workspaceId && datasets.length > 0 && (
          <Select value={sort} onValueChange={v => setSort(v as SortKey)}>
            <SelectTrigger className="h-9 w-40 shrink-0 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABELS) as SortKey[]).map(key => (
                <SelectItem key={key} value={key} className="text-xs">
                  {SORT_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {distinctTags.length >= 2 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {distinctTags.map(tag => {
            const on = activeTags.includes(tag)
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                aria-pressed={on}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 transition-colors',
                  on
                    ? 'bg-primary/15 text-primary ring-primary/40'
                    : 'bg-muted text-muted-foreground ring-border hover:bg-muted/70',
                )}
              >
                {tag}
              </button>
            )
          })}
        </div>
      )}

      {selectionHidden && selectedDataset && (
        <Badge
          variant="outline"
          className="flex w-fit items-center gap-1.5 border-primary/40 bg-primary/5 pl-2 pr-1 text-[11px] text-primary"
        >
          <span className="max-w-48 truncate">
            Selected: {selectedDataset.name}
          </span>
          <button
            type="button"
            onClick={() => clearFilters()}
            aria-label="Clear filters to show selected dataset"
            className="-m-1.5 ml-0.5 flex h-8 w-8 items-center justify-center rounded-md text-primary/60 transition-colors hover:text-primary"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}

      {filterActive && (
        <p className="text-xs text-muted-foreground">
          Showing {filtered.length} of {datasets.length} datasets
        </p>
      )}

      {!workspaceId ? (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-muted/30 py-8 text-center ring-1 ring-border">
          <Layers className="h-7 w-7 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">
            Pick a workspace first to see its datasets.
          </p>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex h-32 flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-border"
              aria-hidden="true"
            >
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-muted" />
                <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted" />
              </div>
              <div className="mt-auto h-3 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : datasets.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-muted/30 py-8 text-center ring-1 ring-border">
          <Layers className="h-7 w-7 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">
            No datasets yet in this workspace — create one in Data Studio first.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-muted/30 py-8 text-center ring-1 ring-border">
          <Layers className="h-7 w-7 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">
            No datasets match &quot;{query}&quot;
          </p>
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs font-medium text-primary hover:underline"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div
          ref={gridRef}
          role="radiogroup"
          aria-label="Dataset"
          onKeyDown={handleGridKeyDown}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {filtered.map((d, i) => {
            const isSelected = selectedDataset?.id === d.id
            // 0 on the selected card; otherwise 0 only on the first card
            // when nothing is selected yet, so the grid stays reachable by
            // Tab from its very first render — "selected gets 0, else -1"
            // read literally would make an empty selection untabbable.
            const tabIndexValue = isSelected
              ? 0
              : selectedDataset === null && i === 0
                ? 0
                : -1
            return (
              <DatasetCard
                key={d.id}
                dataset={d}
                selected={isSelected}
                tabIndex={tabIndexValue}
                onSelect={() => onSelectDataset(d)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
