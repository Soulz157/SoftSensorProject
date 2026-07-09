import { Check, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SavedDataset } from '@/store/datasets'

interface DatasetCardProps {
  dataset: SavedDataset
  selected: boolean
  onSelect: () => void
}

export function DatasetCard({ dataset, selected, onSelect }: DatasetCardProps) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
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
        selected
          ? 'ring-2 ring-primary'
          : 'ring-1 ring-foreground/10 hover:bg-muted',
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
        <span>{dataset.missingPct.toFixed(1)}% missing</span>
      </div>
    </div>
  )
}
