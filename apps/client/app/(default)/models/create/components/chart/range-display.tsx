import { RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  startTs: string | null
  endTs: string | null
  duration: string | null
  isZoomed: boolean
  onReset: () => void
  className?: string
}

export function RangeDisplay({
  startTs,
  endTs,
  duration,
  isZoomed,
  onReset,
  className,
}: Props) {
  if (!startTs || !endTs) return null

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-1.5',
        'bg-primary/5 border-primary/20 text-sm text-muted-foreground',
        className,
      )}
    >
      {`Range: ${startTs} → ${endTs}`}
      {duration && (
        <span className="ml-1 rounded bg-primary/15 px-2 py-0.5 font-medium text-primary">
          {duration}
        </span>
      )}
      {isZoomed && (
        <button
          type="button"
          onClick={onReset}
          className="ml-auto flex items-center gap-1 rounded px-2 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
      )}
    </div>
  )
}
