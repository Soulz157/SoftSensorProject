'use client'

import {
  CircleAlert,
  CircleCheck,
  Loader2,
  type LucideIcon,
} from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { chartColorVar } from '@/lib/mock-readings'
import type { DiscoveredTag, TagDiscoveryStatus } from '@/store/data-visualize'

interface Props {
  tags: DiscoveredTag[]
  selected: string[]
  onToggle: (piTag: string) => void
}

const STATUS_BADGE: Record<
  TagDiscoveryStatus,
  { label: string; className: string; Icon: LucideIcon }
> = {
  fetching: {
    label: 'Fetching…',
    className: 'bg-muted text-muted-foreground',
    Icon: Loader2,
  },
  complete: {
    label: 'Complete',
    className: 'bg-emerald-500/15 text-emerald-500',
    Icon: CircleCheck,
  },
  error: {
    label: 'Error',
    className: 'bg-destructive/15 text-destructive',
    Icon: CircleAlert,
  },
}

export function TagDiscoveryCardList({ tags, selected, onToggle }: Props) {
  return (
    <div className="space-y-2" role="group" aria-label="PI tags">
      {tags.map(tag => {
        const isOn = selected.includes(tag.piTag)
        // Error tags stay selectable — fetch their data to investigate the
        // PI-side cause. Only block selection while discovery is in flight.
        const selectable = tag.status !== 'fetching'
        const badge = STATUS_BADGE[tag.status]
        return (
          <label
            key={tag.piTag}
            className={cn(
              'flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors',
              selectable
                ? 'cursor-pointer hover:bg-accent/50'
                : 'cursor-not-allowed opacity-70',
              isOn && 'border-primary/50 bg-accent',
            )}
          >
            <Checkbox
              checked={isOn}
              disabled={!selectable}
              onCheckedChange={() => onToggle(tag.piTag)}
              aria-label={`Select ${tag.piTag}`}
            />
            <span
              className={cn(
                'h-2 w-2 shrink-0 rounded-full',
                !isOn && 'opacity-40',
              )}
              style={{ backgroundColor: chartColorVar(tag.chartIndex) }}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-medium text-foreground">
                  {tag.piTag}
                </span>
                <span className="text-xs text-muted-foreground">
                  {tag.label}
                </span>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {tag.description} · {tag.unit}
              </p>
            </div>
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
                badge.className,
              )}
            >
              <badge.Icon
                className={cn(
                  'h-3.5 w-3.5',
                  tag.status === 'fetching' && 'animate-spin',
                )}
              />
              {badge.label}
            </span>
          </label>
        )
      })}
    </div>
  )
}
