import { type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

const SURFACE_CLASS = {
  card: 'rounded-xl bg-card p-4 ring-1 ring-foreground/10',
  muted: 'rounded-lg bg-muted/40 p-3',
  bare: '',
} as const

const VALUE_SIZE_CLASS = {
  sm: 'text-base',
  md: 'text-lg',
  lg: 'text-2xl',
} as const

interface StatTileProps {
  label: string
  value: string
  icon?: LucideIcon
  sub?: string
  toneClassName?: string
  surface?: keyof typeof SURFACE_CLASS
  valueSize?: keyof typeof VALUE_SIZE_CLASS
  className?: string
}

/**
 * Shared label/value/sub stat primitive for the model-create wizard —
 * consolidates what used to be 4 hand-rolled near-duplicates (data quality
 * overview, quality summary cards, tag stat box, evaluation metrics).
 */
export function StatTile({
  label,
  value,
  icon: Icon,
  sub,
  toneClassName,
  surface = 'card',
  valueSize = 'lg',
  className,
}: StatTileProps) {
  return (
    <div className={cn(SURFACE_CLASS[surface], className)}>
      <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </p>
      <p
        className={cn(
          'mt-1 font-mono tabular-nums text-foreground',
          VALUE_SIZE_CLASS[valueSize],
          toneClassName,
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  )
}
