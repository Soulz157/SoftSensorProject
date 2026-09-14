import { Check, CircleAlert, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SavedDataset } from '@/store/datasets'

/** ≥10% missing is called out — matches the bad-data threshold this wizard
 * already surfaces via `quality-summary-badges.tsx`. */
const MISSING_WARNING_THRESHOLD = 10

interface DatasetCardProps {
  dataset: SavedDataset
  selected: boolean
  /**
   * Roving tabindex, owned by the parent radiogroup (`DatasetPicker`) — only
   * one card in the grid is ever `0`. This component stays presentational
   * and does not decide its own place in the tab order.
   */
  tabIndex: number
  onSelect: () => void
}

export function DatasetCard({
  dataset,
  selected,
  tabIndex,
  onSelect,
}: DatasetCardProps) {
  const missingWarn = dataset.missingPct >= MISSING_WARNING_THRESHOLD

  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={tabIndex}
      onClick={onSelect}
      onKeyDown={e => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        'group relative flex cursor-pointer flex-col gap-3 rounded-xl bg-card p-4 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'ring-2 ring-primary' : 'ring-1 ring-border hover:bg-muted',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors',
              selected
                ? 'bg-primary/15 text-primary'
                : 'bg-muted text-muted-foreground',
            )}
          >
            <Layers className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {dataset.name}
            </p>
            {dataset.description && (
              <p className="truncate text-[11px] font-medium text-muted-foreground">
                {dataset.description}
              </p>
            )}
          </div>
        </div>
        <span
          className={cn(
            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors',
            selected
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border',
          )}
          aria-hidden="true"
        >
          {selected && <Check className="h-3 w-3" />}
        </span>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-3 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
        <span>{dataset.sourceIds.length} sources</span>
        <span>{dataset.tags.length} tags</span>
        <span>{dataset.rowCount.toLocaleString()} rows</span>
        {/* Signifier, not just a number: neutral under the threshold, called
         * out with the icon + destructive token at/above it (§5 reserves
         * amber/red for node/model/plant status — text-destructive is the
         * one already used for bad data in this same wizard). */}
        <span
          className={cn(
            'flex items-center gap-1',
            missingWarn && 'text-destructive',
          )}
        >
          {missingWarn && <CircleAlert className="h-3 w-3" />}
          {dataset.missingPct.toFixed(1)}% missing
        </span>
      </div>
    </div>
  )
}
