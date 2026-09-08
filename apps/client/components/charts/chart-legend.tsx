'use client'

export type LegendShape = 'square' | 'dot' | 'dashed'

export interface LegendEntry {
  shape: LegendShape
  color: string
  opacity?: number
  label: string
}

function Swatch({ shape, color, opacity }: Omit<LegendEntry, 'label'>) {
  if (shape === 'dashed') {
    return (
      <svg width="16" height="2" viewBox="0 0 16 2" aria-hidden="true">
        <line
          x1="0"
          y1="1"
          x2="16"
          y2="1"
          stroke={color}
          strokeWidth="1.5"
          strokeDasharray="5 4"
          strokeOpacity={opacity ?? 1}
        />
      </svg>
    )
  }
  return (
    <span
      aria-hidden="true"
      className={
        shape === 'dot' ? 'h-2 w-2 rounded-full' : 'h-2.5 w-2.5 rounded-sm'
      }
      style={{ backgroundColor: color, opacity: opacity ?? 1 }}
    />
  )
}

export function LegendItem({ shape, color, opacity, label }: LegendEntry) {
  return (
    <span className="flex items-center gap-1.5">
      <Swatch shape={shape} color={color} opacity={opacity} />
      {label}
    </span>
  )
}

export function ChartLegend({ items }: { items: LegendEntry[] }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
      {items.map(item => (
        <LegendItem key={item.label} {...item} />
      ))}
    </div>
  )
}
